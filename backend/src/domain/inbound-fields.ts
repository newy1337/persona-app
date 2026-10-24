/**
 * Как ещё отправители называют ник в Telegram. Наш API ждёт `username`, а
 * неизвестные поля проверка тела молча выкидывает — так ник от TDS терялся,
 * лид получал 201 и писался только по номеру.
 */
export const USERNAME_ALIASES = [
  'username',
  'tg',
  'telegram',
  'tg_username',
  'telegram_username',
  'tgUsername',
  'telegramUsername',
  'nick',
  'nickname',
  'login',
] as const;

/** Ник из сырого тела: первое непустое из известных имён поля. */
export function usernameFrom(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const body = raw as Record<string, unknown>;
  for (const key of USERNAME_ALIASES) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** Поля тела, которых нет ни в API, ни среди известных вариантов ника. */
export function unknownFields(
  raw: unknown,
  known: readonly string[],
): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const allowed = new Set<string>([...known, ...USERNAME_ALIASES]);
  return Object.keys(raw)
    .filter((key) => !allowed.has(key))
    .sort();
}
