import { LoginService, loginErrorText } from './login.service';

describe('вход в Telegram-аккаунт из панели', () => {
  function service(connect: () => Promise<void>) {
    const client = {
      connect: jest.fn(connect),
      disconnect: jest.fn(async () => undefined),
      start: jest.fn(),
    };
    const telegram = {
      configured: true,
      isOnline: () => false,
      buildClient: () => client,
      proxyFor: async () => null,
      release: jest.fn(),
    };
    const prisma = {
      tgAccount: {
        findUnique: async () => ({ id: 7, phoneE164: '+79001234567' }),
      },
    };
    return {
      login: new LoginService(
        prisma as any,
        {} as any,
        { ts: () => 1 } as any,
        telegram as any,
      ),
      client,
    };
  }

  it('отмена, пока висит подключение через прокси, не роняет процесс и сразу даёт «отменено»', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (r: unknown) => unhandled.push(r);
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    process.on('unhandledRejection', onUnhandled);
    try {
      const { login, client } = service(() => new Promise(() => undefined));
      const job = await login.start(7);
      await new Promise((r) => setImmediate(r));
      expect(login.cancel(job.job_id)).toMatchObject({
        status: 'failed',
        error: 'отменено оператором',
      });
      expect(client.disconnect).toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(45_000);
      expect(login.get(job.job_id).client).toBeUndefined();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      jest.useRealTimers();
    }
  });

  it('ошибки входа словами: нерабочий прокси и частые ответы Telegram', () => {
    expect(
      loginErrorText(
        Object.assign(new Error('Proxy connection timed out'), {
          name: 'SocksClientError',
        }),
      ),
    ).toMatch(/прокси не отвечает/);
    expect(loginErrorText(new Error('PHONE_CODE_INVALID'))).toBe(
      'неверный код из Telegram',
    );
    expect(loginErrorText(new Error('PASSWORD_HASH_INVALID'))).toMatch(
      /неверный пароль/,
    );
  });
});
