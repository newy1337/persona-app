import {
  isTelegramTimeout,
  TelegramTimeoutError,
  withTimeout,
} from './timeout';

describe('withTimeout', () => {
  it('успело — результат как есть', async () => {
    await expect(
      withTimeout(Promise.resolve(5), 1000, () => new Error('x')),
    ).resolves.toBe(5);
  });

  it('зависшее обещание не держит вызывающего дольше потолка', async () => {
    const never = new Promise<number>(() => undefined);
    const started = Date.now();
    const err = await withTimeout(
      never,
      50,
      () => new TelegramTimeoutError(2, 'getEntity @ira', 50),
    ).catch((e) => e);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(isTelegramTimeout(err)).toBe(true);
    expect(err.message).toMatch(/аккаунт #2: Telegram не ответил/);
  });

  it('ошибка самой работы пробрасывается без подмены', async () => {
    await expect(
      withTimeout(
        Promise.reject(new Error('FLOOD_WAIT_30')),
        1000,
        () => new Error('x'),
      ),
    ).rejects.toThrow('FLOOD_WAIT_30');
  });
});
