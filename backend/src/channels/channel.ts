import type { OutboundTransport } from 'src/brain/reply-brain.port';
import type { Channel } from './ids';

/**
 * Собеседник, найденный по номеру или нику. `chatId` — сквозной id чата
 * (см. `ids.ts`): для Telegram совпадает с id пользователя, для VK — в своей
 * полосе. `userId` — id в самом канале.
 */
export type ResolvedPeer =
  | {
      kind: 'found';
      chatId: number;
      userId: number;
      username: string | null;
      deleted: boolean;
    }
  | { kind: 'not_found' }
  /** Канал сейчас не даёт искать (лимит импорта и т. п.) — повторить позже. */
  | { kind: 'retry' };

/**
 * Канал переписки целиком: отправка (то, что нужно брейну) плюс жизнь
 * аккаунтов и поиск собеседников для рассылки. Telegram и VK реализуют его
 * одинаково, остальной код от канала не зависит.
 */
export interface ChannelTransport extends OutboundTransport {
  readonly channel: Channel;
  /** Канал настроен на сервере (ключи API и т. п.). */
  readonly configured: boolean;

  isOnline(accountId: number): boolean;
  onlineIds(): number[];
  /** Почему аккаунт не в сети; null — в сети. */
  offlineReason(accountId: number): string | null;
  connect(accountId: number): Promise<void>;
  /** hold — отключили намеренно, сторож не подключит обратно. */
  disconnect(accountId: number, opts?: { hold?: boolean }): Promise<void>;
  reconnect(accountId: number): Promise<void>;

  resolvePhone(
    accountId: number,
    phone: string,
    firstName?: string,
  ): Promise<ResolvedPeer>;
  resolveUsername(accountId: number, username: string): Promise<ResolvedPeer>;
  /** chat_id собеседников, которые на самом деле наши же аккаунты этого канала. */
  ownChatIds(): Promise<Set<number>>;
}
