/**
 * Почему аккаунт не подключился — словами для панели («Не в сети: …»).
 * Ошибки GramJS и сети приходят разными текстами; здесь они сводятся к
 * нескольким понятным причинам, остальное показывается как есть.
 */
export function offlineReasonOf(e: unknown): string {
  const raw = String(
    (e as { errorMessage?: string })?.errorMessage ??
      (e as Error)?.message ??
      e ??
      '',
  );
  const code =
    (e as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (e as { code?: string })?.code ??
    '';
  const text = `${raw} ${code}`;
  if (/Socks|proxy|прокси/i.test(text))
    return `прокси не отвечает (${short(raw)})`;
  if (
    /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(
      text,
    )
  )
    return `нет связи с Telegram или прокси (${code || short(raw)})`;
  if (/не ответил за|TIMEOUT/i.test(text))
    return 'Telegram не отвечает — переподключаемся';
  if (/USER_DEACTIVATED_BAN/i.test(text))
    return 'Telegram заблокировал аккаунт';
  if (
    /AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|not authorized/i.test(
      text,
    )
  )
    return 'сессия завершена — нужно войти заново';
  if (/has no session/i.test(text)) return 'нет сессии — нужно войти';
  return short(raw) || 'не удалось подключиться';
}

const short = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 120);

export interface OfflineState {
  configured: boolean;
  live: boolean;
  held: boolean;
  connecting: boolean;
  failure: { reason: string; at: number } | null;
}

/** Причина «Не в сети» для панели; null — аккаунт в сети. */
export function offlineReason(s: OfflineState): string | null {
  if (s.live) return null;
  if (!s.configured)
    return 'на сервере не заданы ключи Telegram (TG_API_ID/TG_API_HASH)';
  if (s.held)
    return 'отключён: аккаунт не активен (пауза, выведен или вход не выполнен)';
  if (s.connecting)
    return s.failure
      ? `переподключается — прошлая попытка: ${s.failure.reason}`
      : 'подключается';
  if (s.failure) return s.failure.reason;
  return 'ждёт подключения после перезапуска сервера';
}
