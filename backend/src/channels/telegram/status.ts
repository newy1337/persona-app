import type { ClientPresence } from 'src/domain/client-status';

/** Статусы и ошибки Telegram → общие понятия статуса собеседника и аккаунта. */
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
