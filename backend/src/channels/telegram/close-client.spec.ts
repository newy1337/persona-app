import { closeClient } from './close-client';

describe('закрытие клиента Telegram', () => {
  afterEach(() => jest.useRealTimers());

  const fake = () => ({
    connected: false as boolean | undefined,
    destroy: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
  });

  it('закрывает через destroy, а не disconnect: иначе ping-цикл GramJS живёт дальше', async () => {
    const client = fake();
    await closeClient(client as any);
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('подключение, завершившееся после закрытия, закрывается ещё раз', async () => {
    const client = fake();
    let finish!: () => void;
    const pending = new Promise<void>((r) => (finish = r));
    await closeClient(client as any, { pending });
    expect(client.destroy).toHaveBeenCalledTimes(1);
    finish();
    await new Promise((r) => setImmediate(r));
    expect(client.destroy).toHaveBeenCalledTimes(2);
  });

  it('упавшее подключение не даёт необработанной ошибки', async () => {
    const client = fake();
    const pending = Promise.reject(new Error('proxy down'));
    await closeClient(client as any, { pending });
    await new Promise((r) => setImmediate(r));
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('зависший destroy не держит дольше таймаута', async () => {
    jest.useFakeTimers();
    const client = fake();
    client.destroy.mockImplementation(() => new Promise(() => undefined));
    const done = closeClient(client as any, { timeoutMs: 1000 });
    await jest.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBeUndefined();
  });

  it('если транспорт сам поднял соединение, через пару минут рвёт снова', async () => {
    jest.useFakeTimers();
    const client = fake();
    await closeClient(client as any);
    client.connected = true;
    await jest.advanceTimersByTimeAsync(120_000);
    expect(client.destroy).toHaveBeenCalledTimes(2);
  });

  it('закрывает соединения с другими DC и их таймеры: destroy GramJS их не трогает', async () => {
    jest.useFakeTimers();
    const fired = jest.fn();
    const sender = {
      _autoReconnect: true,
      _pendingState: { clear: jest.fn() },
      disconnect: jest.fn(async () => undefined),
    };
    const client = {
      ...fake(),
      _exportedSenderReleaseTimeouts: new Map([[2, setTimeout(fired, 30_000)]]),
      _exportedSenderPromises: new Map([[2, Promise.resolve(sender)]]),
    };
    await closeClient(client as any);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(fired).not.toHaveBeenCalled();
    expect(sender._autoReconnect).toBe(false);
    expect(sender._pendingState.clear).toHaveBeenCalled();
    expect(sender.disconnect).toHaveBeenCalled();
    expect(client._exportedSenderPromises.size).toBe(0);
  });
});
