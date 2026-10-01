import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent, Raw } from 'telegram/events';
import { _parseMessageText } from 'telegram/client/messageParse';
import { checkCancelled, cancellableSleep } from 'src/shared/cancellation';
import { CustomFile } from 'telegram/client/uploads';
import bigInt from 'big-integer';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { appConfig } from 'src/config/app.config';
import { PrismaService } from 'src/prisma.service';
import { CryptoService } from 'src/shared/crypto.service';
import { ClockService } from 'src/shared/clock.service';
import { HistoryService } from 'src/shared/history.service';
import { toChatId } from 'src/utils/ids';
import {
  InboundMedia,
  OutboundTransport,
  REPLY_BRAIN,
  ReplyBrain,
} from 'src/brain/reply-brain.port';
import { proxyLabel, toClientProxy, type ClientProxy } from 'src/domain/proxy';
import {
  DEFAULT_TYPING,
  TYPING_REFRESH_MS,
  partPauseMs,
  typingPlan,
  type TypingStyle,
} from 'src/domain/typing';
import { TelegramTimeoutError, withTimeout } from 'src/domain/timeout';
import { ROUND_SIDE } from 'src/domain/round-video';
import {
  accountLoss,
  blockedByClient,
  clientPresence,
} from 'src/domain/tg-status';
import {
  PresenceService,
  type ClientActivity,
} from 'src/shared/presence.service';
import { VoiceEncoderService } from 'src/modules/media/voice-encoder.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TG_CALL_TIMEOUT_MS = 60_000;
const TG_FILE_TIMEOUT_MS = 180_000;
const TG_TYPING_TIMEOUT_MS = 15_000;
const CONNECT_STAGGER_MS = 1500;
export const recordingMs = (seconds: number) =>
  Math.round(Math.min(20, Math.max(3, Number(seconds) || 0)) * 1000);
const INBOUND_EXT: Record<string, string> = {
  photo: 'jpg',
  voice: 'ogg',
  video_note: 'mp4',
  video: 'mp4',
  animation: 'mp4',
};
function documentName(doc: unknown): string | null {
  if (!(doc instanceof Api.Document)) return null;
  const attr = doc.attributes.find(
    (a) => a instanceof Api.DocumentAttributeFilename,
  ) as Api.DocumentAttributeFilename | undefined;
  const name = attr?.fileName?.trim();
  return name ? name.slice(0, 120) : null;
}

function extensionOf(name: string | null, doc: unknown): string {
  const fromName = name && /.([A-Za-z0-9]{1,8})$/.exec(name)?.[1];
  if (fromName) return fromName.toLowerCase();
  const mime = doc instanceof Api.Document ? String(doc.mimeType ?? '') : '';
  const tail = mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '');
  return tail ? tail.slice(0, 8).toLowerCase() : 'bin';
}
const INBOUND_MAX_BYTES = 50 * 1024 * 1024;
const INBOUND_BACKFILL_DAYS = 7;
const CLIENT_STATUS_ACTIVE_DAYS = 14;
const DISCONNECT_TIMEOUT_MS = 10_000;
const STALE_CONNECT_SECONDS = 300;

async function closeQuietly(client: TelegramClient): Promise<void> {
  await withTimeout(
    client.disconnect(),
    DISCONNECT_TIMEOUT_MS,
    () => new Error('disconnect timeout'),
  ).catch(() => undefined);
}
const TELEGRAM_SERVICE_IDS = new Set([
  777000, 42777, 333000, 1087968824, 1271266957,
]);

function isConversableUser(
  user: Api.User | null | undefined,
  chatId: number,
): boolean {
  if (TELEGRAM_SERVICE_IDS.has(chatId)) return false;
  if (!user) return true;
  return !user.bot && !user.support && !user.deleted && !user.self;
}

export function typingKind(action: unknown): ClientActivity | null {
  if (action instanceof Api.SendMessageTypingAction) return 'typing';
  if (
    action instanceof Api.SendMessageRecordAudioAction ||
    action instanceof Api.SendMessageUploadAudioAction
  )
    return 'voice';
  if (
    action instanceof Api.SendMessageRecordRoundAction ||
    action instanceof Api.SendMessageUploadRoundAction
  )
    return 'video_note';
  if (
    action instanceof Api.SendMessageUploadPhotoAction ||
    action instanceof Api.SendMessageUploadVideoAction
  )
    return 'photo';
  if (action instanceof Api.SendMessageUploadDocumentAction) return 'file';
  return null;
}

export type ResolvedPhone =
  | { kind: 'found'; userId: number; username: string | null; deleted: boolean }
  | { kind: 'not_found' }
  | { kind: 'retry' };

interface LiveAccount {
  id: number;
  client: TelegramClient;
  telegramUserId: number | null;
}

const UNKNOWN_MEDIA: Array<[new (...args: any[]) => unknown, string]> = [
  [Api.MessageMediaGeo, 'геопозиция'],
  [Api.MessageMediaGeoLive, 'геопозиция'],
  [Api.MessageMediaVenue, 'место'],
  [Api.MessageMediaContact, 'контакт'],
  [Api.MessageMediaPoll, 'опрос'],
  [Api.MessageMediaDice, 'кубик'],
  [Api.MessageMediaStory, 'история'],
  [Api.MessageMediaGame, 'игра'],
  [Api.MessageMediaInvoice, 'счёт'],
  [Api.MessageMediaUnsupported, 'вложение, не поддержанное Telegram'],
];

export function inboundText(
  message: Api.Message,
  media: InboundMedia | null,
): string {
  const text = message.message ?? '';
  if (text.trim() || media) return text;
  if (!message.media) return text;
  const known = UNKNOWN_MEDIA.find(([type]) => message.media instanceof type);
  return `[${known ? known[1] : `вложение: ${message.media.className}`}]`;
}

@Injectable()
export class TelegramService
  implements OnModuleInit, OnModuleDestroy, OutboundTransport
{
  private readonly log = new Logger(TelegramService.name);
  private readonly live = new Map<number, LiveAccount>();
  private stopping = false;
  private readonly localSends = new Map<number, Set<Promise<unknown>>>();
  private readonly outgoingImports = new Map<string, Promise<void>>();
  private readonly sentHere = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private clock: ClockService,
    private history: HistoryService,
    @Inject(forwardRef(() => REPLY_BRAIN)) private brain: ReplyBrain,
    private presence: PresenceService,
    private voiceEncoder: VoiceEncoderService,
  ) {}

  callClient(accountId: number): TelegramClient {
    const entry = this.live.get(accountId);
    if (!entry?.client.connected)
      throw new Error('Telegram-аккаунт не подключён');
    return entry.client;
  }

  get configured(): boolean {
    return Boolean(appConfig.tgApiId && appConfig.tgApiHash);
  }

  onModuleInit(): void {
    if (!this.configured) {
      this.log.warn(
        'TG_API_ID / TG_API_HASH are not set — Telegram accounts stay offline',
      );
      return;
    }
    void this.connectAll();
  }

  private async connectAll(): Promise<void> {
    const accounts = await this.prisma.tgAccount.findMany({
      where: { status: 'active', sessionEncrypted: { not: null } },
    });
    this.log.log(`подключаю ${accounts.length} аккаунт(ов) в фоне`);
    for (const acc of accounts) {
      if (this.stopping) return;
      void this.connect(acc.id).catch((e) =>
        this.log.error(
          `account ${acc.id} failed to connect: ${e?.message ?? e}`,
        ),
      );
      await sleep(CONNECT_STAGGER_MS);
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    for (const acc of this.live.values()) {
      try {
        await acc.client.disconnect();
      } catch {
        // shutting down anyway
      }
    }
    this.live.clear();
  }

  isOnline(accountId: number): boolean {
    return this.live.has(accountId);
  }

  onlineIds(): number[] {
    return [...this.live.keys()];
  }

  buildClient(
    sessionString = '',
    proxy: ClientProxy | null = null,
  ): TelegramClient {
    return new TelegramClient(
      new StringSession(sessionString),
      appConfig.tgApiId,
      appConfig.tgApiHash,
      {
        connectionRetries: 5,
        retryDelay: 2000,
        autoReconnect: true,
        requestRetries: 5,
        timeout: 30,
        ...(proxy ? { proxy } : {}),
      },
    );
  }

  async proxyFor(accountId: number): Promise<ClientProxy | null> {
    const acc = await this.prisma.tgAccount.findUnique({
      where: { id: accountId },
      select: { proxyConfigEncrypted: true },
    });
    if (!acc?.proxyConfigEncrypted) return null;
    return toClientProxy(
      JSON.parse(this.crypto.decrypt(acc.proxyConfigEncrypted)),
    );
  }

  private readonly recovering = new Set<number>();

  private async call<T>(
    account: LiveAccount,
    label: string,
    work: () => Promise<T>,
    ms = TG_CALL_TIMEOUT_MS,
  ): Promise<T> {
    try {
      return await withTimeout(
        work(),
        ms,
        () => new TelegramTimeoutError(account.id, label, ms),
      );
    } catch (e) {
      if (e instanceof TelegramTimeoutError) this.recover(account, e);
      const loss = accountLoss(e);
      if (loss) void this.onAccountLost(account.id, loss);
      throw e;
    }
  }

  private recover(account: LiveAccount, reason: Error): void {
    if (
      this.recovering.has(account.id) ||
      this.live.get(account.id) !== account
    )
      return;
    this.recovering.add(account.id);
    this.log.warn(`${reason.message} — reconnecting the account`);
    void this.reconnect(account.id)
      .catch((e) =>
        this.log.error(
          `account ${account.id}: reconnect after a timeout failed: ${e?.message ?? e}`,
        ),
      )
      .finally(() => this.recovering.delete(account.id));
  }

  async reconnect(accountId: number): Promise<void> {
    await this.disconnect(accountId, { hold: false });
    await this.connect(accountId);
  }

  private readonly held = new Set<number>();
  private readonly connecting = new Map<number, { seq: number; at: number }>();
  private connectSeq = 0;

  private busyConnecting(accountId: number): boolean {
    const attempt = this.connecting.get(accountId);
    if (!attempt) return false;
    if (this.clock.ts() - attempt.at < STALE_CONNECT_SECONDS) return true;
    this.log.warn(
      `account ${accountId}: подключение висит дольше ${STALE_CONNECT_SECONDS} с — пробую заново`,
    );
    this.connecting.delete(accountId);
    return false;
  }

  release(accountId: number): void {
    this.held.delete(accountId);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async reviveOffline(): Promise<void> {
    if (!this.configured || this.stopping) return;
    const accounts = await this.prisma.tgAccount.findMany({
      where: { status: 'active', sessionEncrypted: { not: null } },
      select: { id: true },
    });
    for (const { id } of accounts) {
      if (this.live.has(id) || this.held.has(id) || this.busyConnecting(id))
        continue;
      this.log.warn(`account ${id} is offline — reconnecting`);
      await this.connect(id).catch((e) =>
        this.log.error(`account ${id}: reconnect failed: ${e?.message ?? e}`),
      );
    }
  }

  async connect(accountId: number): Promise<void> {
    if (this.live.has(accountId) || this.busyConnecting(accountId)) return;
    const attempt = { seq: ++this.connectSeq, at: this.clock.ts() };
    this.connecting.set(accountId, attempt);
    this.held.delete(accountId);
    try {
      await this.connectNow(accountId);
    } finally {
      if (this.connecting.get(accountId)?.seq === attempt.seq)
        this.connecting.delete(accountId);
    }
  }

  private async connectNow(accountId: number): Promise<void> {
    const acc = await this.prisma.tgAccount.findUnique({
      where: { id: accountId },
    });
    if (!acc?.sessionEncrypted)
      throw new Error(`account ${accountId} has no session`);
    const proxy = acc.proxyConfigEncrypted
      ? toClientProxy(JSON.parse(this.crypto.decrypt(acc.proxyConfigEncrypted)))
      : null;
    const client = this.buildClient(
      this.crypto.decrypt(acc.sessionEncrypted),
      proxy,
    );
    const limited = <T>(work: Promise<T>, label: string) =>
      withTimeout(
        work,
        TG_CALL_TIMEOUT_MS,
        () => new TelegramTimeoutError(accountId, label, TG_CALL_TIMEOUT_MS),
      );
    let authorized: boolean;
    try {
      await limited(client.connect(), 'connect');
      authorized = await limited(client.isUserAuthorized(), 'isUserAuthorized');
    } catch (e) {
      await closeQuietly(client);
      const loss = accountLoss(e);
      if (loss) await this.onAccountLost(accountId, loss);
      throw e;
    }
    if (!authorized) {
      await closeQuietly(client);
      await this.prisma.tgAccount.update({
        where: { id: accountId },
        data: {
          status: 'unauthorized',
          bannedAt: this.clock.ts(),
          banReason: 'сессия завершена — нужно войти заново',
        },
      });
      throw new Error(
        `account ${accountId} session is not authorized any more`,
      );
    }
    let me: Awaited<ReturnType<TelegramClient['getMe']>>;
    try {
      me = await limited(client.getMe(), 'getMe');
    } catch (e) {
      await closeQuietly(client);
      const loss = accountLoss(e);
      if (loss) await this.onAccountLost(accountId, loss);
      throw e;
    }
    const telegramUserId = me && 'id' in me ? Number(me.id) : null;
    const entry: LiveAccount = { id: accountId, client, telegramUserId };
    this.live.set(accountId, entry);
    client.addEventHandler(
      (event) => void this.onInbound(entry, event),
      new NewMessage({ incoming: true }),
    );
    client.addEventHandler(
      (event) => void this.onOutgoing(entry, event),
      new NewMessage({ outgoing: true }),
    );
    // Удаления в личных чатах приходят без чата — только id сообщений аккаунта.
    client.addEventHandler(
      (update) =>
        void this.onDeleted(entry, update as Api.UpdateDeleteMessages),
      new Raw({ types: [Api.UpdateDeleteMessages] }),
    );
    // «Печатает…», «записывает голосовое…» — для панели.
    client.addEventHandler(
      (update) => void this.onUserTyping(entry, update as Api.UpdateUserTyping),
      new Raw({ types: [Api.UpdateUserTyping] }),
    );
    // «Был в сети»: Telegram присылает, когда собеседник заходит и выходит (если он это показывает).
    client.addEventHandler(
      (update) => void this.onUserStatus(update as Api.UpdateUserStatus),
      new Raw({ types: [Api.UpdateUserStatus] }),
    );
    // Правки сообщений в самом Telegram.
    client.addEventHandler(
      (update) => void this.onEdited(entry, update as Api.UpdateEditMessage),
      new Raw({ types: [Api.UpdateEditMessage] }),
    );
    // Галочки: собеседник прочитал наши (outbox) или аккаунт прочитал его с другого устройства (inbox).
    client.addEventHandler(
      (update) =>
        void this.onReadHistory(
          entry,
          update as Api.UpdateReadHistoryOutbox | Api.UpdateReadHistoryInbox,
        ),
      new Raw({
        types: [Api.UpdateReadHistoryOutbox, Api.UpdateReadHistoryInbox],
      }),
    );
    if (me instanceof Api.User) void this.rememberOwnAvatar(entry, me);
    void this.catchUp(entry)
      .catch((e) =>
        this.log.warn(
          `catch-up failed account=${accountId}: ${e?.message ?? e}`,
        ),
      )
      .then(() => this.backfillInboundVideos(entry))
      .catch((e) =>
        this.log.warn(
          `video backfill failed account=${accountId}: ${e?.message ?? e}`,
        ),
      );
    await this.prisma.tgAccount.update({
      where: { id: accountId },
      data: {
        lastLoginAt: this.clock.ts(),
        lastHeartbeatAt: this.clock.ts(),
        telegramUserId: telegramUserId === null ? null : BigInt(telegramUserId),
        username: me && 'username' in me ? (me.username ?? null) : null,
        displayName:
          me instanceof Api.User
            ? [me.firstName, me.lastName].filter(Boolean).join(' ').trim() ||
              null
            : null,
      },
    });
    const via = proxy
      ? ` via ${proxyLabel({ type: 'MTProxy' in proxy ? 'mtproto' : `socks${proxy.socksType}`, host: proxy.ip, port: proxy.port })}`
      : ' direct';
    this.log.log(
      `account ${accountId} online as @${me && 'username' in me ? me.username : '?'}${via}`,
    );
  }

  /** `hold` (по умолчанию) — отключили намеренно: сторож не подключит аккаунт обратно. */
  async disconnect(
    accountId: number,
    { hold = true }: { hold?: boolean } = {},
  ): Promise<void> {
    if (hold) this.held.add(accountId);
    const entry = this.live.get(accountId);
    if (!entry) return;
    this.live.delete(accountId);
    await closeQuietly(entry.client);
  }

  /**
   * Telegram заблокировал аккаунт или завершил его сессию: помечаем в базе (вкладка
   * «Аккаунты» и чаты этого аккаунта показывают это словами) и больше не подключаем.
   */
  private async onAccountLost(
    accountId: number,
    loss: { kind: 'banned' | 'logged_out'; reason: string },
  ): Promise<void> {
    const status = loss.kind === 'banned' ? 'banned' : 'unauthorized';
    const current = await this.prisma.tgAccount.findUnique({
      where: { id: accountId },
      select: { status: true },
    });
    if (!current || current.status === status) return;
    await this.prisma.tgAccount.update({
      where: { id: accountId },
      data: { status, bannedAt: this.clock.ts(), banReason: loss.reason },
    });
    this.log.error(`account ${accountId}: ${loss.reason} — marked ${status}`);
    await this.disconnect(accountId);
  }

  /**
   * Отправка в чат: собеседник заблокировал нас — отметка на чате и ошибка словами;
   * дошло — отметка снимается (разблокировал).
   */
  private async deliver<T>(chatId: number, work: () => Promise<T>): Promise<T> {
    const pending = this.localSends.get(chatId) ?? new Set<Promise<unknown>>();
    this.localSends.set(chatId, pending);
    const rpc = Promise.resolve().then(work);
    pending.add(rpc);
    try {
      const result = await rpc;
      for (const m of (Array.isArray(result) ? result : [result]) as any[]) {
        if (m?.id) this.sentHere.set(`${chatId}:${m.id}`, this.clock.ts());
      }
      if (this.sentHere.size > 10000)
        for (const [key, ts] of this.sentHere)
          if (ts < this.clock.ts() - 3600) this.sentHere.delete(key);
      await this.history
        .setBlockedByClient(chatId, null)
        .catch(() => undefined);
      return result;
    } catch (e) {
      if (blockedByClient(e)) {
        await this.history
          .setBlockedByClient(chatId, this.clock.ts())
          .catch(() => undefined);
        throw new Error(
          'собеседник заблокировал аккаунт — сообщение не доставлено',
        );
      }
      throw e;
    } finally {
      pending.delete(rpc);
      if (!pending.size) this.localSends.delete(chatId);
    }
  }

  private async onOutgoing(
    account: LiveAccount,
    event: NewMessageEvent,
  ): Promise<void> {
    if (this.stopping || !event.isPrivate || !event.message.out) return;
    try {
      await this.importOutgoing(account, event.message);
    } catch (e) {
      this.log.error(
        `outgoing import failed account=${account.id}: ${e?.message ?? e}`,
      );
    }
  }

  private async importOutgoing(
    account: LiveAccount,
    message: Api.Message,
  ): Promise<void> {
    const key = `${account.id}:${message.id}`;
    const previous = this.outgoingImports.get(key);
    if (previous) return previous;
    const work = this.importOutgoingOnce(account, message);
    this.outgoingImports.set(key, work);
    try {
      await work;
    } finally {
      this.outgoingImports.delete(key);
    }
  }

  private async importOutgoingOnce(
    account: LiveAccount,
    message: Api.Message,
  ): Promise<void> {
    if (!(message.peerId instanceof Api.PeerUser)) return;
    const chatId = Number(message.peerId.userId);
    if (
      TELEGRAM_SERVICE_IDS.has(chatId) ||
      chatId === account.telegramUserId ||
      (await this.ownedByOther(chatId, account.id))
    )
      return;
    // An update from our own RPC may arrive before its promise resolves. Wait for that RPC's ID mapping.
    await Promise.allSettled([...(this.localSends.get(chatId) ?? [])]);
    if (this.sentHere.has(`${chatId}:${message.id}`)) return;
    if (
      await this.prisma.message.findFirst({
        where: {
          chatId: toChatId(chatId),
          tgMsgId: message.id,
          role: 'assistant',
        },
        select: { id: true },
      })
    )
      return;
    const release = this.brain.observeIncoming?.(
      chatId,
      account.id,
      -message.id,
    );
    try {
      await this.history.ensureContact(chatId, account.id);
      await this.brain.noteOperatorQueued?.(chatId);
      const media = await this.downloadMedia(account, message).catch(
        () => null,
      );
      const text =
        message.message?.trim() ||
        (media
          ? `[${media.kind}: содержимое вложения не расшифровано]`
          : '[Вложение без описания]');
      await this.history.appendMessage(chatId, {
        role: 'assistant',
        text,
        ts: message.date,
        author: 'operator:telegram',
        tgMsgId: message.id,
        mediaKind: media?.kind,
        filePath: media?.path,
      });
      await this.brain.noteOperatorMessage(chatId);
    } finally {
      release?.();
    }
  }

  private async onUserStatus(update: Api.UpdateUserStatus): Promise<void> {
    if (this.stopping || !update?.userId) return;
    const presence = clientPresence(update.status);
    if (!presence) return;
    await this.history
      .saveClientPresence(Number(update.userId), presence, this.clock.ts())
      .catch(() => undefined);
  }

  /** Статусы собеседников раз в 5 минут: живые апдейты приходят не всегда (перезапуск, обрыв). */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async refreshClientStatuses(): Promise<void> {
    if (!this.configured || this.stopping) return;
    const since = this.clock.ts() - CLIENT_STATUS_ACTIVE_DAYS * 86400;
    const recent = await this.prisma.message.findMany({
      where: { ts: { gte: since } },
      distinct: ['chatId'],
      select: { chatId: true },
    });
    for (const account of [...this.live.values()]) {
      const contacts = await this.prisma.contact.findMany({
        where: {
          accountId: account.id,
          chatId: { in: recent.map((m) => m.chatId) },
        },
        select: { chatId: true },
      });
      for (let i = 0; i < contacts.length; i += 100) {
        const peers: Api.TypeInputUser[] = [];
        for (const c of contacts.slice(i, i + 100)) {
          const peer = await account.client
            .getInputEntity(Number(c.chatId))
            .catch(() => null);
          if (peer instanceof Api.InputPeerUser)
            peers.push(
              new Api.InputUser({
                userId: peer.userId,
                accessHash: peer.accessHash,
              }),
            );
        }
        if (!peers.length) continue;
        try {
          const users = await this.call(account, 'users.GetUsers', () =>
            account.client.invoke(new Api.users.GetUsers({ id: peers })),
          );
          const now = this.clock.ts();
          for (const u of users) {
            if (!(u instanceof Api.User)) continue;
            const presence = clientPresence(u.status);
            if (presence)
              await this.history.saveClientPresence(
                Number(u.id),
                presence,
                now,
              );
          }
        } catch (e) {
          this.log.warn(
            `client statuses failed account=${account.id}: ${e?.message ?? e}`,
          );
        }
      }
    }
  }

  // -- inbound -----------------------------------------------------------------

  private async onInbound(
    account: LiveAccount,
    event: NewMessageEvent,
  ): Promise<void> {
    if (this.stopping) return;
    const message = event.message;
    if (!event.isPrivate || message.out) return;
    const chatId = Number(message.chatId ?? message.senderId ?? 0);
    if (!chatId) return;
    const sender = await message.getSender().catch(() => null);
    if (!isConversableUser(sender instanceof Api.User ? sender : null, chatId))
      return;
    const owner = await this.ownedByOther(chatId, account.id);
    if (owner !== null) {
      this.log.warn(
        `chat ${chatId} is led by account ${owner}; message ${message.id} to account ${account.id} is not passed to the bot`,
      );
      return;
    }
    const already = await this.history.hasProcessedClientMessage(
      chatId,
      message.id,
    );
    if (already) return;
    // Signal BEFORE media download, database bookkeeping and the per-chat lock.
    const release = this.brain.observeIncoming?.(
      chatId,
      account.id,
      message.id,
    );
    try {
      this.presence.setActivity(chatId, null);
      await this.history
        .setBlockedByClient(chatId, null)
        .catch(() => undefined);
      await this.history.clearClearedByClient(chatId).catch(() => undefined);
      await this.rememberPeer(
        chatId,
        sender instanceof Api.User ? sender : null,
        account,
      );
      const media = await this.downloadMedia(account, message, {
        download: true,
      }).catch((e) => {
        this.log.warn(
          `media download failed chat=${chatId}: ${e?.message ?? e}`,
        );
        return null;
      });
      await this.brain.handleInbound({
        chatId,
        accountId: account.id,
        messageId: message.id,
        text: inboundText(message, media),
        ts: message.date,
        media,
      });
    } catch (e) {
      this.log.error(`inbound failed chat=${chatId}: ${e?.stack ?? e}`);
    } finally {
      release?.();
    }
  }

  /**
   * Чат ведёт другой аккаунт. С одним человеком могут быть диалоги у нескольких аккаунтов
   * (старый лид удалили, новый написал с другого), а переписка в панели и память бота — одни
   * на человека. Всё, что приходит из «чужого» диалога, в этот чат не пускаем: иначе бот
   * отвечает на старые сообщения другому аккаунту, а номера сообщений (у каждого аккаунта
   * свои) путают галочки прочтения. Случай 15.09: сообщение аккаунту 1 от 09.09 всплыло
   * при перезапуске и получило ответ с аккаунта 14.
   */
  private async ownedByOther(
    chatId: number,
    accountId: number,
  ): Promise<number | null> {
    const owner = await this.history.chatOwnerAccount(chatId);
    return owner !== null && owner !== accountId ? owner : null;
  }

  private async onReadHistory(
    account: LiveAccount,
    update: Api.UpdateReadHistoryOutbox | Api.UpdateReadHistoryInbox,
  ): Promise<void> {
    if (this.stopping || !(update?.peer instanceof Api.PeerUser)) return;
    const chatId = Number(update.peer.userId);
    if (await this.ownedByOther(chatId, account.id)) return;
    const side =
      update instanceof Api.UpdateReadHistoryOutbox ? 'outbox' : 'inbox';
    await this.history
      .markTelegramRead(chatId, side, update.maxId)
      .catch((e) =>
        this.log.warn(`read mark failed chat=${chatId}: ${e?.message ?? e}`),
      );
  }

  private async onUserTyping(
    account: LiveAccount,
    update: Api.UpdateUserTyping,
  ): Promise<void> {
    if (this.stopping || !update?.userId) return;
    const chatId = Number(update.userId);
    if (await this.ownedByOther(chatId, account.id)) return;
    this.presence.setActivity(chatId, typingKind(update.action));
  }

  /**
   * Аватарка собеседника: качаем, когда фото новое (другой photoId) или файла нет;
   * убрал фото или скрыл его — удаляем, панель покажет инициалы. Не мешает ответу:
   * ошибка скачивания только в журнал.
   */
  private async rememberAvatar(
    account: LiveAccount,
    chatId: number,
    user: Api.User,
  ): Promise<void> {
    const path = this.presence.avatarPath(chatId);
    const photo =
      user.photo instanceof Api.UserProfilePhoto ? user.photo : null;
    const facts = await this.history.getLeadFacts(chatId);
    if (!photo) {
      if (user.photo instanceof Api.UserProfilePhotoEmpty && existsSync(path)) {
        rmSync(path, { force: true });
        await this.history.mergeLeadFacts(
          chatId,
          { _avatar_photo_id: null },
          false,
        );
      }
      return;
    }
    const photoId = photo.photoId.toString();
    if (facts['_avatar_photo_id'] === photoId && existsSync(path)) return;
    try {
      const buffer = await this.call(
        account,
        'downloadProfilePhoto',
        () => account.client.downloadProfilePhoto(user, { isBig: false }),
        TG_FILE_TIMEOUT_MS,
      );
      if (!buffer || typeof buffer === 'string' || !buffer.length) return;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, buffer);
      await this.history.mergeLeadFacts(
        chatId,
        { _avatar_photo_id: photoId },
        false,
      );
    } catch (e) {
      this.log.warn(
        `avatar download failed chat=${chatId}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * Фото профиля нашего аккаунта — во вкладку «Аккаунты». Качаем при каждом подключении
   * (их десяток, файлы маленькие): сменили фото в Telegram — после переподключения оно новое.
   */
  private async rememberOwnAvatar(
    account: LiveAccount,
    me: Api.User,
  ): Promise<void> {
    const path = this.presence.accountAvatarPath(account.id);
    try {
      if (!(me.photo instanceof Api.UserProfilePhoto)) {
        rmSync(path, { force: true });
        return;
      }
      const buffer = await this.call(
        account,
        'downloadProfilePhoto me',
        () => account.client.downloadProfilePhoto(me, { isBig: false }),
        TG_FILE_TIMEOUT_MS,
      );
      if (!buffer || typeof buffer === 'string' || !buffer.length) return;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, buffer);
    } catch (e) {
      this.log.warn(
        `account ${account.id}: own avatar download failed: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * Имя и ник нашего аккаунта в самом Telegram. Возвращает то, что Telegram сохранил
   * (перечитывает профиль), и сразу обновляет подпись во вкладке «Аккаунты».
   * Ошибки RPC пробрасываются как есть — перевод словами в `profileErrorText`.
   */
  async updateOwnProfile(
    accountId: number,
    patch: { firstName?: string; lastName?: string; username?: string },
  ): Promise<{ displayName: string | null; username: string | null }> {
    const entry = this.live.get(accountId);
    if (!entry) throw new Error('аккаунт не в сети — сначала подключите его');
    if (patch.firstName !== undefined || patch.lastName !== undefined) {
      await this.call(entry, 'updateProfile', () =>
        entry.client.invoke(
          new Api.account.UpdateProfile({
            firstName: patch.firstName,
            lastName: patch.lastName ?? '',
          }),
        ),
      );
    }
    if (patch.username !== undefined) {
      try {
        await this.call(entry, 'updateUsername', () =>
          entry.client.invoke(
            new Api.account.UpdateUsername({ username: patch.username ?? '' }),
          ),
        );
      } catch (e) {
        if (
          !/USERNAME_NOT_MODIFIED/.test(
            String(
              (e as { errorMessage?: string })?.errorMessage ??
                (e as Error)?.message,
            ),
          )
        )
          throw e;
      }
    }
    return this.refreshOwnProfile(entry);
  }

  /**
   * Удалить переписку с человеком в Telegram у обоих (`revoke`): у нашего аккаунта и у него.
   * Telegram удаляет порциями — повторяем, пока не скажет, что всё. Сущность собеседника
   * после перезапуска может быть не в кеше клиента: тогда ищем по нику или среди диалогов.
   */
  async deleteDialogForEveryone(
    accountId: number,
    chatId: number,
    hint: { username?: string | null } = {},
  ): Promise<void> {
    const entry = this.live.get(accountId);
    if (!entry) throw new Error(`аккаунт #${accountId} не в сети`);
    let peer: Api.TypeInputPeer | null = null;
    try {
      peer = await this.call(entry, 'getInputEntity', () =>
        entry.client.getInputEntity(chatId),
      );
    } catch {
      if (hint.username)
        peer = await this.call(entry, 'getInputEntity @username', () =>
          entry.client.getInputEntity(hint.username!),
        ).catch(() => null);
      if (!peer) {
        await this.call(entry, 'getDialogs', () =>
          entry.client.getDialogs({ limit: 200 }),
        );
        peer = await this.call(entry, 'getInputEntity', () =>
          entry.client.getInputEntity(chatId),
        ).catch(() => null);
      }
    }
    if (!peer) throw new Error('чат не найден у этого аккаунта');
    for (let round = 0; round < 50; round += 1) {
      const r = await this.call(entry, 'deleteHistory', () =>
        entry.client.invoke(
          new Api.messages.DeleteHistory({
            peer: peer!,
            maxId: 0,
            revoke: true,
          }),
        ),
      );
      if (!(r instanceof Api.messages.AffectedHistory) || !r.offset) break;
    }
  }

  /** Новое фото профиля аккаунта (JPEG). Старые фото Telegram хранит в истории профиля. */
  async setOwnPhoto(
    accountId: number,
    jpeg: Buffer,
  ): Promise<{ displayName: string | null; username: string | null }> {
    const entry = this.live.get(accountId);
    if (!entry) throw new Error('аккаунт не в сети — сначала подключите его');
    const file = new CustomFile('avatar.jpg', jpeg.length, '', jpeg);
    const uploaded = await this.call(
      entry,
      'uploadFile avatar',
      () => entry.client.uploadFile({ file, workers: 1 }),
      TG_FILE_TIMEOUT_MS,
    );
    await this.call(
      entry,
      'uploadProfilePhoto',
      () =>
        entry.client.invoke(
          new Api.photos.UploadProfilePhoto({ file: uploaded }),
        ),
      TG_FILE_TIMEOUT_MS,
    );
    await this.dropOldPhotos(entry);
    return this.refreshOwnProfile(entry);
  }

  /**
   * Старые фото профиля после загрузки новой. Telegram складывает их в галерею, и
   * собеседник листает всю историю аватарок — у легенды это лишнее: остаётся только
   * свежее фото. Ошибку сюда не пробрасываем: новое фото уже стоит.
   */
  private async dropOldPhotos(entry: LiveAccount): Promise<void> {
    try {
      const photos = await this.call(
        entry,
        'getUserPhotos',
        () =>
          entry.client.invoke(
            new Api.photos.GetUserPhotos({
              userId: 'me',
              offset: 0,
              maxId: bigInt(0),
              limit: 100,
            }),
          ),
        TG_FILE_TIMEOUT_MS,
      );
      const list = 'photos' in photos ? photos.photos : [];
      // Первая в списке — только что загруженная; удаляем всё, что под ней.
      const old = list
        .slice(1)
        .filter((p): p is Api.Photo => p instanceof Api.Photo);
      if (!old.length) return;
      await this.call(
        entry,
        'deletePhotos',
        () =>
          entry.client.invoke(
            new Api.photos.DeletePhotos({
              id: old.map(
                (p) =>
                  new Api.InputPhoto({
                    id: p.id,
                    accessHash: p.accessHash,
                    fileReference: p.fileReference,
                  }),
              ),
            }),
          ),
        TG_FILE_TIMEOUT_MS,
      );
      this.log.log(
        `account ${entry.id}: убрал ${old.length} прежних фото профиля`,
      );
    } catch (e) {
      this.log.warn(
        `account ${entry.id}: прежние фото профиля убрать не вышло: ${(e as Error)?.message ?? e}`,
      );
    }
  }

  /** Перечитать свой профиль: имя и ник — в базу, фото — в файл для панели. */
  private async refreshOwnProfile(
    entry: LiveAccount,
  ): Promise<{ displayName: string | null; username: string | null }> {
    const me = await this.call(entry, 'getMe', () => entry.client.getMe());
    const displayName =
      me instanceof Api.User
        ? [me.firstName, me.lastName].filter(Boolean).join(' ').trim() || null
        : null;
    const username = me instanceof Api.User ? (me.username ?? null) : null;
    await this.prisma.tgAccount.update({
      where: { id: entry.id },
      data: { displayName, username },
    });
    if (me instanceof Api.User) await this.rememberOwnAvatar(entry, me);
    return { displayName, username };
  }

  /** Номер и ник собеседника, если Telegram их показывает: колонка «Телефон» в диалогах. */
  private async rememberPeer(
    chatId: number,
    user: Api.User | null,
    account?: LiveAccount,
  ): Promise<void> {
    if (!user) return;
    if (account) void this.rememberAvatar(account, chatId, user);
    const presence = clientPresence(user.status);
    if (presence)
      await this.history
        .saveClientPresence(chatId, presence, this.clock.ts())
        .catch(() => undefined);
    const patch: Record<string, string> = {};
    if (user.phone)
      patch['phone'] = `+${String(user.phone).replace(/^\+/, '')}`;
    if (user.username) patch['tg_username'] = user.username;
    if (!Object.keys(patch).length) return;
    await this.history
      .mergeLeadFacts(chatId, patch, true)
      .catch(() => undefined);
  }

  private async onDeleted(
    account: LiveAccount,
    update: Api.UpdateDeleteMessages,
  ): Promise<void> {
    if (this.stopping || !update?.messages?.length) return;
    try {
      await this.brain.handleDeleted(account.id, update.messages);
    } catch (e) {
      this.log.warn(
        `delete handling failed account=${account.id}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * Messages that arrived while the account was offline. GramJS delivers live
   * updates only, so after connecting we walk private dialogs with unread
   * messages and hand the unread tail to the brain as ONE turn per chat — a
   * person who wrote three lines gets one answer, not three. Ids the brain
   * already stored are skipped, so a restart mid-conversation never
   * double-replies — unless the chat's last stored turn is the client's: then
   * the reply itself failed (a model error before a restart), and the stored
   * tail is replayed so the person is not left hanging.
   */
  private async catchUp(account: LiveAccount): Promise<void> {
    const dialogs = account.client.iterDialogs({})[Symbol.asyncIterator]();
    for (;;) {
      const next = await this.call(account, 'catch-up dialogs', () =>
        dialogs.next(),
      );
      if (next.done || this.stopping) break;
      const dialog = next.value;
      const user = dialog.entity;
      if (!dialog.isUser || !(user instanceof Api.User)) continue;
      const chatId = Number(user.id);
      if (
        !isConversableUser(user, chatId) ||
        (await this.ownedByOther(chatId, account.id))
      )
        continue;
      const known = await this.history.latestSourceMessageId(chatId);
      const unanswered = (await this.history.lastStoredRole(chatId)) === 'user';
      if (!dialog.unreadCount && !unanswered && !known) continue;
      // Hold generation throughout the batch, while keeping each message's identity and original time.
      const release = this.brain.observeIncoming?.(chatId, account.id, -1);
      try {
        await this.rememberPeer(chatId, user, account);
        const messages = account.client
          .iterMessages(
            user,
            known
              ? { minId: known, reverse: true }
              : { limit: Math.max(dialog.unreadCount, 1) },
          )
          [Symbol.asyncIterator]();
        const batch: Api.Message[] = [];
        for (;;) {
          const nextMessage = await this.call(
            account,
            'catch-up messages',
            () => messages.next(),
          );
          if (nextMessage.done || this.stopping) break;
          const message = nextMessage.value;
          if (message instanceof Api.Message) batch.push(message);
        }
        batch.sort((a, b) => a.id - b.id);
        for (const message of batch) {
          if (message.out) {
            await this.importOutgoing(account, message);
            continue;
          }
          const media = await this.downloadMedia(account, message);
          await this.brain.handleInbound({
            chatId,
            accountId: account.id,
            messageId: message.id,
            text: message.message ?? '',
            ts: message.date,
            media,
          });
        }
        await this.brain.answerAfterResume(chatId);
        await this.history.markTelegramRead(
          chatId,
          'outbox',
          dialog.dialog.readOutboxMaxId,
        );
        await this.history.markTelegramRead(
          chatId,
          'inbox',
          dialog.dialog.readInboxMaxId,
        );
      } catch (e) {
        this.log.error(`catch-up failed chat=${chatId}: ${e?.message ?? e}`);
      } finally {
        release?.();
      }
    }
  }

  private async downloadMedia(
    account: LiveAccount,
    message: Api.Message,
    opts: { download?: boolean } = {},
  ): Promise<InboundMedia | null> {
    if (!message.media) return null;
    let kind: InboundMedia['kind'] | null = null;
    let emoji: string | undefined;
    let duration: number | undefined;
    if (message.photo) kind = 'photo';
    else if (message.voice) {
      kind = 'voice';
      duration =
        message.voice instanceof Api.Document
          ? this.docDuration(message.voice)
          : undefined;
    } else if (message.videoNote) kind = 'video_note';
    else if (message.sticker) {
      kind = 'sticker';
      const attr = message.sticker.attributes.find(
        (a) => a instanceof Api.DocumentAttributeSticker,
      ) as Api.DocumentAttributeSticker | undefined;
      emoji = attr?.alt;
    } else if (message.gif) kind = 'animation';
    else if (message.video) kind = 'video';
    else if (message.document) kind = 'document';
    if (!kind) return null;
    if (kind === 'video' || kind === 'video_note' || kind === 'animation') {
      const doc = (message.videoNote ?? message.video ?? message.gif) as
        Api.Document | undefined;
      duration =
        doc instanceof Api.Document ? this.videoDuration(doc) : undefined;
    }
    // Файл забираем под его собственным именем: панель отдаёт его ссылкой, а без
    // расширения браузер не понял бы, что открывать. Имени нет — по типу содержимого.
    const name = kind === 'document' ? documentName(message.document) : null;
    const ext =
      kind === 'document'
        ? extensionOf(name, message.document)
        : INBOUND_EXT[kind];
    if (!ext || opts.download === false)
      return { kind, emoji, duration, name: name ?? undefined };
    // Большое видео не качаем: панель его всё равно не покажет быстро, а ответ бота ждал бы загрузку.
    const size =
      message.document instanceof Api.Document
        ? Number(message.document.size)
        : 0;
    if (size > INBOUND_MAX_BYTES) return { kind, emoji, duration };

    const path = await this.saveInboundFile(account, message, kind, ext);
    return {
      kind,
      path: path ?? undefined,
      emoji,
      duration,
      name: name ?? undefined,
    };
  }

  /** Скачать вложение сообщения в media/inbound и записать, к какому ходу оно относится. */
  private async saveInboundFile(
    account: LiveAccount,
    message: Api.Message,
    kind: string,
    ext: string,
  ): Promise<string | null> {
    const dir = join(appConfig.mediaDir, 'inbound', String(account.id));
    mkdirSync(dir, { recursive: true });
    const buffer = (await this.call(
      account,
      'downloadMedia',
      () => account.client.downloadMedia(message, {}),
      TG_FILE_TIMEOUT_MS,
    )) as Buffer;
    if (!buffer || !buffer.length) return null;
    const path = join(dir, `${message.chatId}_${message.id}.${ext}`);
    writeFileSync(path, buffer);
    await this.prisma.inboundMedia.create({
      data: {
        chatId: toChatId(Number(message.chatId)),
        msgTs: message.date,
        kind,
        path,
        savedAt: this.clock.ts(),
      },
    });
    return path;
  }

  private videoDuration(doc: Api.Document): number | undefined {
    const attr = doc.attributes.find(
      (a) => a instanceof Api.DocumentAttributeVideo,
    ) as Api.DocumentAttributeVideo | undefined;
    return attr?.duration;
  }

  /**
   * Кружки, видео и гифки, пришедшие, пока их не скачивали (до 17.09 качались только фото
   * и голосовые): при подключении аккаунта догружаем их за последние дни, чтобы в панели
   * вместо «[Кружок]» было видео.
   */
  private async backfillInboundVideos(account: LiveAccount): Promise<void> {
    const since = this.clock.ts() - INBOUND_BACKFILL_DAYS * 86400;
    const rows = await this.prisma.message.findMany({
      where: {
        role: 'user',
        ts: { gte: since },
        sourceMessageId: { not: null },
        OR: [
          { text: { startsWith: '[Кружок]' } },
          { text: { startsWith: '[Видео]' } },
          { text: { startsWith: '[GIF]' } },
        ],
      },
      select: { chatId: true, ts: true, sourceMessageId: true },
    });
    let saved = 0;
    for (const row of rows) {
      const chatId = Number(row.chatId);
      if ((await this.history.chatOwnerAccount(chatId)) !== account.id)
        continue;
      if (
        await this.prisma.inboundMedia.count({
          where: { chatId: row.chatId, msgTs: row.ts },
        })
      )
        continue;
      try {
        const [message] = await this.call(account, 'getMessages', () =>
          account.client.getMessages(chatId, { ids: [row.sourceMessageId!] }),
        );
        if (!(message instanceof Api.Message) || message.out) continue;
        const media = await this.downloadMedia(account, message);
        if (media?.path) {
          await this.history.attachClientFile(
            chatId,
            row.sourceMessageId!,
            media.kind,
            media.path,
          );
          saved += 1;
        }
      } catch (e) {
        this.log.warn(
          `video backfill failed chat=${chatId} msg=${row.sourceMessageId}: ${e?.message ?? e}`,
        );
      }
    }
    if (saved)
      this.log.log(
        `account ${account.id}: downloaded ${saved} earlier video(s)/video note(s)`,
      );
  }

  private docDuration(doc: Api.Document): number | undefined {
    const attr = doc.attributes.find(
      (a) => a instanceof Api.DocumentAttributeAudio,
    ) as Api.DocumentAttributeAudio | undefined;
    return attr?.duration;
  }

  // -- outbound ----------------------------------------------------------------

  private async accountFor(
    chatId: number,
    preferred?: number | null,
  ): Promise<LiveAccount> {
    const ownerId = preferred ?? (await this.history.chatOwnerAccount(chatId));
    const entry = ownerId === null ? null : this.live.get(ownerId);
    if (!entry)
      throw new Error(
        `no online account owns chat ${chatId} (owner=${ownerId})`,
      );
    return entry;
  }

  /**
   * Phone -> Telegram user through `contacts.importContacts` on the given
   * account. `not_found` when the number has no Telegram or hides itself from
   * lookup; `retry` when Telegram put the number into `retryContacts` — the
   * account's contact-import budget is exhausted (fresh accounts hit this a
   * lot), so the number must be tried again later, not written off. The
   * contact is kept: the access hash it caches is what makes the following
   * `sendMessage` to a bare id work. Flood errors propagate.
   */
  async resolvePhone(
    accountId: number,
    phone: string,
    firstName?: string,
  ): Promise<ResolvedPhone> {
    const entry = this.live.get(accountId);
    if (!entry) throw new Error(`account ${accountId} is offline`);
    const result = await this.call(entry, 'importContacts', () =>
      entry.client.invoke(
        new Api.contacts.ImportContacts({
          contacts: [
            new Api.InputPhoneContact({
              clientId: bigInt(Math.floor(Math.random() * 2 ** 31)),
              phone,
              firstName: (firstName ?? '').trim() || 'Контакт',
              lastName: '',
            }),
          ],
        }),
      ),
    );
    const user = result.users.find((u): u is Api.User => u instanceof Api.User);
    this.log.log(
      `importContacts account=${accountId} phone=${phone.slice(0, 5)}… imported=${result.imported.length} users=${result.users.length} retry=${result.retryContacts.length}`,
    );
    if (user)
      return {
        kind: 'found',
        userId: Number(user.id),
        username: user.username ?? null,
        deleted: Boolean(user.deleted),
      };
    if (result.retryContacts.length) return { kind: 'retry' };
    return { kind: 'not_found' };
  }

  /**
   * @username -> Telegram user. Privacy settings do not hide a public
   * username, so this is the fallback for numbers that cannot be looked up.
   * `getEntity` caches the access hash in the session for the send that follows.
   */
  async resolveUsername(
    accountId: number,
    username: string,
  ): Promise<ResolvedPhone> {
    const entry = this.live.get(accountId);
    if (!entry) throw new Error(`account ${accountId} is offline`);
    try {
      const entity = await this.call(entry, `getEntity @${username}`, () =>
        entry.client.getEntity(username),
      );
      if (!(entity instanceof Api.User)) return { kind: 'not_found' }; // a channel or a group behind the name
      return {
        kind: 'found',
        userId: Number(entity.id),
        username: entity.username ?? username,
        deleted: Boolean(entity.deleted),
      };
    } catch (e) {
      const msg = String(e?.errorMessage ?? e?.message ?? '');
      if (
        /USERNAME_NOT_OCCUPIED|USERNAME_INVALID|Cannot find any entity|No user has/i.test(
          msg,
        )
      )
        return { kind: 'not_found' };
      throw e;
    }
  }

  /** Sends text bubbles with a composing pause; returns platform message ids. */
  /** Статус набора. Сбой не ломает отправку, но пишется в лог — раньше он глушился молча. */
  private async setTyping(
    account: LiveAccount,
    chatId: number,
    on: boolean,
  ): Promise<void> {
    try {
      await this.call(
        account,
        'setTyping',
        () =>
          account.client.invoke(
            new Api.messages.SetTyping({
              peer: chatId,
              action: on
                ? new Api.SendMessageTypingAction()
                : new Api.SendMessageCancelAction(),
            }),
          ),
        TG_TYPING_TIMEOUT_MS,
      );
    } catch (e) {
      this.log.warn(
        `typing status failed chat=${chatId} account=${account.id}: ${e?.message ?? e}`,
      );
    }
  }

  /** «Печатает…» заходами: статус подтверждается каждые 4 с и снимается в паузах. */
  private async typeLike(
    account: LiveAccount,
    chatId: number,
    text: string,
    style: TypingStyle,
    signal?: AbortSignal,
  ): Promise<void> {
    const plan = typingPlan(text, style);
    for (const [b, burst] of plan.bursts.entries()) {
      for (let left = burst; left > 0; left -= TYPING_REFRESH_MS) {
        checkCancelled(signal);
        await this.setTyping(account, chatId, true);
        await cancellableSleep(Math.min(left, TYPING_REFRESH_MS), signal);
      }
      if (b < plan.pauses.length) {
        await this.setTyping(account, chatId, false);
        await cancellableSleep(plan.pauses[b], signal);
      }
    }
  }

  async sendText(
    chatId: number,
    parts: string[],
    opts: {
      accountId?: number | null;
      replyTo?: number | null;
      typing?: TypingStyle;
      signal?: AbortSignal;
      beforePart?: () => Promise<void>;
      randomIds?: string[];
      onDispatch?: (index: number) => Promise<void>;
      onPart?: (index: number, tgMsgId: number) => Promise<void>;
    } = {},
  ): Promise<number[]> {
    const account = await this.accountFor(chatId, opts.accountId);
    const style = opts.typing ?? DEFAULT_TYPING;
    const ids: number[] = [];
    try {
      for (const [i, part] of parts.entries()) {
        checkCancelled(opts.signal);
        await opts.beforePart?.();
        if (style.enabled) {
          if (i > 0) await cancellableSleep(partPauseMs(style), opts.signal);
          await this.typeLike(account, chatId, part, style, opts.signal);
        }
        await opts.beforePart?.();
        checkCancelled(opts.signal);
        // Ответом помечается только первая часть: остальные — продолжение той же реплики.
        const sent = await this.deliver(chatId, () =>
          this.call(account, 'sendMessage', () =>
            opts.randomIds?.[i]
              ? this.sendWithRandomId(
                  account,
                  chatId,
                  part,
                  opts.randomIds[i],
                  opts.signal,
                  () => opts.onDispatch?.(i),
                  i === 0 ? opts.replyTo : null,
                )
              : account.client.sendMessage(chatId, {
                  message: part,
                  ...(i === 0 && opts.replyTo ? { replyTo: opts.replyTo } : {}),
                }),
          ),
        );
        if (!Number.isSafeInteger(sent?.id) || sent.id <= 0)
          throw new Error('Telegram не подтвердил message_id');
        ids.push(sent.id);
        await opts.onPart?.(i, sent.id);
      }
      return ids;
    } catch (e) {
      if (opts.signal?.aborted) void this.setTyping(account, chatId, false);
      throw e;
    }
  }

  /** Explicit random_id keeps an uncertain retry tied to the original Telegram message. */
  private async sendWithRandomId(
    account: LiveAccount,
    chatId: number,
    text: string,
    randomId: string,
    signal?: AbortSignal,
    onDispatch?: () => Promise<void | undefined>,
    replyTo?: number | null,
  ): Promise<{ id: number }> {
    const peer = await account.client.getInputEntity(chatId);
    const [message, entities] = await _parseMessageText(
      account.client,
      text,
      undefined,
    );
    checkCancelled(signal);
    const request = new Api.messages.SendMessage({
      peer,
      message,
      entities,
      randomId: bigInt(randomId),
      ...(replyTo
        ? { replyTo: new Api.InputReplyToMessage({ replyToMsgId: replyTo }) }
        : {}),
    });
    await onDispatch?.();
    checkCancelled(signal);
    // Once dispatched, await acknowledgment even if a new inbound cancels later parts.
    const result = await account.client.invoke(request);
    if (result instanceof Api.UpdateShortSentMessage) return { id: result.id };
    const updates =
      result instanceof Api.UpdateShort
        ? [result.update]
        : result instanceof Api.Updates || result instanceof Api.UpdatesCombined
          ? result.updates
          : [];
    const mapping = updates.find(
      (u) =>
        u instanceof Api.UpdateMessageID && u.randomId.toString() === randomId,
    );
    if (mapping instanceof Api.UpdateMessageID) return { id: mapping.id };
    throw new Error(
      'Telegram не подтвердил message_id для сохранённой части ответа',
    );
  }

  /**
   * Вложение: файл из `uploads/`, https-ссылка (Telegram скачает сам) или
   * file_id стикера. Голосовое и кружок Telegram отличает по флагам — без них
   * они уходят обычным файлом и выглядят как пересылка, а не как своя запись.
   */
  async sendMedia(
    chatId: number,
    opts: {
      kind: string;
      beforeSend?: () => Promise<void>;
      /** путь в uploads/, https-ссылка или file_id */
      source: string;
      caption?: string;
      replyTo?: number | null;
      accountId?: number | null;
    },
  ): Promise<number> {
    const account = await this.accountFor(chatId, opts.accountId);
    const reply = opts.replyTo ? { replyTo: opts.replyTo } : {};
    const remote = /^https?:\/\//i.test(opts.source);
    // Показ «печатает/записывает» перед вложением: без него сообщение
    // появляется рывком, чего у живого собеседника не бывает.
    // Кружок свой статус показывает сам, в sendVideoNote.
    if (!(opts.kind === 'video_note' && !remote)) {
      await account.client
        .invoke(
          new Api.messages.SetTyping({
            peer: chatId,
            action:
              opts.kind === 'voice'
                ? new Api.SendMessageRecordAudioAction()
                : opts.kind === 'photo'
                  ? new Api.SendMessageUploadPhotoAction({ progress: 0 })
                  : opts.kind === 'video'
                    ? new Api.SendMessageUploadVideoAction({ progress: 0 })
                    : new Api.SendMessageUploadDocumentAction({ progress: 0 }),
          }),
        )
        .catch(() => undefined);
    }

    // Голосовое из вложения панели — той же дорогой, что и клип войсера: с перекодировкой.
    if (opts.kind === 'video_note' && !remote) {
      const id = await this.sendVideoNote(chatId, opts.source, opts.accountId);
      if (opts.caption)
        await this.sendText(chatId, [opts.caption], {
          accountId: opts.accountId,
          typing: { ...DEFAULT_TYPING, enabled: false },
        });
      return id;
    }

    if (opts.kind === 'voice' && !remote) {
      const id = await this.sendVoiceFile(
        chatId,
        opts.source,
        opts.accountId,
        opts.beforeSend,
      );
      if (opts.caption)
        await this.sendText(chatId, [opts.caption], {
          accountId: opts.accountId,
          typing: { ...DEFAULT_TYPING, enabled: false },
        });
      return id;
    }

    let file: unknown = opts.source;
    if (!remote && opts.kind !== 'sticker') {
      const buffer = readFileSync(opts.source);
      file = new CustomFile(
        basename(opts.source),
        buffer.length,
        opts.source,
        buffer,
      );
    }
    const sent = await this.deliver(chatId, () =>
      this.call(
        account,
        'sendFile',
        () =>
          account.client.sendFile(chatId, {
            file: file as never,
            caption: opts.caption || undefined,
            voiceNote: opts.kind === 'voice',
            videoNote: opts.kind === 'video_note',
            forceDocument: opts.kind === 'document',
            ...reply,
          }),
        TG_FILE_TIMEOUT_MS,
      ),
    );
    if (!sent?.id) throw new Error('Telegram не подтвердил message_id');
    return sent.id;
  }

  /**
   * Несколько фото и видео одним альбомом, как из приложения Telegram. Подпись — у
   * первого. Возвращает id сообщений альбома по порядку файлов.
   */
  async sendAlbum(
    chatId: number,
    paths: string[],
    opts: {
      caption?: string;
      replyTo?: number | null;
      accountId?: number | null;
    } = {},
  ): Promise<number[]> {
    const account = await this.accountFor(chatId, opts.accountId);
    const files = paths.map((path) => {
      const buffer = readFileSync(path);
      return new CustomFile(basename(path), buffer.length, path, buffer);
    });
    await account.client
      .invoke(
        new Api.messages.SetTyping({
          peer: chatId,
          action: new Api.SendMessageUploadPhotoAction({ progress: 0 }),
        }),
      )
      .catch(() => undefined);
    const sent = (await this.deliver(chatId, () =>
      this.call(
        account,
        'sendFile album',
        () =>
          account.client.sendFile(chatId, {
            file: files as never,
            caption: [
              opts.caption ?? '',
              ...files.slice(1).map(() => ''),
            ] as never,
            ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
          }),
        TG_FILE_TIMEOUT_MS * 2,
      ),
    )) as unknown as Api.Message | Api.Message[];
    const list = Array.isArray(sent) ? sent : [sent];
    if (!list.length || list.some((m) => !m?.id))
      throw new Error('Telegram не подтвердил альбом');
    return list.map((m) => m.id);
  }

  /**
   * Держит статус у собеседника («записывает голосовое…», «записывает видеосообщение…»)
   * `ms` миллисекунд: Telegram гасит статус через ~6 с, поэтому он подтверждается
   * каждые 4 с. Сбой статуса отправку не ломает.
   */
  private async holdActivity(
    account: LiveAccount,
    chatId: number,
    action: () => Api.TypeSendMessageAction,
    ms: number,
  ): Promise<void> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await this.call(
        account,
        'setTyping',
        () =>
          account.client.invoke(
            new Api.messages.SetTyping({ peer: chatId, action: action() }),
          ),
        TG_TYPING_TIMEOUT_MS,
      ).catch(() => undefined);
      await sleep(Math.min(TYPING_REFRESH_MS, Math.max(0, until - Date.now())));
    }
  }

  /** Исправить отправленный текст. */
  async editText(chatId: number, tgMsgId: number, text: string): Promise<void> {
    const account = await this.accountFor(chatId);
    await this.call(account, 'editMessage', () =>
      account.client.editMessage(chatId, { message: tgMsgId, text }),
    );
  }

  /**
   * Сообщение изменили в Telegram: собеседник своё или мы с телефона. Лента и память
   * бота получают новый текст. Вложения не трогаем: у них в ленте метка, а не текст.
   */
  private async onEdited(
    account: LiveAccount,
    update: Api.UpdateEditMessage,
  ): Promise<void> {
    const message = update?.message;
    if (
      this.stopping ||
      !(message instanceof Api.Message) ||
      !(message.peerId instanceof Api.PeerUser)
    )
      return;
    const chatId = Number(message.peerId.userId);
    if (await this.ownedByOther(chatId, account.id)) return;
    if (message.media && !(message.media instanceof Api.MessageMediaWebPage))
      return;
    const text = message.message ?? '';
    if (!text.trim()) return;
    try {
      const changed = await this.history.editMessageText(
        chatId,
        { tgMsgId: message.id },
        text,
        message.editDate ?? this.clock.ts(),
      );
      if (changed)
        await this.brain.noteEdited(
          chatId,
          changed.role === 'user' ? 'user' : 'assistant',
          changed.old,
          text,
          changed.id,
        );
    } catch (e) {
      this.log.warn(`edit handling failed chat=${chatId}: ${e?.message ?? e}`);
    }
  }

  /** «Был в сети» у самого аккаунта: скрыт от всех или виден всем. */
  async lastSeenHidden(accountId: number): Promise<boolean> {
    const entry = this.live.get(accountId);
    if (!entry) throw new Error(`аккаунт #${accountId} не в сети`);
    const r = await this.call(entry, 'getPrivacy', () =>
      entry.client.invoke(
        new Api.account.GetPrivacy({
          key: new Api.InputPrivacyKeyStatusTimestamp(),
        }),
      ),
    );
    return r.rules.some((rule) => rule instanceof Api.PrivacyValueDisallowAll);
  }

  async setLastSeenHidden(
    accountId: number,
    hidden: boolean,
  ): Promise<boolean> {
    const entry = this.live.get(accountId);
    if (!entry) throw new Error(`аккаунт #${accountId} не в сети`);
    const r = await this.call(entry, 'setPrivacy', () =>
      entry.client.invoke(
        new Api.account.SetPrivacy({
          key: new Api.InputPrivacyKeyStatusTimestamp(),
          rules: [
            hidden
              ? new Api.InputPrivacyValueDisallowAll()
              : new Api.InputPrivacyValueAllowAll(),
          ],
        }),
      ),
    );
    return r.rules.some((rule) => rule instanceof Api.PrivacyValueDisallowAll);
  }

  /** Наборы стикеров и сохранённые гифки самого аккаунта — их и предлагаем оператору. */
  async savedGifs(
    accountId: number,
  ): Promise<{ id: string; url: string | null }[]> {
    const entry = this.live.get(accountId);
    if (!entry) throw new Error(`account ${accountId} is offline`);
    const res = await this.call(entry, 'getSavedGifs', () =>
      entry.client.invoke(new Api.messages.GetSavedGifs({ hash: bigInt(0) })),
    );
    if (!(res instanceof Api.messages.SavedGifs)) return [];
    return res.gifs
      .filter((g): g is Api.Document => g instanceof Api.Document)
      .map((g) => ({ id: `${g.id.toString()}`, url: null }));
  }

  /**
   * Голосовое сообщение из файла: mp3, m4a, wav и запись из браузера перекодируются
   * в ogg/opus — иначе Telegram показывает их обычным аудио, а не голосовым.
   */
  async sendVoiceFile(
    chatId: number,
    path: string,
    accountId?: number | null,
    beforeSend?: () => Promise<void>,
  ): Promise<number> {
    const account = await this.accountFor(chatId, accountId);
    const voice = await this.voiceEncoder.prepare(path);
    try {
      await this.holdActivity(
        account,
        chatId,
        () => new Api.SendMessageRecordAudioAction(),
        recordingMs(voice.duration),
      );
      const buffer = readFileSync(voice.path);
      const file = new CustomFile(
        'voice.ogg',
        buffer.length,
        voice.path,
        buffer,
      );
      // Revalidate after encoding and simulated recording, immediately before the media RPC.
      await beforeSend?.();
      const sent = await this.deliver(chatId, () =>
        this.call(
          account,
          'sendFile voice',
          () =>
            account.client.sendFile(chatId, {
              file,
              voiceNote: true,
              attributes: [
                new Api.DocumentAttributeAudio({
                  voice: true,
                  duration: voice.duration,
                }),
              ],
            }),
          TG_FILE_TIMEOUT_MS,
        ),
      );
      return sent.id;
    } finally {
      this.voiceEncoder.cleanup(voice);
    }
  }

  /**
   * Кружок: видео готовится в квадрат 480×480, собеседник видит «записывает
   * видеосообщение…» столько, сколько длится запись, и получает именно кружок.
   */
  async sendVideoNote(
    chatId: number,
    path: string,
    accountId?: number | null,
  ): Promise<number> {
    const account = await this.accountFor(chatId, accountId);
    const round = await this.voiceEncoder.prepareRound(path);
    try {
      await this.holdActivity(
        account,
        chatId,
        () => new Api.SendMessageRecordRoundAction(),
        recordingMs(round.duration),
      );
      const buffer = readFileSync(round.path);
      const file = new CustomFile(
        'round.mp4',
        buffer.length,
        round.path,
        buffer,
      );
      const sent = await this.deliver(chatId, () =>
        this.call(
          account,
          'sendFile round',
          () =>
            account.client.sendFile(chatId, {
              file,
              videoNote: true,
              attributes: [
                new Api.DocumentAttributeVideo({
                  roundMessage: true,
                  supportsStreaming: true,
                  duration: round.duration,
                  w: ROUND_SIDE,
                  h: ROUND_SIDE,
                }),
              ],
            }),
          TG_FILE_TIMEOUT_MS,
        ),
      );
      if (!sent?.id) throw new Error('Telegram не подтвердил кружок');
      return sent.id;
    } finally {
      this.voiceEncoder.cleanup(round);
    }
  }

  async markRead(chatId: number, accountId?: number | null): Promise<void> {
    const account = await this.accountFor(chatId, accountId);
    await this.call(account, 'markAsRead', () =>
      account.client.markAsRead(chatId),
    );
    // Своё прочтение Telegram этому же клиенту не присылает — отмечаем сами.
    await this.history.markTelegramRead(
      chatId,
      'inbox',
      await this.history.latestClientTgId(chatId),
    );
  }

  async markListened(
    chatId: number,
    messageIds: number[],
    accountId?: number | null,
  ): Promise<void> {
    if (!messageIds.length) return;
    const account = await this.accountFor(chatId, accountId);
    await this.call(account, 'readMessageContents', () =>
      account.client.invoke(
        new Api.messages.ReadMessageContents({ id: messageIds }),
      ),
    );
  }

  async sendReaction(
    chatId: number,
    messageId: number,
    emoji: string,
  ): Promise<void> {
    const account = await this.accountFor(chatId);
    await this.call(account, 'sendReaction', () =>
      account.client.invoke(
        new Api.messages.SendReaction({
          peer: chatId,
          msgId: messageId,
          reaction: [new Api.ReactionEmoji({ emoticon: emoji })],
        }),
      ),
    );
  }

  /** Voice clip from the voicer: send, then record the turn as the persona's. */
  async sendVoice(chatId: number, path: string, text: string): Promise<void> {
    const tgMsgId = await this.sendVoiceFile(chatId, path);
    const ts = this.clock.ts();
    await this.history.appendMessage(chatId, {
      role: 'assistant',
      text: text ? `[Голосовое сообщение]\n${text}` : '[media:voice]',
      ts,
      author: 'operator:voice',
      tgMsgId,
      mediaKind: 'voice',
      filePath: path,
    });
    await this.prisma.mediaShown.upsert({
      where: { chatId_path: { chatId: toChatId(chatId), path } },
      create: { chatId: toChatId(chatId), path, shownTs: ts, kind: 'voice' },
      update: { shownTs: ts },
    });
    await this.brain.noteOperatorMessage(chatId);
  }
}
