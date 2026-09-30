import { cleanUsername, profileErrorText, usernameError } from './tg-profile';

describe('профиль Telegram-аккаунта', () => {
  it('ник: «@» отрезается, формат проверяется до запроса в Telegram', () => {
    expect(cleanUsername(' @Nastya_01 ')).toBe('Nastya_01');
    expect(usernameError('Nastya_01')).toBeNull();
    expect(usernameError('')).toBeNull();
    expect(usernameError('abc')).toMatch(/5–32/);
    expect(usernameError('1nastya')).toMatch(/с буквы/);
    expect(usernameError('настя_ок')).toMatch(/латиница/);
  });

  it('ошибки Telegram — словами', () => {
    expect(profileErrorText({ errorMessage: 'USERNAME_OCCUPIED' })).toBe(
      'этот ник уже занят в Telegram',
    );
    expect(
      profileErrorText({ errorMessage: 'FLOOD_WAIT_7200', seconds: 7200 }),
    ).toMatch(/через 2 ч/);
    expect(
      profileErrorText(
        new Error('A wait of 90 seconds is required (FLOOD_WAIT_90)'),
      ),
    ).toMatch(/через 2 мин/);
    expect(profileErrorText({ errorMessage: 'PHOTO_CROP_SIZE_SMALL' })).toMatch(
      /фото/,
    );
    expect(profileErrorText(new Error('что-то другое'))).toBe('что-то другое');
  });
});
