import { offlineReason, offlineReasonOf } from './offline-reason';
import { TelegramTimeoutError } from './timeout';

const base = {
  configured: true,
  live: false,
  held: false,
  connecting: false,
  failure: null,
};

describe('почему аккаунт не в сети', () => {
  it('ошибки подключения — словами', () => {
    expect(
      offlineReasonOf(
        new Error('SocksClientError: connect ECONNREFUSED 1.2.3.4:5'),
      ),
    ).toMatch(/^прокси не отвечает/);
    expect(
      offlineReasonOf(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })),
    ).toMatch(/нет связи.*ETIMEDOUT/);
    expect(
      offlineReasonOf(new TelegramTimeoutError(7, 'connect', 60_000)),
    ).toBe('Telegram не отвечает — переподключаемся');
    expect(offlineReasonOf(new Error('account 7 has no session'))).toBe(
      'нет сессии — нужно войти',
    );
  });

  it('состояние сервиса: в сети, ключей нет, отключён, подключается, после перезапуска', () => {
    expect(offlineReason({ ...base, live: true })).toBeNull();
    expect(offlineReason({ ...base, configured: false })).toMatch(
      /ключи Telegram/,
    );
    expect(offlineReason({ ...base, held: true })).toMatch(/не активен/);
    expect(offlineReason({ ...base, connecting: true })).toBe('подключается');
    expect(
      offlineReason({
        ...base,
        connecting: true,
        failure: { reason: 'прокси не отвечает', at: 1 },
      }),
    ).toMatch(/прошлая попытка: прокси/);
    expect(offlineReason({ ...base, failure: { reason: 'X', at: 1 } })).toBe(
      'X',
    );
    expect(offlineReason(base)).toMatch(/после перезапуска сервера/);
  });
});
