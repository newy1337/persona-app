/**
 * Что делать с лидом, когда первое сообщение не ушло.
 *
 * - account — беда нашего аккаунта (заморожен, спам-ограничение, потерян, не
 *   в сети): аккаунт снимается с рассылки на pauseS, лид без траты попытки
 *   уходит другому аккаунту той же личности. permanent — аккаунт сам не
 *   оживёт, поэтому лид не ждёт его, даже если был закреплён за ним.
 * - switch — этот аккаунт не может написать именно этому человеку (он
 *   заблокировал аккаунт, у аккаунта нет доступа к собеседнику): лид уходит
 *   другому аккаунту, сам аккаунт продолжает работать.
 * - recipient — написать этому человеку не может никто: лид мёртвый.
 * - unknown — неизвестная ошибка.
 */
export type OutreachFailure =
  | { kind: 'account'; reason: string; pauseS: number; permanent: boolean }
  | { kind: 'switch'; reason: string }
  | { kind: 'recipient'; reason: string }
  | { kind: 'unknown' };

const DAY = 86400;

/** Ошибка VK API по коду: текст VkApiError начинается с `[код]` или `[код/подкод]`. */
const vk = (...codes: number[]) =>
  new RegExp(`^\\[(?:${codes.join('|')})(?:/\\d+)?\\]`);

const text = (e: unknown): string =>
  String(
    (e as { errorMessage?: string })?.errorMessage ??
      (e as Error)?.message ??
      e ??
      '',
  );

const ACCOUNT: Array<[RegExp, string, number, boolean]> = [
  [
    /FROZEN_METHOD_INVALID|FROZEN_PARTICIPANT_MISSING/i,
    'заморожен Telegram — нужна апелляция',
    7 * DAY,
    true,
  ],
  [
    /PEER_FLOOD/i,
    'спам-ограничение Telegram (PEER_FLOOD): не пишет новым людям',
    DAY,
    false,
  ],
  [
    /(?<!INPUT_)USER_DEACTIVATED|AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|AUTH_KEY_DUPLICATED/i,
    'аккаунт потерян — нужен вход заново',
    DAY,
    true,
  ],
  [
    /is offline|не подключён|CONNECTION_NOT_INITED|Not connected/i,
    'аккаунт не в сети',
    15 * 60,
    false,
  ],
  // VK. Капча и проверка устройства — нужен человек в браузере аккаунта.
  [vk(14), 'VK просит капчу — нужен вход в браузере', DAY, false],
  [vk(17, 24), 'VK просит подтвердить устройство', DAY, true],
  [vk(37, 3610), 'аккаунт VK заблокирован или удалён', DAY, true],
  [
    /VkSessionExpired|VkTokenDead|сессия VK|куки сессии/i,
    'сессия VK завершена — нужен вход заново',
    DAY,
    true,
  ],
  [vk(983, 984, 1021), 'спам-ограничение VK: не пишет новым людям', DAY, false],
  [vk(9, 29), 'флуд-контроль VK', 6 * 3600, false],
];

const SWITCH: Array<[RegExp, string]> = [
  [/USER_IS_BLOCKED|YOU_BLOCKED_USER/i, 'собеседник заблокировал этот аккаунт'],
  [
    /PEER_ID_INVALID|CHANNEL_INVALID|INPUT_USER_INVALID/i,
    'у аккаунта нет доступа к собеседнику',
  ],
  [/CHAT_WRITE_FORBIDDEN/i, 'аккаунту запрещено писать в этот чат'],
  [vk(900), 'собеседник заблокировал этот аккаунт'],
];

const RECIPIENT: Array<[RegExp, string]> = [
  [
    /PRIVACY_PREMIUM_REQUIRED/i,
    'принимает сообщения только от Telegram Premium — обычный аккаунт написать не может',
  ],
  [
    /USER_PRIVACY_RESTRICTED/i,
    'настройки приватности собеседника не дают ему написать',
  ],
  [/INPUT_USER_DEACTIVATED/i, 'аккаунт собеседника удалён'],
  [/USER_IS_BOT|BOT_METHOD_INVALID/i, 'это бот, а не человек'],
  [vk(18), 'страница VK удалена или заблокирована'],
  [
    vk(901, 902, 939, 987, 988),
    'настройки приватности VK не дают ему написать первым',
  ],
  [vk(925, 936, 945, 946), 'переписка с этим человеком в VK недоступна'],
];

export function classifyOutreachError(e: unknown): OutreachFailure {
  const msg = text(e);
  for (const [rx, reason, pauseS, permanent] of ACCOUNT)
    if (rx.test(msg)) return { kind: 'account', reason, pauseS, permanent };
  for (const [rx, reason] of RECIPIENT)
    if (rx.test(msg)) return { kind: 'recipient', reason };
  for (const [rx, reason] of SWITCH)
    if (rx.test(msg)) return { kind: 'switch', reason };
  return { kind: 'unknown' };
}
