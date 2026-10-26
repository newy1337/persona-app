import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { Role } from '../enums/roles.enum';
import { MemoMiddleware, MemoService, inReadRequest } from './memo.service';
import { ScopeService } from './scope.service';

const memo = () => {
  const m = new MemoService();
  m.keep = true;
  return m;
};
const flush = () => new Promise((r) => setImmediate(r));

/** Прогоняет fn внутри запроса с этим методом; finish — как ответ ушёл. */
function inRequest<T>(
  m: MemoService,
  method: string,
  fn: () => Promise<T>,
): { result: Promise<T>; finish: () => void } {
  const res = new EventEmitter();
  let result!: Promise<T>;
  new MemoMiddleware(m).use(
    { method } as Request,
    res as unknown as Response,
    (() => {
      result = fn();
    }) as NextFunction,
  );
  return { result, finish: () => res.emit('finish') };
}

describe('MemoService', () => {
  it('одновременные запросы ждут одну загрузку, ответ живёт до срока', async () => {
    const m = memo();
    const load = jest.fn(async () => ({ n: 1 }));
    const [a, b] = await Promise.all([
      m.get('k', 1000, load),
      m.get('k', 1000, load),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    await flush();
    await m.get('k', 1000, load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('срок вышел — грузит заново; ключи не смешиваются', async () => {
    const m = memo();
    const load = jest.fn(async () => 1);
    await m.get('k', 0, load);
    await flush();
    await m.get('k', 0, load);
    await m.get('other', 1000, load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('ошибку не запоминает', async () => {
    const m = memo();
    const load = jest
      .fn<Promise<number>, []>()
      .mockRejectedValueOnce(new Error('база'))
      .mockResolvedValue(2);
    await expect(m.get('k', 1000, load)).rejects.toThrow('база');
    await flush();
    await expect(m.get('k', 1000, load)).resolves.toBe(2);
  });

  it('reset выбрасывает всё, а загрузка, начатая до сброса, свежую запись не затирает', async () => {
    const m = memo();
    let release!: (v: number) => void;
    const slow = m.get(
      'k',
      1000,
      () => new Promise<number>((r) => (release = r)),
    );
    m.reset();
    const fresh = m.get('k', 1000, async () => 2);
    release(1);
    await expect(slow).resolves.toBe(1);
    await expect(fresh).resolves.toBe(2);
    await flush();
    await expect(m.get('k', 1000, async () => 3)).resolves.toBe(2);
  });

  it('в тестах (keep=false) хранит только пока грузится', async () => {
    const m = new MemoService();
    m.keep = false;
    const load = jest.fn(async () => 1);
    await Promise.all([m.get('k', 1000, load), m.get('k', 1000, load)]);
    await flush();
    await m.get('k', 1000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('MemoMiddleware', () => {
  it('GET — чтение; POST сбрасывает кеш, когда ответ ушёл', async () => {
    const m = memo();
    await m.get('k', 60_000, async () => 1);
    await flush();
    expect(await inRequest(m, 'GET', async () => inReadRequest()).result).toBe(
      true,
    );
    const post = inRequest(m, 'POST', async () => inReadRequest());
    expect(await post.result).toBe(false);
    await expect(m.get('k', 60_000, async () => 2)).resolves.toBe(1);
    post.finish();
    await expect(m.get('k', 60_000, async () => 2)).resolves.toBe(2);
    expect(inReadRequest()).toBe(false);
  });
});

describe('ScopeService: кеш прав только на чтение', () => {
  const user = { id: 7, role: Role.TEAMLEAD, regionCode: null } as never;
  const setup = () => {
    const prisma = {
      dashboardUser: { findMany: jest.fn(async () => []) },
      managerAccount: {
        findMany: jest.fn(async () => [{ accountId: 3 }]),
      },
    };
    const m = memo();
    return {
      prisma,
      m,
      scope: new ScopeService(prisma as never, null as never, m),
    };
  };

  it('GET берёт права из кеша, POST и фоновые задачи считают заново', async () => {
    const { prisma, m, scope } = setup();
    const read = async () =>
      (await inRequest(m, 'GET', () => scope.scopeOf(user)).result).accountIds;
    expect(await read()).toEqual([3]);
    await flush();
    expect(await read()).toEqual([3]);
    expect(prisma.managerAccount.findMany).toHaveBeenCalledTimes(1);

    await inRequest(m, 'POST', () => scope.scopeOf(user)).result;
    await scope.scopeOf(user);
    expect(prisma.managerAccount.findMany).toHaveBeenCalledTimes(3);
  });

  it('копия на каждый вызов: правка массива не портит кеш', async () => {
    const { m, scope } = setup();
    const first = await inRequest(m, 'GET', () => scope.scopeOf(user)).result;
    first.accountIds.push(99);
    await flush();
    const again = await inRequest(m, 'GET', () => scope.scopeOf(user)).result;
    expect(again.accountIds).toEqual([3]);
  });
});
