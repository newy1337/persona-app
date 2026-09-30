export type ClientStatusKind =
  'online' | 'offline' | 'recently' | 'last_week' | 'last_month' | 'hidden';

export interface ClientPresence {
  kind: ClientStatusKind;
  at: number | null;
}

export function clientPresence(
  status:
    | { className?: string; expires?: number; wasOnline?: number }
    | null
    | undefined,
): ClientPresence | null {
  switch (status?.className) {
    case 'UserStatusOnline':
      return { kind: 'online', at: Number(status.expires) || null };
    case 'UserStatusOffline':
      return { kind: 'offline', at: Number(status.wasOnline) || null };
    case 'UserStatusRecently':
      return { kind: 'recently', at: null };
    case 'UserStatusLastWeek':
      return { kind: 'last_week', at: null };
    case 'UserStatusLastMonth':
      return { kind: 'last_month', at: null };
    case 'UserStatusEmpty':
      return { kind: 'hidden', at: null };
    default:
      return null;
  }
}

export function presenceNow(p: ClientPresence, nowTs: number): ClientPresence {
  if (p.kind === 'online' && p.at !== null && p.at < nowTs)
    return { kind: 'offline', at: p.at };
  return p;
}

const errorText = (e: unknown): string =>
  String(
    (e as { errorMessage?: string })?.errorMessage ??
      (e as Error)?.message ??
      e ??
      '',
  );

export function accountLoss(
  e: unknown,
): { kind: 'banned' | 'logged_out'; reason: string } | null {
  const msg = errorText(e);
  if (/USER_DEACTIVATED_BAN/i.test(msg))
    return { kind: 'banned', reason: 'Telegram заблокировал аккаунт' };
  if (/USER_DEACTIVATED/i.test(msg))
    return { kind: 'banned', reason: 'аккаунт удалён в Telegram' };
  if (
    /AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|AUTH_KEY_DUPLICATED/i.test(
      msg,
    )
  ) {
    return {
      kind: 'logged_out',
      reason: 'сессия завершена — нужно войти заново',
    };
  }
  return null;
}

export const blockedByClient = (e: unknown): boolean =>
  /USER_IS_BLOCKED/i.test(errorText(e));

export function accountLostOf(
  status: string | null,
  lostAt: number | null,
): 'banned' | 'logged_out' | null {
  if (status === 'banned') return 'banned';
  if (status === 'unauthorized' && lostAt !== null) return 'logged_out';
  return null;
}

export function clientTelegramView(
  c: {
    clientStatus: string | null;
    clientStatusAt: number | null;
    blockedByClientAt: number | null;
    clearedByClientAt?: number | null;
  } | null,
  nowTs: number,
): {
  client_presence: ClientPresence | null;
  blocked_by_client_at: number | null;
  cleared_by_client_at: number | null;
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
  };
}
