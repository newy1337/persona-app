const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function whenLabel(ts, nowTs = Math.floor(Date.now() / 1000)) {
  const d = new Date((ts + 10800) * 1000);
  const now = new Date((nowTs + 10800) * 1000);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const dayStart = (x) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const days = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  if (days === 0) return `сегодня в ${time}`;
  if (days === 1) return `вчера в ${time}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} в ${time}`;
}

export function presenceLabel(presence, nowTs = Math.floor(Date.now() / 1000), { short = false } = {}) {
  if (!presence) return null;
  const was = short ? 'был(а)' : 'был(а) в сети';
  switch (presence.kind) {
    case 'online':
      return { tone: 'online', text: 'в сети' };
    case 'offline': {
      if (!presence.at) return { tone: 'muted', text: `${was} давно` };
      const ago = Math.max(0, nowTs - presence.at);
      if (ago < 60) return { tone: 'muted', text: `${was} только что` };
      if (ago < 3600) return { tone: 'muted', text: `${was} ${Math.floor(ago / 60)} мин назад` };
      return { tone: 'muted', text: `${was} ${whenLabel(presence.at, nowTs)}` };
    }
    case 'recently':
      return { tone: 'muted', text: `${was} недавно` };
    case 'last_week':
      return { tone: 'muted', text: `${was} на этой неделе` };
    case 'last_month':
      return { tone: 'muted', text: `${was} в этом месяце` };
    case 'hidden':
      return { tone: 'muted', text: short ? 'время скрыто' : 'время в сети скрыто' };
    default:
      return null;
  }
}

export function accountLostLabel(lost, { short = false } = {}) {
  const kind = typeof lost === 'string' ? lost : lost?.kind;
  if (kind === 'banned') return short ? 'бан Telegram' : 'Аккаунт заблокирован Telegram';
  if (kind === 'logged_out') return short ? 'сессия завершена' : 'Сессия аккаунта завершена — нужно войти заново';
  return null;
}
