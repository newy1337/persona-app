import { type Channel, peerOf } from './ids';

/**
 * Как показать собеседника или аккаунт в панели: подпись и ссылка на профиль
 * в его мессенджере. Панель ссылки сама не собирает — канал знает только бэк.
 */
export interface ContactLink {
  display: string;
  url: string | null;
}

/** Пир «контакта» VK (диалог, начатый по номеру): своей страницы у него нет. */
const VK_CONTACT_PEER_MIN = 1_900_000_000;
const VK_CONTACT_PEER_MAX = 2_000_000_000;

export function chatChannel(chatId: number | bigint): Channel {
  return peerOf(chatId).channel;
}

/** Собеседник: Telegram — @ник; VK — ник или idN, ссылка на страницу. */
export function clientContact(
  chatId: number | bigint,
  username: string | null | undefined,
): ContactLink | null {
  const { channel, peerId } = peerOf(chatId);
  const nick = username?.replace(/^@/, '').trim() || null;
  if (channel === 'telegram')
    return nick ? { display: `@${nick}`, url: `https://t.me/${nick}` } : null;
  if (peerId >= VK_CONTACT_PEER_MIN && peerId < VK_CONTACT_PEER_MAX)
    return nick ? { display: nick, url: `https://vk.com/${nick}` } : null;
  const slug = nick ?? `id${peerId}`;
  return { display: slug, url: `https://vk.com/${slug}` };
}

/** Аккаунт: ник в его канале; у VK без ника — idN по peer_id. */
export function accountContact(
  channel: string | null | undefined,
  username: string | null | undefined,
  peerId?: number | bigint | null,
): ContactLink | null {
  const nick = username?.replace(/^@/, '').trim() || null;
  if (channel === 'vk') {
    const slug = nick ?? (peerId ? `id${peerId}` : null);
    return slug ? { display: slug, url: `https://vk.com/${slug}` } : null;
  }
  return nick ? { display: `@${nick}`, url: `https://t.me/${nick}` } : null;
}
