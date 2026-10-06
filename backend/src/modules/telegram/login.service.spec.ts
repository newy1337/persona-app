import {
  LoginService,
  loginErrorText,
  loginLink,
  qrSvg,
} from './login.service';

describe('вход в Telegram-аккаунт из панели', () => {
  function service(connect: () => Promise<void>) {
    const client = {
      connect: jest.fn(connect),
      disconnect: jest.fn(async () => undefined),
      start: jest.fn(),
      signInUserWithQrCode: jest.fn(),
      getMe: jest.fn(async () => ({ id: 1, username: 'acc' })),
      session: { save: () => 'session' },
    };
    const telegram = {
      configured: true,
      isOnline: () => false,
      buildClient: () => client,
      proxyFor: async () => null,
      release: jest.fn(),
      apiCredentials: { apiId: 1, apiHash: 'hash' },
      connect: jest.fn(async () => undefined),
    };
    const prisma = {
      tgAccount: {
        findUnique: async () => ({ id: 7, phoneE164: '+79001234567' }),
        update: async () => undefined,
      },
    };
    return {
      login: new LoginService(
        prisma as any,
        { encrypt: (v: string) => v } as any,
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

  it('ссылка для QR — токен в base64url, как ждёт Telegram', () => {
    expect(loginLink(Buffer.from([251, 255, 190, 1]))).toBe(
      'tg://login?token=-_--AQ',
    );
  });

  it('картинку кода рисует сервер, токен наружу не уходит', async () => {
    const svg = await qrSvg('tg://login?token=abc');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
  });

  it('по умолчанию вход по коду, с method=qr — через сканирование', async () => {
    const { login, client } = service(async () => undefined);
    await login.start(7);
    await new Promise((r) => setImmediate(r));
    expect(client.start).toHaveBeenCalled();
    expect(client.signInUserWithQrCode).not.toHaveBeenCalled();
  });

  it('задание QR отдаёт панели свежую картинку и срок её жизни', async () => {
    const { login, client } = service(async () => undefined);
    client.signInUserWithQrCode.mockImplementation(
      async (_creds: unknown, params: any) => {
        await params.qrCode({ token: Buffer.from([1, 2, 3]), expires: 4242 });
        return { id: 1 };
      },
    );
    const started = await login.start(7, 'qr');
    expect(started.method).toBe('qr');
    await new Promise((r) => setImmediate(r));
    const snap = login.status(started.job_id);
    expect(snap.qr_expires_at).toBe(4242);
    expect(snap.qr_svg?.startsWith('<svg')).toBe(true);
    expect(client.start).not.toHaveBeenCalled();
  });

  it('пока код не отсканировали, задание ждёт в статусе need_qr', async () => {
    const { login, client } = service(async () => undefined);
    client.signInUserWithQrCode.mockImplementation(
      async (_creds: unknown, params: any) => {
        await params.qrCode({ token: Buffer.from([9]), expires: 1 });
        return new Promise(() => undefined);
      },
    );
    const started = await login.start(7, 'qr');
    await new Promise((r) => setImmediate(r));
    expect(login.status(started.job_id).status).toBe('need_qr');
  });
});
