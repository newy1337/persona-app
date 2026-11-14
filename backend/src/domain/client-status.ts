/**
 * Статус собеседника в чате — общий для всех каналов: «в сети», «был»,
 * заблокировал нас, почистил переписку.
 */
export type ClientStatusKind =
  'online' | 'offline' | 'recently' | 'last_week' | 'last_month' | 'hidden';

export interface ClientPresence {
  kind: ClientStatusKind;
  at: number | null;
}

export function presenceNow(p: ClientPresence, nowTs: number): ClientPresence {
  if (p.kind === 'online' && p.at !== null && p.at < nowTs)
    return { kind: 'offline', at: p.at };
  return p;
}

const WEEK_S = 7 * 86400;

/**
 * Собеседник не заходил в сеть больше недели. «Давно» и «в этом месяце» —
 * точно дольше недели; «недавно» и «на этой неделе» — нет. Статуса нет
 * (канал не показал) — не знаем, считаем активным.
 */
export function inactiveOverWeek(
  p: ClientPresence | null | undefined,
  nowTs: number,
): boolean {
  if (!p) return false;
  if (p.kind === 'last_month' || p.kind === 'hidden') return true;
  if (p.kind === 'offline') return p.at !== null && p.at < nowTs - WEEK_S;
  return false;
}

export function accountLostOf(
  status: string | null,
  lostAt: number | null,
): 'banned' | 'logged_out' | null {
  if (status === 'banned') return 'banned';
  if (status === 'unauthorized' && lostAt !== null) return 'logged_out';
  return null;
}

export function clientStatusView(
  c: {
    clientStatus: string | null;
    clientStatusAt: number | null;
    blockedByClientAt: number | null;
    clearedByClientAt?: number | null;
    likelyBlockedAt?: number | null;
  } | null,
  nowTs: number,
): {
  client_presence: ClientPresence | null;
  blocked_by_client_at: number | null;
  cleared_by_client_at: number | null;
  likely_blocked_at: number | null;
} {
  const presence = c?.clientStatus
    ? presenceNow(
        {
          kind: c.clientStatus as ClientStatusKind,
          at: c.clientStatusAt ?? null,
        },
        nowTs,
      )
    : null;
  return {
    client_presence: presence,
    blocked_by_client_at: c?.blockedByClientAt ?? null,
    cleared_by_client_at: c?.clearedByClientAt ?? null,
    likely_blocked_at: c?.likelyBlockedAt ?? null,
  };
}

const VISIBLE = new Set(['online', 'offline', 'recently']);

/**
 * Telegram не сообщает, что собеседник занёс нас в ЧС. Признак блокировки:
 * собеседник был виден («в сети», «был в 12:30», «был недавно»), и статус
 * вдруг стал скрытым. То же бывает, если он закрыл статус приватностью,
 * поэтому это «вероятно», а не факт. Новое значение likely_blocked_at:
 * number — поставить, null — снять, undefined — не трогать.
 */
export function likelyBlockedChange(
  previous: string | null | undefined,
  next: ClientStatusKind,
  seenAt: number,
): number | null | undefined {
  if (next === 'hidden')
    return previous && VISIBLE.has(previous) ? seenAt : undefined;
  return VISIBLE.has(next) ? null : undefined;
}
