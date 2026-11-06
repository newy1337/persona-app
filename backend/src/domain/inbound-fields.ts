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

/**
 * Поля, в которых отправитель называет мессенджер лида. В DTO — `messenger`,
 * `channel` берём из сырого тела: проверка тела его выкидывает.
 */
export const MESSENGER_FIELDS = ['messenger', 'channel'] as const;

/** Ник VK под отдельным полем: само поле говорит, что лид из VK. */
export const VK_USERNAME_ALIASES = [
  'vk',
  'vk_id',
  'vk_username',
  'vk_url',
  'vkontakte',
] as const;

const MESSENGER_NAMES: Record<string, 'telegram' | 'vk'> = {
  telegram: 'telegram',
  tg: 'telegram',
  телеграм: 'telegram',
  телеграмм: 'telegram',
  тг: 'telegram',
  vk: 'vk',
  vkontakte: 'vk',
  вк: 'vk',
  вконтакте: 'vk',
};

/** Мессенджер по названию от отправителя; null — не узнали. */
export function messengerOf(raw: unknown): 'telegram' | 'vk' | null {
  if (typeof raw !== 'string') return null;
  return MESSENGER_NAMES[raw.trim().toLowerCase()] ?? null;
}

/** Первое непустое значение из полей тела. */
export function firstField(
  raw: unknown,
  keys: readonly string[],
): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const body = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
  }
  return undefined;
}

const filled = (v: unknown) =>
  (typeof v === 'string' && v.trim() !== '') || typeof v === 'number';

/**
 * Тело запроса с ником и мессенджером под нашими именами. Делается до
 * проверки тела: та выкидывает незнакомые поля и отбивает лид без контакта,
 * так что ник только в поле tg или vk иначе не доживал до разбора.
 * messenger — для холодки: channel переносим в messenger, а ник VK из поля vk
 * (vk_id, vk_url…) ставим в username и делаем лид VK, если мессенджер не
 * назван Telegram.
 */
export function withContactAliases(
  raw: unknown,
  opts: { messenger?: boolean } = {},
): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const body: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (opts.messenger) {
    if (body.messenger === undefined) {
      const channel = firstField(body, ['channel']);
      if (channel) body.messenger = channel;
    }
    const vkNick = firstField(body, VK_USERNAME_ALIASES);
    if (
      vkNick &&
      !filled(body.username) &&
      messengerOf(body.messenger) !== 'telegram'
    ) {
      body.username = vkNick;
      body.messenger ??= 'vk';
    }
  }
  if (!filled(body.username)) {
    const alias = usernameFrom(body);
    if (alias) body.username = alias;
  }
  return body;
}
