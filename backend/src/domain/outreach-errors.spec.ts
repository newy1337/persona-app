import { classifyOutreachError } from './outreach-errors';

const err = (m: string) => new Error(m);

describe('ошибки первого сообщения', () => {
  it('заморозка аккаунта — снять аккаунт надолго и не ждать его', () => {
    expect(
      classifyOutreachError(
        err('420: FROZEN_METHOD_INVALID (caused by contacts.ImportContacts)'),
      ),
    ).toMatchObject({ kind: 'account', permanent: true, pauseS: 7 * 86400 });
  });

  it('спам-ограничение и «не в сети» — пауза, лид другому', () => {
    expect(classifyOutreachError(err('400: PEER_FLOOD'))).toMatchObject({
      kind: 'account',
      permanent: false,
    });
    expect(classifyOutreachError(err('account 364 is offline'))).toMatchObject({
      kind: 'account',
      pauseS: 900,
    });
  });

  it('собеседник заблокировал аккаунт — другой аккаунт, без паузы', () => {
    expect(classifyOutreachError(err('400: USER_IS_BLOCKED'))).toMatchObject({
      kind: 'switch',
    });
  });

  it('Premium-only и удалённый собеседник — писать некому', () => {
    expect(
      classifyOutreachError(
        err('403: PRIVACY_PREMIUM_REQUIRED (caused by messages.SendMessage)'),
      ),
    ).toMatchObject({ kind: 'recipient' });
    expect(classifyOutreachError(err('INPUT_USER_DEACTIVATED'))).toMatchObject({
      kind: 'recipient',
    });
  });

  it('ошибка GramJS в errorMessage тоже узнаётся; прочее — unknown', () => {
    expect(
      classifyOutreachError({ errorMessage: 'FROZEN_METHOD_INVALID' }),
    ).toMatchObject({ kind: 'account' });
    expect(classifyOutreachError(err('something else'))).toEqual({
      kind: 'unknown',
    });
  });
});

describe('ошибки VK при первом сообщении', () => {
  const vkError = (code: number, sub?: number) =>
    new Error(`[${code}${sub ? `/${sub}` : ''}] в messages.send x`);

  it('по коду — аккаунт, другой аккаунт или мёртвый лид', () => {
    expect(classifyOutreachError(vkError(14))).toMatchObject({
      kind: 'account',
      permanent: false,
    });
    expect(classifyOutreachError(vkError(37))).toMatchObject({
      kind: 'account',
      permanent: true,
    });
    expect(classifyOutreachError(vkError(984))).toMatchObject({
      kind: 'account',
    });
    expect(classifyOutreachError(vkError(900))).toMatchObject({
      kind: 'switch',
    });
    expect(classifyOutreachError(vkError(902))).toMatchObject({
      kind: 'recipient',
    });
    expect(classifyOutreachError(vkError(18))).toMatchObject({
      kind: 'recipient',
    });
    // Код внутри текста — не код VK.
    expect(
      classifyOutreachError(new Error('ответ [902] где-то в середине')),
    ).toEqual({ kind: 'unknown' });
    expect(classifyOutreachError(vkError(5, 1130))).toEqual({
      kind: 'unknown',
    });
  });
});
