import { TelegramService } from './telegram.service';

describe('сторож офлайн-аккаунтов', () => {
  function service(now: () => number) {
    const prisma = { tgAccount: { findMany: async () => [{ id: 28 }] } };
    const svc: any = Object.create(TelegramService.prototype);
    Object.defineProperty(svc, 'configured', { value: true });
    Object.assign(svc, {
      prisma,
      clock: { ts: now },
      log: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
      stopping: false,
      live: new Map(),
      held: new Set(),
      connecting: new Map(),
      connectSeq: 0,
    });
    return svc;
  }

  it('зависшая попытка блокирует новую только пять минут', async () => {
    let now = 1_000;
    const svc = service(() => now);
    const hanging: Array<() => void> = [];
    svc.connectNow = jest.fn(
      () => new Promise<void>((resolve) => hanging.push(resolve)),
    );
    void svc.connect(28);
    await new Promise((r) => setImmediate(r));
    expect(svc.connectNow).toHaveBeenCalledTimes(1);

    now += 60;
    await svc.reviveOffline();
    expect(svc.connectNow).toHaveBeenCalledTimes(1);

    now += 300;
    void svc.reviveOffline();
    await new Promise((r) => setImmediate(r));
    expect(svc.connectNow).toHaveBeenCalledTimes(2);
    for (const done of hanging) done();
  });

  it('упавшая попытка не мешает следующей', async () => {
    const svc = service(() => 1_000);
    svc.connectNow = jest.fn(async () => {
      throw new Error('аккаунт #28: Telegram не ответил за 60 с (connect)');
    });
    await svc.reviveOffline();
    await svc.reviveOffline();
    expect(svc.connectNow).toHaveBeenCalledTimes(2);
  });

  it('намеренно отключённый аккаунт сторож не трогает, пока его не вернут', async () => {
    const svc = service(() => 1_000);
    svc.connectNow = jest.fn(async () => undefined);
    svc.held.add(28);
    await svc.reviveOffline();
    expect(svc.connectNow).not.toHaveBeenCalled();

    svc.release(28);
    await svc.reviveOffline();
    expect(svc.connectNow).toHaveBeenCalledTimes(1);
  });
});
