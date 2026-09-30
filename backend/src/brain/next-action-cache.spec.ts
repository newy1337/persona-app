import { NastyaBrainService } from './nastya-brain.service';

/**
 * Прогноз для списка диалогов. Он стоит девяти запросов и разбора состояния чата,
 * поэтому раз в полминуты список пересчитывал все чаты разом и открывался две с
 * половиной секунды. Теперь просроченный прогноз отдаётся сразу, а пересчёт идёт
 * следом в фоне.
 */
describe('кеш прогнозов для списка диалогов', () => {
  function brain(now: () => number) {
    const svc: any = Object.create(NastyaBrainService.prototype);
    let computed = 0;
    Object.assign(svc, {
      clock: { ts: now },
      nextActionCache: new Map(),
      refreshing: new Set(),
      refreshQueue: [],
    });
    svc.computeNextAction = async (chatId: number, at: number) => {
      computed += 1;
      const value = { kind: 'reply', at } as any;
      svc.nextActionCache.set(chatId, { at, value });
      return value;
    };
    return { svc, calls: () => computed };
  }

  it('свежий прогноз берётся из кеша', async () => {
    const { svc, calls } = brain(() => 1_000);
    await svc.nextAction(7, 30);
    await svc.nextAction(7, 30);
    expect(calls()).toBe(1);
  });

  it('просроченный отдаётся сразу, а пересчёт идёт в фоне', async () => {
    let now = 1_000;
    const { svc, calls } = brain(() => now);
    const first = await svc.nextAction(7, 30);
    expect(calls()).toBe(1);

    now += 45;
    const second = await svc.nextAction(7, 30);
    expect(second).toBe(first);
    await new Promise((r) => setImmediate(r));
    expect(calls()).toBe(2);
  });

  it('совсем старый прогноз показывать нельзя — считаем заново', async () => {
    let now = 1_000;
    const { svc, calls } = brain(() => now);
    await svc.nextAction(7, 30);
    now += 600;
    await svc.nextAction(7, 30);
    expect(calls()).toBe(2);
  });

  it('без кеша (открытая переписка) прогноз считается честно', async () => {
    const { svc, calls } = brain(() => 1_000);
    await svc.nextAction(7, 0);
    await svc.nextAction(7, 0);
    expect(calls()).toBe(2);
  });

  it('один чат не встаёт в очередь дважды', async () => {
    let now = 1_000;
    const { svc } = brain(() => now);
    await svc.nextAction(7, 30);
    now += 45;
    await svc.nextAction(7, 30);
    await svc.nextAction(7, 30);
    expect(svc.refreshQueue.length + svc.refreshing.size).toBeLessThanOrEqual(
      1,
    );
  });
});
