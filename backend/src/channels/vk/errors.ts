/**
 * Ошибки VK API → типы, по которым остальной код решает, что делать.
 *
 * Словарь кодов снят с Chutter (`vkauth/errors.py`) и схемы VK
 * (`VKCOM/vk-api-schema/errors.json`): 6, 9, 14, 17, 24, 29 там global —
 * относятся ко всему ключу доступа, а не к методу.
 */

/** «Повтори позже»: 6 — слишком часто, 9 — flood control, 10 — сбой VK, 29 — лимит метода. */
export const FLOOD_CODES = new Set([6, 9, 10, 29]);
/** Капча: серверно не решается, нужен браузер аккаунта. */
export const CAPTCHA_CODES = new Set([14]);
/** Device-challenge: 17 Validation required, 24 Confirmation required. */
export const CHALLENGE_CODES = new Set([17, 24]);
/** Наш аккаунт забанен (37) или деактивирован (3610). */
export const ACCOUNT_DEAD_CODES = new Set([37, 3610]);
/** Токен не принят: 5 (и 5/1130), 1117 — истёк раньше срока. */
export const TOKEN_CODES = new Set([5, 1117]);
/** Токен выдан другому IP — VK отдаёт его как 5 с этим подкодом. */
export const IP_MISMATCH_SUBCODE = 1130;
/**
 * Ограничение НАШЕГО аккаунта на переписку: 983/984 spam restriction, 1021 —
 * нельзя без диалога. Метка получателя на них сожгла бы пул лидов.
 */
export const SPAM_RESTRICTION_CODES = new Set([983, 984, 1021]);
/** Получатель закрыл нам переписку: чёрный список, нет права, приватность. */
export const CLOSED_PEER_CODES = new Set([900, 901, 902]);
/** Получателя нет: удалён/забанен, не найден, чат выключен. */
export const GONE_PEER_CODES = new Set([18, 936, 945, 946]);
/** Получатель недоступен этому аккаунту насовсем. */
export const DEAD_PEER_CODES = new Set([
  ...CLOSED_PEER_CODES,
  ...GONE_PEER_CODES,
  925,
]);
/** Гейт «написать первым»: заявка на переписку и её состояния. */
export const WRITE_GATE_CODES = new Set([939, 987, 988]);

export class VkApiError extends Error {
  constructor(
    readonly code: number,
    readonly vkMessage: string,
    readonly opts: {
      subcode?: number | null;
      method?: string;
      retryAfterMs?: number | null;
    } = {},
  ) {
    const sub = opts.subcode ? `/${opts.subcode}` : '';
    const where = opts.method ? ` в ${opts.method}` : '';
    super(`[${code}${sub}]${where} ${vkMessage.slice(0, 140)}`);
    this.name = new.target.name;
  }
  get subcode(): number | null {
    return this.opts.subcode ?? null;
  }
  get method(): string {
    return this.opts.method ?? '';
  }
  get retryAfterMs(): number | null {
    return this.opts.retryAfterMs ?? null;
  }
}

/** Слишком часто: повтор с паузой, а не тревога. */
export class VkFlood extends VkApiError {}
/** Капча. `redirectUri` ведёт на VK ID Captcha. */
export class VkCaptcha extends VkApiError {
  redirectUri = '';
}
export class VkChallenge extends VkApiError {}
export class VkAccountBanned extends VkApiError {}
/** Токен не принят и после принудительного перевыпуска — сессия мертва. */
export class VkTokenDead extends VkApiError {}
/** Токен с другого IP: один перевыпуск, дальше виноват прокси. */
export class VkIpMismatch extends VkApiError {}
/** Ограничение на рассылку у нашего аккаунта. */
export class VkSpamRestricted extends VkApiError {}
export class VkPeerUnavailable extends VkApiError {}
export class VkWriteBlocked extends VkApiError {}

/** Нужен человек: аккаунт уводим из работы, как frozen у Telegram. */
export const isTerminal = (e: unknown): boolean =>
  e instanceof VkCaptcha ||
  e instanceof VkChallenge ||
  e instanceof VkAccountBanned ||
  e instanceof VkTokenDead;

/**
 * Код VK → типизированная ошибка; неизвестный код остаётся VkApiError.
 * Подкод 1130 проверяется первым: без него «чужой IP» выглядит как протухший
 * токен и уводит в перелогин вместо починки прокси.
 */
export function errorFor(
  code: number,
  message: string,
  opts: { subcode?: number | null; method?: string } = {},
): VkApiError {
  const Cls =
    opts.subcode === IP_MISMATCH_SUBCODE
      ? VkIpMismatch
      : CAPTCHA_CODES.has(code)
        ? VkCaptcha
        : CHALLENGE_CODES.has(code)
          ? VkChallenge
          : ACCOUNT_DEAD_CODES.has(code)
            ? VkAccountBanned
            : FLOOD_CODES.has(code)
              ? VkFlood
              : SPAM_RESTRICTION_CODES.has(code)
                ? VkSpamRestricted
                : DEAD_PEER_CODES.has(code)
                  ? VkPeerUnavailable
                  : WRITE_GATE_CODES.has(code)
                    ? VkWriteBlocked
                    : VkApiError;
  return new Cls(code, message, opts);
}

/** Ответ метода: ошибка VK или null. */
export function classify(payload: unknown, method = ''): VkApiError | null {
  const err = (payload as { error?: unknown } | null)?.error;
  if (!err || typeof err !== 'object') return null;
  const e = err as Record<string, unknown>;
  const sub = typeof e.error_subcode === 'number' ? e.error_subcode : null;
  const out = errorFor(Number(e.error_code ?? 0), String(e.error_msg ?? ''), {
    subcode: sub,
    method,
  });
  if (out instanceof VkCaptcha && typeof e.redirect_uri === 'string')
    out.redirectUri = e.redirect_uri;
  return out;
}

// ── Ошибки выпуска токена ────────────────────────────────────────────────────

/** Куки сессии больше не принимаются: нужен новый вход браузером. */
export class VkSessionExpired extends Error {
  name = 'VkSessionExpired';
}

/** web_token не выпущен; `info` — error_info от VK. */
export class VkTokenMintFailed extends Error {
  name = 'VkTokenMintFailed';
  constructor(
    readonly info: string,
    readonly detail = '',
  ) {
    super(
      `web_token не выпущен: ${info || 'без описания'}${detail ? ` (${detail})` : ''}`,
    );
  }
}
