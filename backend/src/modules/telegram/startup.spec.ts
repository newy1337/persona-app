import { TelegramService } from './telegram.service';

describe('запуск службы: аккаунты подключаются в фоне', () => {
  const afterEachStop: any[] = [];
  afterEach(() => {
    for (const svc of afterEachStop.splice(0)) svc.stopping = true;
  });

  const service = (accounts: number[]) => {
    const svc: any = Object.create(TelegramService.prototype);
    const connected: number[] = [];
    svc.log = { log: () => {}, warn: () => {}, error: () => {} };
    svc.prisma = {
      tgAccount: { findMany: async () => accounts.map((id) => ({ id })) },
    };
    svc.connect = async (id: number) => {
      connected.push(id);
    };
    Object.defineProperty(svc, 'configured', {
      get: () => true,
      configurable: true,
    });
    return { svc, connected };
  };

  it('onModuleInit возвращается сразу, не дожидаясь очереди подключений', () => {
    const { svc } = service([1, 2, 3]);
    afterEachStop.push(svc);
    const started = Date.now();
    const result = svc.onModuleInit();
    expect(result).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('первый аккаунт всё же подключается', async () => {
    const { svc, connected } = service([7, 8]);
    afterEachStop.push(svc);
    svc.onModuleInit();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(connected).toContain(7);
  });

  it('без ключей Telegram очередь не запускается вовсе', () => {
    const { svc, connected } = service([1]);
    Object.defineProperty(svc, 'configured', {
      get: () => false,
      configurable: true,
    });
    svc.onModuleInit();
    expect(connected).toEqual([]);
  });

  it('остановка службы прерывает очередь', async () => {
    const { svc, connected } = service([1, 2, 3]);
    svc.stopping = true;
    svc.onModuleInit();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(connected).toEqual([]);
  });
});
