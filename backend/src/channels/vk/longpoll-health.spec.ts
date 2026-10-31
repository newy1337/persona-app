import { VkLongPoll } from './longpoll';

const silent = { warn: () => undefined, log: () => undefined };

describe('VK long poll: сбои приёма подряд видны снаружи', () => {
  afterEach(() => jest.useRealTimers());

  it('считает сбои и последнюю ошибку, после удачного шага — с нуля', async () => {
    jest.useFakeTimers();
    const lp = new VkLongPoll({} as never, null, silent);
    const steps = [
      () => Promise.reject(new Error('Request timeout (40000 ms) exceeded.')),
      () =>
        Promise.reject(
          new Error('Proxy rejected the CONNECT tunnel with status code 504.'),
        ),
      () => Promise.resolve({ updates: [], missed: [], cursor: null }),
    ];
    let i = 0;
    lp.next = (() => steps[i++]()) as never;
    const abort = new AbortController();
    const it = lp.batches(abort.signal);
    const first = it.next();
    await jest.advanceTimersByTimeAsync(0);
    expect(lp.failures).toBe(1);
    await jest.advanceTimersByTimeAsync(60_000);
    await first;
    expect(lp.failures).toBe(0);
    expect(lp.lastError).toBeNull();
    expect(i).toBe(3);
    abort.abort();
  });
});
