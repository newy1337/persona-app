import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ChannelTransport, ResolvedPeer } from 'src/channels/channel';
import { chatIdFor, peerOf } from 'src/channels/ids';
import { ChannelRegistry } from 'src/channels/registry';
import { VkApi } from 'src/channels/vk/api';
import {
  VkAccountBanned,
  VkApiError,
  VkSessionExpired,
  isTerminal,
} from 'src/channels/vk/errors';
import { browserHttp } from 'src/channels/vk/http';
import {
  decodeEvent,
  fromDto,
  inboundMedia,
  inboundText,
  isPersonPeer,
  liftForwardedVoice,
  type VkEvent,
  type VkMessage,
} from 'src/channels/vk/inbound';
import {
  CursorCommitter,
  CursorFile,
  VkLongPoll,
} from 'src/channels/vk/longpoll';
import { VkMessages } from 'src/channels/vk/messages';
import { VkTokenProvider, type VkSessionData } from 'src/channels/vk/session';
import {
  REPLY_BRAIN,
  type InboundMedia,
  type ReplyBrain,
} from 'src/brain/reply-brain.port';
import { appConfig } from 'src/config/app.config';
import { offlineReasonOf } from 'src/domain/offline-reason';
import { toProxyUrl } from 'src/domain/proxy';
import {
  DEFAULT_TYPING,
  partPauseMs,
  typingPlan,
  type TypingStyle,
} from 'src/domain/typing';
import { PrismaService } from 'src/prisma.service';
import { cancellableSleep, checkCancelled } from 'src/shared/cancellation';
import { ClockService } from 'src/shared/clock.service';
import { CryptoService } from 'src/shared/crypto.service';
import { HistoryService } from 'src/shared/history.service';
import { PresenceService } from 'src/shared/presence.service';
import { toChatId } from 'src/utils/ids';

/**
 * Пир «контакта» VK (1 900 000 000 + id контакта): диалог, начатый по номеру
 * (account.importMessagesContacts, как «Написать по номеру» в веб-VK). Ответ
 * человека приходит с его настоящего id — его склеиваем с чатом контакта.
 */
const CONTACT_PEER_BASE = 1_900_000_000;
const CHAT_PEER_MIN = 2_000_000_000;
/** Контактов в одном messages.getContactsById. */
const CONTACTS_BATCH = 100;
const CONTACTS_MAX = 5000;
/** Нет такого пользователя (users.get по нику). */
const INVALID_USER = 113;
/** «Печатает» VK держит 5–10 с; переставляем чаще. */
const TYPING_REFRESH_MS = 5_000;
/** Событие «печатает» старше — из догрузки, не живое. */
const TYPING_FRESH_S = 5;
const INBOUND_MAX_BYTES = 50 * 1024 * 1024;
/** Сторож: раз в минуту поднимает активные аккаунты, которые не в сети. */
const REVIVE_MS = 60_000;

interface LiveVk {
  id: number;
  /** id пользователя VK самого аккаунта. */
  peerId: number;
  api: VkApi;
  messages: VkMessages;
  abort: AbortController;
  /** Настоящий id собеседника → пир контакта (лид по номеру). */
  contacts: Map<number, number>;
  /** Проверенные собеседники без контакта. */
  plain: Set<number>;
  /** Есть контакты без связи с настоящим id или завели новый — перечитать. */
  contactsStale: boolean;
}

/**
 * Канал VK: аккаунты с channel='vk' в channel_accounts. Подключение — куки
 * сессии и прокси (без браузера: web_token выпускается по кукам), входящие —
 * Long Poll, исходящие — VK API тем же прокси. Остальной код видит VK через
 * ChannelRegistry так же, как Telegram.
 */
@Injectable()
export class VkService
  implements ChannelTransport, OnModuleInit, OnModuleDestroy
{
  private readonly log = new Logger(VkService.name);
  private readonly live = new Map<number, LiveVk>();
  private readonly connecting = new Map<number, Promise<void>>();
  private readonly failures = new Map<number, { reason: string; at: number }>();
  private readonly held = new Set<number>();
  private stopping = false;
  private reviveTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly clock: ClockService,
    private readonly history: HistoryService,
    private readonly presence: PresenceService,
    private readonly registry: ChannelRegistry,
    @Inject(forwardRef(() => REPLY_BRAIN)) private readonly brain: ReplyBrain,
  ) {}

  get channel(): 'vk' {
    return 'vk';
  }

  /** Сколько активных VK-аккаунтов с сессией видел сторож. */
  private accountsKnown = 0;

  /**
   * Ключей на сервере VK не нужно — у каждого аккаунта свои куки и прокси.
   * Канал «настроен», когда есть хоть один VK-аккаунт.
   */
  get configured(): boolean {
    return this.accountsKnown > 0 || this.live.size > 0;
  }

  onModuleInit(): void {
    this.registry.register(this);
    if (process.env.NODE_ENV === 'test') return;
    void this.reviveOffline();
    this.reviveTimer = setInterval(() => void this.reviveOffline(), REVIVE_MS);
    this.reviveTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.reviveTimer) clearInterval(this.reviveTimer);
    for (const id of [...this.live.keys()])
      await this.disconnect(id, { hold: false });
  }

  // ── Аккаунты ──────────────────────────────────────────────────────────────

  isOnline(accountId: number): boolean {
    return this.live.has(accountId);
  }

  onlineIds(): number[] {
    return [...this.live.keys()];
  }

  offlineReason(accountId: number): string | null {
    if (this.live.has(accountId)) return null;
    if (this.held.has(accountId))
      return 'отключён: аккаунт не активен (пауза, выведен или вход не выполнен)';
    const f = this.failures.get(accountId);
    if (this.connecting.has(accountId))
      return f
        ? `переподключается — прошлая попытка: ${f.reason}`
        : 'подключается';
    return f ? f.reason : 'не подключён';
  }

  async reviveOffline(): Promise<void> {
    if (this.stopping) return;
    const rows = await this.prisma.channelAccount
      .findMany({
        where: {
          channel: 'vk',
          status: 'active',
          sessionEncrypted: { not: null },
        },
        select: { id: true },
      })
      .catch(() => []);
    this.accountsKnown = rows.length;
    for (const { id } of rows)
      if (!this.live.has(id) && !this.held.has(id))
        void this.connect(id).catch(() => undefined);
  }

  async connect(accountId: number): Promise<void> {
    this.held.delete(accountId);
    if (this.live.has(accountId)) return;
    const pending = this.connecting.get(accountId);
    if (pending) return pending;
    const work = this.connectNow(accountId)
      .then(() => {
        this.failures.delete(accountId);
      })
      .catch(async (e) => {
        this.failures.set(accountId, {
          reason: offlineReasonOf(e),
          at: this.clock.ts(),
        });
        await this.onAccountError(accountId, e);
        throw e;
      })
      .finally(() => this.connecting.delete(accountId));
    this.connecting.set(accountId, work);
    return work;
  }

  async disconnect(
    accountId: number,
    { hold = true }: { hold?: boolean } = {},
  ): Promise<void> {
    if (hold) this.held.add(accountId);
    const entry = this.live.get(accountId);
    if (!entry) return;
    this.live.delete(accountId);
    entry.abort.abort();
  }

  async reconnect(accountId: number): Promise<void> {
    await this.disconnect(accountId, { hold: false });
    await this.connect(accountId);
  }

  private async connectNow(accountId: number): Promise<void> {
    const acc = await this.prisma.channelAccount.findUnique({
      where: { id: accountId },
    });
    if (!acc || acc.channel !== 'vk')
      throw new Error(`account ${accountId} is not a VK account`);
    if (!acc.sessionEncrypted)
      throw new Error(`account ${accountId} has no session`);
    const session = JSON.parse(
      this.crypto.decrypt(acc.sessionEncrypted),
    ) as VkSessionData;
    const proxyUrl = toProxyUrl(
      acc.proxyConfigEncrypted
        ? JSON.parse(this.crypto.decrypt(acc.proxyConfigEncrypted))
        : null,
    );
    const http = browserHttp({ proxyUrl, userAgent: session.userAgent });
    const tokens = new VkTokenProvider(http, session, {
      // VK ротирует куки на ходу: без записи рестарт поднимет старые, и сессия умрёт.
      onCookies: async (data) => {
        await this.prisma.channelAccount.update({
          where: { id: accountId },
          data: { sessionEncrypted: this.crypto.encrypt(JSON.stringify(data)) },
        });
      },
    });
    const api = new VkApi(http, tokens);
    const [me] = await api.call<
      Array<{
        id: number;
        first_name?: string;
        last_name?: string;
        screen_name?: string;
      }>
    >('users.get', { fields: 'screen_name' });
    if (!me?.id) throw new Error('VK не отдал профиль аккаунта');
    const entry: LiveVk = {
      id: accountId,
      peerId: me.id,
      api,
      messages: new VkMessages(api),
      abort: new AbortController(),
      contacts: new Map(),
      plain: new Set(),
      contactsStale: true,
    };
    this.live.set(accountId, entry);
    await this.prisma.channelAccount.update({
      where: { id: accountId },
      data: {
        lastLoginAt: this.clock.ts(),
        lastHeartbeatAt: this.clock.ts(),
        peerId: BigInt(me.id),
        username: me.screen_name ?? null,
        displayName:
          [me.first_name, me.last_name].filter(Boolean).join(' ').trim() ||
          null,
      },
    });
    this.log.log(
      `vk account ${accountId} online as ${me.screen_name ?? `id${me.id}`}`,
    );
    void this.run(entry);
  }

  /**
   * Нужен человек (сессия умерла, капча, бан): помечаем аккаунт, как
   * Telegram помечает заблокированный, и больше не подключаем.
   */
  private async onAccountError(accountId: number, e: unknown): Promise<void> {
    if (!(e instanceof VkSessionExpired) && !isTerminal(e)) return;
    const status = e instanceof VkAccountBanned ? 'banned' : 'unauthorized';
    const reason =
      e instanceof VkAccountBanned
        ? 'VK заблокировал аккаунт'
        : e instanceof VkSessionExpired
          ? 'сессия VK завершена — нужен вход заново'
          : `VK требует действия человека: ${(e as Error).message}`;
    await this.prisma.channelAccount
      .update({
        where: { id: accountId },
        data: { status, bannedAt: this.clock.ts(), banReason: reason },
      })
      .catch(() => undefined);
    this.log.error(`vk account ${accountId}: ${reason} — marked ${status}`);
    await this.disconnect(accountId);
  }

  async ownChatIds(): Promise<Set<number>> {
    const rows = await this.prisma.channelAccount.findMany({
      where: { channel: 'vk', peerId: { not: null } },
      select: { peerId: true },
    });
    return new Set(rows.map((r) => chatIdFor('vk', Number(r.peerId))));
  }

  // ── Приём ─────────────────────────────────────────────────────────────────

  private async run(entry: LiveVk): Promise<void> {
    const file = new CursorFile(
      join(appConfig.dataDir, 'vk_longpoll', `${entry.id}.json`),
    );
    const lp = new VkLongPoll(entry.api, file, this.log);
    const committer = new CursorCommitter(file);
    let beat = 0;
    try {
      for await (const batch of lp.batches(entry.abort.signal)) {
        if (entry.abort.signal.aborted) break;
        const events = [
          ...batch.missed.map(fromDto),
          ...batch.updates
            .map(decodeEvent)
            .filter((e): e is VkEvent => e !== null),
        ];
        const messages = events.filter((e) => e.kind === 'message');
        const done = committer.open(batch.cursor, messages.length);
        for (const e of events) {
          if (e.kind === 'message')
            void this.onMessage(entry, e)
              .catch((err) =>
                this.log.error(
                  `vk inbound failed account=${entry.id}: ${err?.stack ?? err}`,
                ),
              )
              .finally(done);
          else
            await this.onEvent(entry, e).catch((err) =>
              this.log.warn(
                `vk event failed account=${entry.id}: ${err?.message ?? err}`,
              ),
            );
        }
        if (this.clock.ts() - beat > 60) {
          beat = this.clock.ts();
          await this.prisma.channelAccount
            .update({
              where: { id: entry.id },
              data: { lastHeartbeatAt: beat },
            })
            .catch(() => undefined);
        }
      }
    } catch (e) {
      this.failures.set(entry.id, {
        reason: offlineReasonOf(e),
        at: this.clock.ts(),
      });
      this.log.error(
        `vk long poll stopped account=${entry.id}: ${(e as Error).message}`,
      );
      if (this.live.get(entry.id) === entry) this.live.delete(entry.id);
      await this.onAccountError(entry.id, e);
    }
  }

  /** chat_id собеседника: лид по номеру живёт на пире контакта. */
  private chatOf(entry: LiveVk, peer: number): number {
    return chatIdFor('vk', entry.contacts.get(peer) ?? peer);
  }

  /**
   * Связать входящего с чатом контакта, если он — лид по номеру. Контакты
   * перечитываются, только пока есть несвязанные или завели новый. Чат на его
   * собственный id, если он уже идёт, в чат контакта не уводим.
   */
  private async learn(entry: LiveVk, peer: number): Promise<void> {
    if (entry.contacts.has(peer) || entry.plain.has(peer)) return;
    if (peer >= CONTACT_PEER_BASE && peer < CHAT_PEER_MIN) return;
    if (entry.contactsStale) {
      let unlinked = false;
      for (let start = 1; start <= CONTACTS_MAX; start += CONTACTS_BATCH) {
        let items: Array<{ id: number; user_id?: number }>;
        try {
          items = await entry.api.call('messages.getContactsById', {
            contact_ids: Array.from(
              { length: CONTACTS_BATCH },
              (_, i) => start + i,
            ).join(','),
          });
        } catch (e) {
          // Ни одного контакта в пачке VK отдаёт ошибкой 936 — это конец списка.
          if (e instanceof VkApiError && e.code === 936) break;
          this.log.warn(
            `vk contacts not read account=${entry.id}: ${(e as Error).message}`,
          );
          return;
        }
        if (!items?.length) break;
        for (const c of items)
          if (c.user_id) {
            if (!entry.contacts.has(c.user_id))
              entry.contacts.set(c.user_id, CONTACT_PEER_BASE + Number(c.id));
          } else unlinked = true;
      }
      entry.contactsStale = unlinked;
      const contact = entry.contacts.get(peer);
      if (contact !== undefined) {
        const own = await this.prisma.contact.findUnique({
          where: { chatId: toChatId(chatIdFor('vk', peer)) },
          select: { chatId: true },
        });
        if (!own) return;
        entry.contacts.delete(peer);
      }
    }
    entry.plain.add(peer);
  }

  private async fullMessage(
    entry: LiveVk,
    e: Extract<VkEvent, { kind: 'message' }>,
  ) {
    if (!e.thin || !e.message.id) return e.message;
    try {
      const r = await entry.api.call<{ items?: VkMessage[] }>(
        'messages.getById',
        {
          message_ids: e.message.id,
        },
      );
      return r.items?.[0] ?? e.message;
    } catch {
      // Текст из события лучше, чем потерянный ход.
      return e.message;
    }
  }

  private async onMessage(
    entry: LiveVk,
    e: Extract<VkEvent, { kind: 'message' }>,
  ) {
    if (this.stopping) return;
    const peer = e.message.peer_id;
    if (!isPersonPeer(peer) || peer === entry.peerId) return;
    if (e.outgoing && entry.messages.isOwnEcho(Number(e.message.random_id)))
      return;
    const message = liftForwardedVoice(await this.fullMessage(entry, e));
    await this.learn(entry, peer);
    const chatId = this.chatOf(entry, peer);
    if ((await this.ownChatIds()).has(chatId)) return;
    const owner = await this.history.chatOwnerAccount(chatId);
    if (owner !== null && owner !== entry.id) {
      this.log.warn(
        `chat ${chatId} is led by account ${owner}; vk message ${message.conversation_message_id} to account ${entry.id} is not passed to the bot`,
      );
      return;
    }
    const cmid = message.conversation_message_id;
    if (e.outgoing) return this.importOutgoing(entry, chatId, message);
    if (await this.history.hasProcessedClientMessage(chatId, cmid)) return;
    const release = this.brain.observeIncoming?.(chatId, entry.id, cmid);
    try {
      this.presence.setActivity(chatId, null);
      await this.history
        .setBlockedByClient(chatId, null)
        .catch(() => undefined);
      await this.history.clearClearedByClient(chatId).catch(() => undefined);
      await this.history.clearLikelyBlocked(chatId).catch(() => undefined);
      const media = await this.saveMedia(entry, chatId, message).catch(
        (err) => {
          this.log.warn(
            `vk media download failed chat=${chatId}: ${err?.message ?? err}`,
          );
          return null;
        },
      );
      await this.brain.handleInbound({
        chatId,
        accountId: entry.id,
        messageId: cmid,
        text: inboundText(message, media),
        ts: message.date,
        media,
      });
    } finally {
      release?.();
    }
  }

  /** Вложение входящего — в media/inbound, как у Telegram. */
  private async saveMedia(
    entry: LiveVk,
    chatId: number,
    message: VkMessage,
  ): Promise<InboundMedia | null> {
    const m = inboundMedia(message);
    if (!m) return null;
    const base: InboundMedia = {
      kind: m.kind,
      duration: m.duration,
      name: m.name,
      ...(m.transcript ? { transcript: m.transcript } : {}),
    };
    if (!m.url) return base;
    const buffer = await entry.api.download(m.url, INBOUND_MAX_BYTES);
    const dir = join(appConfig.mediaDir, 'inbound', String(entry.id));
    mkdirSync(dir, { recursive: true });
    const path = join(
      dir,
      `${chatId}_${message.conversation_message_id}.${m.ext}`,
    );
    writeFileSync(path, buffer);
    await this.prisma.inboundMedia.create({
      data: {
        chatId: toChatId(chatId),
        msgTs: message.date,
        kind: m.kind,
        path,
        savedAt: this.clock.ts(),
      },
    });
    return { ...base, path };
  }

  /** Менеджер написал из приложения VK: реплика в историю от имени оператора. */
  private async importOutgoing(
    entry: LiveVk,
    chatId: number,
    message: VkMessage,
  ) {
    const cmid = message.conversation_message_id;
    const known = await this.prisma.message.findFirst({
      where: { chatId: toChatId(chatId), peerMsgId: cmid, role: 'assistant' },
      select: { id: true },
    });
    if (known) return;
    const release = this.brain.observeIncoming?.(chatId, entry.id, -cmid);
    try {
      await this.history.ensureContact(chatId, entry.id);
      await this.brain.noteOperatorQueued?.(chatId);
      const media = inboundMedia(message);
      await this.history.appendMessage(chatId, {
        role: 'assistant',
        text:
          inboundText(message, media).trim() ||
          (media
            ? `[${media.kind}: содержимое вложения не расшифровано]`
            : '[Вложение без описания]'),
        ts: message.date,
        author: 'operator:vk',
        peerMsgId: cmid,
        mediaKind: media?.kind,
      });
      await this.brain.noteOperatorMessage(chatId);
    } finally {
      release?.();
    }
  }

  private async onEvent(
    entry: LiveVk,
    e: Exclude<VkEvent, { kind: 'message' }>,
  ) {
    if (!isPersonPeer(e.peer) || e.peer === entry.peerId) return;
    const chatId = this.chatOf(entry, e.peer);
    const owner = await this.history.chatOwnerAccount(chatId);
    if (owner !== null && owner !== entry.id) return;
    if (e.kind === 'read') return this.history.markRead(chatId, e.side, e.cmid);
    if (e.kind === 'typing') {
      if (e.ts >= this.clock.ts() - TYPING_FRESH_S)
        this.presence.setActivity(chatId, e.activity);
      return;
    }
    const changed = await this.history.editMessageText(
      chatId,
      { peerMsgId: e.cmid },
      e.text,
      this.clock.ts(),
    );
    if (changed)
      await this.brain.noteEdited(
        chatId,
        changed.role === 'user' ? 'user' : 'assistant',
        changed.old,
        e.text,
        changed.id,
      );
  }

  // ── Отправка ──────────────────────────────────────────────────────────────

  private async accountFor(chatId: number, preferred?: number | null) {
    const ownerId = preferred ?? (await this.history.chatOwnerAccount(chatId));
    const entry = ownerId === null ? null : this.live.get(ownerId);
    if (!entry)
      throw new Error(
        `no online VK account owns chat ${chatId} (owner=${ownerId})`,
      );
    return { entry, peer: peerOf(chatId).peerId };
  }

  /** «Печатает…» заходами, как у Telegram: статус подтверждается и снимается в паузах. */
  private async typeLike(
    entry: LiveVk,
    peer: number,
    text: string,
    style: TypingStyle,
    signal?: AbortSignal,
  ) {
    const plan = typingPlan(text, style);
    for (const [b, burst] of plan.bursts.entries()) {
      for (let left = burst; left > 0; left -= TYPING_REFRESH_MS) {
        checkCancelled(signal);
        await entry.messages.typing(peer).catch(() => undefined);
        await cancellableSleep(Math.min(left, TYPING_REFRESH_MS), signal);
      }
      if (b < plan.pauses.length)
        await cancellableSleep(plan.pauses[b], signal);
    }
  }

  /** Отправка: собеседник закрыл нам личку — отметка на чате, дошло — снимается. */
  private async deliver<T>(chatId: number, work: () => Promise<T>): Promise<T> {
    try {
      const result = await work();
      await this.history
        .setBlockedByClient(chatId, null)
        .catch(() => undefined);
      return result;
    } catch (e) {
      if (e instanceof VkApiError && (e.code === 900 || e.code === 902)) {
        await this.history
          .setBlockedByClient(chatId, this.clock.ts())
          .catch(() => undefined);
        throw new Error(
          'собеседник закрыл личные сообщения — сообщение не доставлено',
        );
      }
      throw e;
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
      onPart?: (index: number, peerMsgId: number) => Promise<void>;
    } = {},
  ): Promise<number[]> {
    const { entry, peer } = await this.accountFor(chatId, opts.accountId);
    const style = opts.typing ?? DEFAULT_TYPING;
    const ids: number[] = [];
    for (const [i, part] of parts.entries()) {
      checkCancelled(opts.signal);
      await opts.beforePart?.();
      if (style.enabled) {
        if (i > 0) await cancellableSleep(partPauseMs(style), opts.signal);
        await this.typeLike(entry, peer, part, style, opts.signal);
      }
      await opts.beforePart?.();
      checkCancelled(opts.signal);
      await opts.onDispatch?.(i);
      const cmid = await this.deliver(chatId, () =>
        entry.messages.send(
          peer,
          {
            message: part,
            ...(i === 0 && opts.replyTo
              ? { forward: VkMessages.reply(peer, opts.replyTo) }
              : {}),
          },
          { randomId: opts.randomIds?.[i] ?? null },
        ),
      );
      ids.push(cmid);
      await opts.onPart?.(i, cmid);
    }
    return ids;
  }

  async sendPhoto(
    chatId: number,
    opts: {
      path: string;
      caption: string;
      randomId: string;
      accountId?: number | null;
      typing?: TypingStyle;
      signal?: AbortSignal;
      onDispatch?: () => Promise<void>;
    },
  ): Promise<number> {
    const { entry, peer } = await this.accountFor(chatId, opts.accountId);
    await entry.messages.typing(peer, 'photo').catch(() => undefined);
    const attachment = await entry.messages.upload(peer, opts.path, 'photo');
    checkCancelled(opts.signal);
    await opts.onDispatch?.();
    return this.deliver(chatId, () =>
      entry.messages.send(
        peer,
        { attachment, ...(opts.caption ? { message: opts.caption } : {}) },
        { randomId: opts.randomId },
      ),
    );
  }

  async sendReaction(
    chatId: number,
    messageId: number,
    emoji: string,
  ): Promise<void> {
    const { entry, peer } = await this.accountFor(chatId);
    await entry.messages.react(peer, messageId, emoji);
  }

  async markRead(chatId: number, accountId?: number | null): Promise<void> {
    const { entry, peer } = await this.accountFor(chatId, accountId);
    await entry.messages.markRead(peer);
    await this.history.markRead(
      chatId,
      'inbox',
      await this.history.latestClientMsgId(chatId),
    );
  }

  async markListened(
    chatId: number,
    messageIds: number[],
    accountId?: number | null,
  ): Promise<void> {
    if (!messageIds.length) return;
    const { entry, peer } = await this.accountFor(chatId, accountId);
    for (const cmid of messageIds) await entry.messages.markPlayed(peer, cmid);
  }

  async editText(
    chatId: number,
    peerMsgId: number,
    text: string,
  ): Promise<void> {
    const { entry, peer } = await this.accountFor(chatId);
    await entry.messages.edit(peer, peerMsgId, text);
  }

  // ── Поиск собеседника для рассылки ────────────────────────────────────────

  /** Ник или idN → собеседник; закрытую личку отсекаем заранее, без лишнего 902. */
  async resolveUsername(
    accountId: number,
    username: string,
  ): Promise<ResolvedPeer> {
    const entry = this.live.get(accountId);
    if (!entry) throw new Error(`VK account ${accountId} is offline`);
    let users: Array<{
      id: number;
      screen_name?: string;
      deactivated?: string;
      can_write_private_message?: number;
    }>;
    try {
      users = await entry.api.call(
        'users.get',
        {
          user_ids: username.replace(/^@/, '').trim(),
          fields: 'screen_name,can_write_private_message',
        },
        { strict: true },
      );
    } catch (e) {
      if (e instanceof VkApiError && e.code === INVALID_USER)
        return { kind: 'not_found' };
      throw e;
    }
    const u = users?.[0];
    if (!u) return { kind: 'not_found' };
    if (!u.deactivated && !u.can_write_private_message)
      return { kind: 'not_found' };
    return {
      kind: 'found',
      chatId: chatIdFor('vk', u.id),
      userId: u.id,
      username: u.screen_name ?? null,
      deleted: !!u.deactivated,
    };
  }

  /**
   * Номер → пир контакта аккаунта, как «Написать по номеру» в веб-VK. Пишем
   * всегда контакту: чужому приватность закрывает личку, а контакту VK писать
   * разрешает. Ответ придёт с настоящего id — его склеит learn().
   */
  async resolvePhone(accountId: number, phone: string): Promise<ResolvedPeer> {
    const entry = this.live.get(accountId);
    if (!entry) throw new Error(`VK account ${accountId} is offline`);
    const found = await entry.api.call<{
      items?: { synced?: number[]; existing?: number[] };
    }>(
      'account.importMessagesContacts',
      {
        with_existing: 1,
        contacts: JSON.stringify([{ phones: [phone], name: '' }]),
        device_id: 'persona',
      },
      { strict: true },
    );
    const ids = [
      ...(found.items?.synced ?? []),
      ...(found.items?.existing ?? []),
    ];
    if (!ids.length) return { kind: 'not_found' };
    const [contact] = await entry.api.call<
      Array<{ id: number; user_id?: number; can_write?: number }>
    >('messages.getContactsById', { contact_ids: ids[0] }, { strict: true });
    if (!contact?.can_write) return { kind: 'not_found' };
    entry.contactsStale = true;
    const peer = CONTACT_PEER_BASE + Number(contact.id);
    return {
      kind: 'found',
      chatId: chatIdFor('vk', peer),
      userId: contact.user_id ?? peer,
      username: null,
      deleted: false,
    };
  }
}
