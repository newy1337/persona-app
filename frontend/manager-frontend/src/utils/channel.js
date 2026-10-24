// Канал чата и аккаунта и ссылки на профили. Ссылки отдаёт бэк (`contact`, `account_contact`,
// `account.contact`: t.me или vk.com) — панель канал не вычисляет. Строка без этих полей —
// старая форма (только Telegram): тогда @ник → t.me, как было.

const LABELS = { tg: 'TG', vk: 'VK' };
const TITLES = { tg: 'Telegram', vk: 'ВКонтакте' };

/** Ключ канала: бэк пишет `telegram` / `vk`; нет поля — Telegram. */
export function channelKey(channel) {
  return channel === 'vk' ? 'vk' : 'tg';
}

/** Бейдж канала. `other` — не Telegram: только такие чаты и аккаунты помечаем. */
export function channelBadge(channel) {
  const key = channelKey(channel);
  return { key, label: LABELS[key], title: TITLES[key], other: key !== 'tg' };
}

export const CHANNEL_FILTERS = [['all', 'Все'], ['tg', 'Telegram'], ['vk', 'ВКонтакте']];

export function matchesChannel(row, filter) {
  return !filter || filter === 'all' || channelKey(row?.channel) === filter;
}

/** Собеседник ссылкой: `contact` бэка, иначе @ник Telegram. */
export function clientContact(row) {
  if (row?.contact !== undefined) return row.contact?.url ? row.contact : null;
  if (row?.client_contact !== undefined) return row.client_contact?.url ? row.client_contact : null;
  const nick = row?.client_username;
  return nick ? { display: `@${nick}`, url: `https://t.me/${nick}` } : null;
}

/** Аккаунт ссылкой (строка списка чатов или аккаунт карточки). */
export function accountContact(row) {
  if (row?.account_contact !== undefined) return row.account_contact;
  if (row?.contact !== undefined && row?.channel !== undefined) return row.contact;
  const nick = row?.account_username ?? row?.username;
  if (!nick) return null;
  return channelKey(row?.channel) === 'vk'
    ? { display: nick, url: `https://vk.com/${nick}` }
    : { display: `@${nick}`, url: `https://t.me/${nick}` };
}
