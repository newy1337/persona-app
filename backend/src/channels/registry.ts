import { Injectable } from '@nestjs/common';
import type { TypingStyle } from 'src/domain/typing';
import type { OutboundTransport } from 'src/brain/reply-brain.port';
import { PrismaService } from 'src/prisma.service';
import type { ChannelTransport } from './channel';
import { type Channel, isChannel, peerOf } from './ids';

/**
 * Все каналы в одном месте. Брейн получает реестр как OutboundTransport и
 * пишет в чат, не зная, Telegram это или VK: канал чата определяется по его
 * chat_id (полосы не пересекаются). Аккаунтам канал берётся из базы и
 * кешируется — он у аккаунта не меняется.
 */
@Injectable()
export class ChannelRegistry implements OutboundTransport {
  private readonly transports = new Map<Channel, ChannelTransport>();
  private readonly accountChannel = new Map<number, Channel>();

  constructor(private readonly prisma: PrismaService) {}

  /** Канал подключает себя сам при старте модуля. */
  register(transport: ChannelTransport): void {
    this.transports.set(transport.channel, transport);
  }

  all(): ChannelTransport[] {
    return [...this.transports.values()];
  }

  get(channel: Channel): ChannelTransport {
    const t = this.transports.get(channel);
    if (!t) throw new Error(`канал ${channel} не подключён на сервере`);
    return t;
  }

  has(channel: Channel): boolean {
    return this.transports.has(channel);
  }

  forChat(chatId: number): ChannelTransport {
    return this.get(peerOf(chatId).channel);
  }

  async channelOf(accountId: number): Promise<Channel> {
    const known = this.accountChannel.get(accountId);
    if (known) return known;
    const row = await this.prisma.channelAccount.findUnique({
      where: { id: accountId },
      select: { channel: true },
    });
    const channel = isChannel(row?.channel) ? row.channel : 'telegram';
    this.accountChannel.set(accountId, channel);
    return channel;
  }

  async forAccount(accountId: number): Promise<ChannelTransport> {
    return this.get(await this.channelOf(accountId));
  }

  /** Хоть один канал настроен. */
  get configured(): boolean {
    return this.all().some((t) => t.configured);
  }

  onlineIds(): number[] {
    return this.all().flatMap((t) => t.onlineIds());
  }

  isOnline(accountId: number): boolean {
    return this.all().some((t) => t.isOnline(accountId));
  }

  /** Причина «не в сети» по каналу аккаунта (канал известен из строки аккаунта). */
  offlineReason(accountId: number, channel: string): string | null {
    const t = isChannel(channel) ? this.transports.get(channel) : undefined;
    if (!t) return `канал ${channel} не подключён на сервере`;
    return t.offlineReason(accountId);
  }

  connectionTrouble(accountId: number, channel: string): string | null {
    const t = isChannel(channel) ? this.transports.get(channel) : undefined;
    return t?.connectionTrouble?.(accountId) ?? null;
  }

  async ownChatIds(): Promise<Set<number>> {
    const sets = await Promise.all(this.all().map((t) => t.ownChatIds()));
    return new Set(sets.flatMap((s) => [...s]));
  }

  // ── OutboundTransport: брейн пишет в чат, реестр выбирает канал ─────────────

  sendText(
    chatId: number,
    parts: string[],
    opts?: Parameters<OutboundTransport['sendText']>[2],
  ): Promise<number[]> {
    return this.forChat(chatId).sendText(chatId, parts, opts);
  }

  sendReaction(chatId: number, messageId: number, emoji: string) {
    return this.forChat(chatId).sendReaction(chatId, messageId, emoji);
  }

  markRead(chatId: number, accountId?: number | null) {
    return this.forChat(chatId).markRead(chatId, accountId);
  }

  markListened(
    chatId: number,
    messageIds: number[],
    accountId?: number | null,
  ) {
    return this.forChat(chatId).markListened(chatId, messageIds, accountId);
  }

  sendPhoto(
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
    const t = this.forChat(chatId);
    if (!t.sendPhoto)
      throw new Error(`канал ${t.channel} не умеет отправлять фото`);
    return t.sendPhoto(chatId, opts);
  }

  editText(chatId: number, peerMsgId: number, text: string): Promise<void> {
    const t = this.forChat(chatId);
    if (!t.editText)
      throw new Error(`канал ${t.channel} не умеет править сообщения`);
    return t.editText(chatId, peerMsgId, text);
  }
}
