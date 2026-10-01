import { NastyaBrainService } from './nastya-brain.service';

describe('разбор очереди ответов', () => {
  function brain(due: Array<{ chatId: number; accountId: number }>) {
    const svc: any = Object.create(NastyaBrainService.prototype);
    const started: number[] = [];
    const finished: number[] = [];
    let alive = 0;
    let peak = 0;
    Object.assign(svc, {
      history: { unprocessedInbound: async () => [] },
      schedule: { dueRows: async () => due },
      clock: { ts: () => 1_000 },
      log: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
      composing: new Set(),
      nextActionCache: new Map(),
      locks: { run: (_id: number, body: () => Promise<boolean>) => body() },
    });
    svc.respondLocked = async (chatId: number) => {
      started.push(chatId);
      alive += 1;
      peak = Math.max(peak, alive);
      await new Promise((r) => setTimeout(r, 20));
      alive -= 1;
      finished.push(chatId);
      return true;
    };
    return { svc, started, finished, peak: () => peak };
  }

  it('разные аккаунты отвечают одновременно', async () => {
    const due = [1, 2, 3, 4].map((n) => ({ chatId: n * 10, accountId: n }));
    const { svc, peak } = brain(due);
    const sent = await svc.runDueReplies();
    expect(sent).toBe(4);
    expect(peak()).toBe(4);
  });

  it('чаты одного аккаунта — по очереди, иначе с одного номера летит пачка', async () => {
    const due = [
      { chatId: 10, accountId: 7 },
      { chatId: 11, accountId: 7 },
      { chatId: 12, accountId: 7 },
    ];
    const { svc, peak, finished } = brain(due);
    await svc.runDueReplies();
    expect(peak()).toBe(1);
    expect(finished).toEqual([10, 11, 12]);
  });

  it('одновременно работает не больше шести аккаунтов', async () => {
    const due = Array.from({ length: 20 }, (_, i) => ({
      chatId: i,
      accountId: i,
    }));
    const { svc, peak } = brain(due);
    await svc.runDueReplies();
    expect(peak()).toBe(6);
  });

  it('упавший чат не уносит с собой остальные', async () => {
    const due = [1, 2, 3].map((n) => ({ chatId: n, accountId: n }));
    const { svc, finished } = brain(due);
    const ok = svc.respondLocked;
    svc.respondLocked = async (chatId: number) => {
      if (chatId === 2) throw new Error('модель не ответила');
      return ok(chatId);
    };
    const sent = await svc.runDueReplies();
    expect(sent).toBe(2);
    expect(finished.sort()).toEqual([1, 3]);
    expect(svc.composing.size).toBe(0);
  });

  it('пустая очередь не будит ничего лишнего', async () => {
    const { svc } = brain([]);
    expect(await svc.runDueReplies()).toBe(0);
  });
});
