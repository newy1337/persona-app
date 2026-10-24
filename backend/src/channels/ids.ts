/**
 * Каналы переписки и сквозной id чата.
 *
 * `chat_id` — внутренний ключ чата во всей системе: сообщения, расписание
 * ответов, память бота, расходы модели, адрес диалога в панели. Он должен быть
 * один на собеседника и не пересекаться между каналами, поэтому у каждого
 * канала своя полоса чисел:
 *
 * - Telegram — id пользователя как есть (так было всегда; id Telegram меньше 2^52);
 * - VK — `VK_CHAT_BASE + peer_id` (id VK на порядки меньше полосы).
 *
 * Полоса детерминирована: входящее от того же человека всегда попадает в тот
 * же чат без поиска по базе. Всё держится в пределах Number.MAX_SAFE_INTEGER,
 * потому что в коде chat_id ходит как number.
 */
export const CHANNELS = ['telegram', 'vk'] as const;
export type Channel = (typeof CHANNELS)[number];

export const isChannel = (v: unknown): v is Channel =>
  typeof v === 'string' && (CHANNELS as readonly string[]).includes(v);

/** Начало полосы VK: выше любого id Telegram (2^52 ≈ 4.5e15), ниже 2^53. */
export const VK_CHAT_BASE = 6_000_000_000_000_000;

export function chatIdFor(channel: Channel, peerId: number): number {
  if (!Number.isSafeInteger(peerId) || peerId <= 0)
    throw new Error(`id собеседника ${channel}: ${peerId}`);
  if (channel === 'telegram') {
    if (peerId >= VK_CHAT_BASE)
      throw new Error(`id Telegram вне полосы: ${peerId}`);
    return peerId;
  }
  if (peerId >= Number.MAX_SAFE_INTEGER - VK_CHAT_BASE)
    throw new Error(`id VK вне полосы: ${peerId}`);
  return VK_CHAT_BASE + peerId;
}

/** Канал и id собеседника по chat_id. */
export function peerOf(chatId: number | bigint): {
  channel: Channel;
  peerId: number;
} {
  const id = Number(chatId);
  return id >= VK_CHAT_BASE
    ? { channel: 'vk', peerId: id - VK_CHAT_BASE }
    : { channel: 'telegram', peerId: id };
}
