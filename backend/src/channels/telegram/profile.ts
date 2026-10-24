export const USERNAME_RX = /^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/;

export function cleanUsername(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/^@+/, '');
}

export function usernameError(username: string): string | null {
  if (!username) return null;
  if (!USERNAME_RX.test(username))
    return 'ник: 5–32 символа, латиница, цифры и «_», начинается с буквы';
  return null;
}

export function profileErrorText(error: unknown): string {
  const raw = String(
    (error as { errorMessage?: string })?.errorMessage ??
      (error as Error)?.message ??
      error,
  );
  const seconds = Number(
    (error as { seconds?: number })?.seconds ??
      /FLOOD_WAIT_(\d+)/.exec(raw)?.[1] ??
      0,
  );
  if (/USERNAME_OCCUPIED/.test(raw)) return 'этот ник уже занят в Telegram';
  if (/USERNAME_INVALID/.test(raw))
    return 'Telegram не принял ник: 5–32 символа, латиница, цифры и «_»';
  if (/USERNAME_PURCHASE_AVAILABLE/.test(raw))
    return 'этот ник продаётся на Fragment — выберите другой';
  if (/FIRSTNAME_INVALID/.test(raw)) return 'Telegram не принял имя';
  if (
    /PHOTO_(CROP_SIZE_SMALL|EXT_INVALID|INVALID|FILE_MISSING)|IMAGE_PROCESS_FAILED/.test(
      raw,
    )
  )
    return 'Telegram не принял фото: нужна картинка побольше (от 160×160)';
  if (/FLOOD_WAIT|FLOOD_PREMIUM_WAIT/.test(raw)) {
    const wait =
      seconds >= 3600
        ? `${Math.ceil(seconds / 3600)} ч`
        : seconds >= 60
          ? `${Math.ceil(seconds / 60)} мин`
          : `${seconds || 'несколько'} с`;
    return `Telegram временно запретил менять профиль — попробуйте через ${wait}`;
  }
  return raw;
}
