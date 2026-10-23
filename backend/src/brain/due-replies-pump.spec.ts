import { appConfig } from 'src/config/app.config';
import { NastyaBrainService } from './nastya-brain.service';

type Due = { chatId: number; accountId: number };

/**
 * Насос очереди ответов (pumpDueReplies): крон зовёт его раз в 5 секунд, а он
 * не ждёт, пока ответит вся пачка, — держит занятыми до replyLanes аккаунтов.
 * Здесь генерация ответа заменена управляемыми «долгими» обещаниями.
 */
describe('насос очереди ответов', () => {
  const lanesBefore = appConfig.replyLanes;
  afterEach(() => {
    (appConfig as { replyLanes: number }).replyLanes = lanesBefore;
  });

  function brain(due: Due[], lanes = 12) {
    (appConfig as { replyLanes: number }).replyLanes = lanes;
    const svc: any = Object.create(NastyaBrainService.prototype);
    const done = new Set<number>();
    const started: number[] = [];
    const gates = new Map<number, () => void>();
    Object.assign(svc, {
      history: { unprocessedInbound: async () => [] },
      // Ответивший чат уходит из расписания, как в настоящем сервисе.
      schedule: { dueRows: async () => due.filter((d) => !done.has(d.chatId)) },
      clock: { ts: () => 1_000 },
      log: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
      composing: new Set(),
      nextActionCache: new Map(),
      locks: { run: (_id: number, body: () => Promise<boolean>) => body() },
      pumpAccounts: new Set(),
      pumpChats: new Set(),
      pumpGenerating: new Set(),
      pumping: null,
      pumpAgain: false,
      recovering: false,
    });
    svc.respondLocked = (chatId: number) =>
      new Promise<boolean>((resolve, reject) => {
        started.push(chatId);
        gates.set(chatId, () => {
          done.add(chatId);
          if (chatId < 0) reject(new Error('модель не ответила'));
          else resolve(true);
        });
      });
    const finish = async (chatId: number) => {
      gates.get(chatId)!();
      // Дать отработать finally и следующему проходу насоса.
      for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    };
    const flush = async () => {
      for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    };
    // Ответ сочинён, бот «печатает»: так respondCurrent зовёт freeLane перед отправкой.
    const typing = async (chatId: number) => {
      svc.freeLane(chatId);
      await flush();
    };
    return { svc, started, finish, typing };
  }

  it('не ждёт ответов: возвращается сразу, сочинение идёт в фоне', async () => {
    const { svc, started } = brain([{ chatId: 10, accountId: 1 }]);
    expect(await svc.pumpDueReplies()).toBe(1);
    expect(started).toEqual([10]);
    expect(svc.pumpAccounts.has(1)).toBe(true);
  });

  it('долгий ответ одного аккаунта не держит остальные', async () => {
    const due = [
      { chatId: 10, accountId: 1 }, // долгий
      { chatId: 20, accountId: 2 },
      { chatId: 21, accountId: 2 },
      { chatId: 22, accountId: 2 },
    ];
    const { svc, started, finish } = brain(due);
    await svc.pumpDueReplies();
    expect(started).toEqual([10, 20]);
    await finish(20);
    expect(started).toEqual([10, 20, 21]);
    await finish(21);
    expect(started).toEqual([10, 20, 21, 22]);
    // Чат 10 всё ещё сочиняется, а аккаунт 2 разобрал свою очередь.
    expect(svc.pumpChats.has(10)).toBe(true);
  });

  it('у одного аккаунта — по одному чату за раз', async () => {
    const due = [10, 11, 12].map((chatId) => ({ chatId, accountId: 7 }));
    const { svc, started } = brain(due);
    await svc.pumpDueReplies();
    await svc.pumpDueReplies();
    expect(started).toEqual([10]);
  });

  it('одновременно не больше replyLanes аккаунтов, освободившийся сразу занят снова', async () => {
    const due = Array.from({ length: 5 }, (_, i) => ({
      chatId: i + 1,
      accountId: i + 1,
    }));
    const { svc, started, finish } = brain(due, 3);
    await svc.pumpDueReplies();
    expect(started).toEqual([1, 2, 3]);
    await finish(2);
    expect(started).toEqual([1, 2, 3, 4]);
    expect(svc.pumpAccounts.size).toBe(3);
  });

  it('пока бот печатает, его место в очереди занимает следующий чат', async () => {
    const due = Array.from({ length: 5 }, (_, i) => ({
      chatId: i + 1,
      accountId: i + 1,
    }));
    const { svc, started, finish, typing } = brain(due, 2);
    await svc.pumpDueReplies();
    expect(started).toEqual([1, 2]);
    // Чат 1 сочинён и печатается — сочиняющих 1 из 2, берём третий.
    await typing(1);
    expect(started).toEqual([1, 2, 3]);
    await typing(2);
    await typing(3);
    expect(started).toEqual([1, 2, 3, 4, 5]);
    // Печатают 1–3, сочиняют 4–5: места заняты, но аккаунты печатающих тоже заняты.
    expect(svc.pumpGenerating.size).toBe(2);
    expect(svc.pumpAccounts.size).toBe(5);
    // Допечатал — аккаунт свободен, место не трогается: его уже отдали раньше.
    await finish(1);
    expect(svc.pumpAccounts.has(1)).toBe(false);
    expect(svc.pumpGenerating.size).toBe(2);
  });

  it('пока аккаунт печатает в одном чате, второй его чат ждёт', async () => {
    const due = [
      { chatId: 10, accountId: 1 },
      { chatId: 11, accountId: 1 },
    ];
    const { svc, started, finish, typing } = brain(due, 2);
    await svc.pumpDueReplies();
    await typing(10);
    expect(started).toEqual([10]);
    await finish(10);
    expect(started).toEqual([10, 11]);
  });

  it('повторный проход не запускает чат, который уже в работе', async () => {
    const { svc, started } = brain([{ chatId: 10, accountId: 1 }]);
    await svc.pumpDueReplies();
    await svc.pumpDueReplies();
    await svc.pumpDueReplies();
    expect(started).toEqual([10]);
  });

  it('упавший ответ освобождает аккаунт и не роняет насос', async () => {
    const due = [
      { chatId: -5, accountId: 1 },
      { chatId: 6, accountId: 1 },
    ];
    const { svc, started, finish } = brain(due);
    await svc.pumpDueReplies();
    await finish(-5);
    expect(svc.log.error).toHaveBeenCalled();
    expect(started).toEqual([-5, 6]);
    expect(svc.composing.size).toBe(1);
  });

  it('сбой фонового восстановления входящих не роняет процесс', async () => {
    const { svc } = brain([]);
    svc.history.unprocessedInbound = async () => {
      throw new Error('Response from the Engine was empty');
    };
    await svc.pumpDueReplies();
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    expect(svc.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('inbound recovery failed'),
    );
    expect(svc.recovering).toBe(false);
  });

  it('о длинной очереди предупреждает, пустую не трогает', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      chatId: i + 1,
      accountId: 1,
    }));
    const loaded = brain(many);
    await loaded.svc.pumpDueReplies();
    expect(loaded.svc.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('очередь ответов: 20 чатов'),
    );
    const empty = brain([]);
    expect(await empty.svc.pumpDueReplies()).toBe(0);
    expect(empty.svc.log.warn).not.toHaveBeenCalled();
  });
});
