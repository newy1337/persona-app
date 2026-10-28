import type Anthropic from '@anthropic-ai/sdk';
import {
  GATEWAY_ROUTE,
  gatewayBaseUrl,
  gatewayBusy,
  responseRoute,
  withGateway,
  withoutRouteKey,
} from './gateway';
import { usageValues } from './usage';

const params = {
  model: 'claude-sonnet-5',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'привет' }],
} as Anthropic.MessageCreateParamsNonStreaming;

const reply = (text: string) =>
  ({
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1000, output_tokens: 100, openrouter_cost: null },
  }) as unknown as Anthropic.Message;

function setup(
  gatewayImpl: () => Promise<Anthropic.Message>,
  extra: { maxConcurrent?: number } = {},
) {
  let clock = 0;
  const gateway = { messages: { create: jest.fn(gatewayImpl) } };
  const fallback = {
    messages: { create: jest.fn(async () => reply('openrouter')) },
  };
  const log = { warn: jest.fn(), log: jest.fn() };
  const client = withGateway(gateway as any, fallback as any, {
    log,
    failLimit: 2,
    pauseMs: 60_000,
    waitMs: 10_000,
    retryMs: 1_000,
    maxConcurrent: extra.maxConcurrent ?? 5,
    now: () => clock,
    // Ожидание в тестах — только сдвиг часов, без реальных таймеров.
    sleep: async (ms: number) => {
      clock += ms;
      await Promise.resolve();
    },
  });
  return {
    client,
    gateway,
    fallback,
    log,
    tick: (ms: number) => (clock += ms),
  };
}

const text = (m: Anthropic.Message) =>
  (m.content[0] as Anthropic.TextBlock).text;

describe('шлюз LLM с откатом на OpenRouter', () => {
  it('шлюз ответил — OpenRouter не трогаем, ответ помечен и бесплатен', async () => {
    const { client, fallback } = setup(async () => reply('шлюз'));
    const res = await client.messages.create(params);
    expect(text(res)).toBe('шлюз');
    expect(fallback.messages.create).not.toHaveBeenCalled();
    expect(responseRoute(res)).toBe(GATEWAY_ROUTE);
    expect(usageValues(res, 'claude-sonnet-5').providerEstimatedCostUsd).toBe(
      0,
    );
  });

  it('шлюз упал — тот же запрос уходит в OpenRouter', async () => {
    const { client, fallback, log } = setup(async () => {
      throw new Error('OpenRouter 503: gateway down');
    });
    const res = await client.messages.create(params);
    expect(text(res)).toBe('openrouter');
    expect(fallback.messages.create).toHaveBeenCalledWith(params, undefined);
    expect(responseRoute(res)).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('запрос ушёл в OpenRouter'),
    );
  });

  it('после отказов подряд шлюз на паузе, потом пробуем снова', async () => {
    const { client, gateway, tick } = setup(async () => {
      throw new Error('нет связи');
    });
    await client.messages.create(params);
    await client.messages.create(params);
    await client.messages.create(params);
    expect(gateway.messages.create).toHaveBeenCalledTimes(2);
    tick(60_000);
    gateway.messages.create.mockImplementation(async () => reply('ожил'));
    expect(text(await client.messages.create(params))).toBe('ожил');
  });

  it('удачный ответ сбрасывает счётчик отказов', async () => {
    let fail = true;
    const { client, gateway } = setup(async () => {
      if (fail) throw new Error('сбой');
      return reply('ok');
    });
    await client.messages.create(params);
    fail = false;
    await client.messages.create(params);
    fail = true;
    await client.messages.create(params);
    await client.messages.create(params);
    // Пауза только после двух отказов подряд: четыре вызова дошли до шлюза.
    expect(gateway.messages.create).toHaveBeenCalledTimes(4);
  });

  it('запрос отменили — в OpenRouter не идём', async () => {
    const controller = new AbortController();
    const { client, fallback } = setup(async () => {
      controller.abort(new Error('отменено'));
      throw new Error('aborted');
    });
    await expect(
      client.messages.create(params, { signal: controller.signal }),
    ).rejects.toThrow('отменено');
    expect(fallback.messages.create).not.toHaveBeenCalled();
  });

  it('адрес шлюза с /v1 и без — одно и то же', () => {
    expect(gatewayBaseUrl('http://h:3000')).toBe('http://h:3000/v1');
    expect(gatewayBaseUrl('http://h:3000/v1/')).toBe('http://h:3000/v1');
  });

  it('«занято» (429) — повтор в шлюзе, OpenRouter не трогаем', async () => {
    let busy = 2;
    const { client, gateway, fallback } = setup(async () => {
      if (busy-- > 0)
        throw Object.assign(
          new Error('OpenRouter 429: No Agent key has available capacity.'),
          { status: 429 },
        );
      return reply('дождались');
    });
    expect(text(await client.messages.create(params))).toBe('дождались');
    expect(gateway.messages.create).toHaveBeenCalledTimes(3);
    expect(fallback.messages.create).not.toHaveBeenCalled();
  });

  it('«занято» дольше ожидания — в OpenRouter, но шлюз не на паузе', async () => {
    const { client, gateway, fallback } = setup(async () => {
      throw new Error('OpenRouter 429: No Agent key has available capacity.');
    });
    expect(text(await client.messages.create(params))).toBe('openrouter');
    expect(text(await client.messages.create(params))).toBe('openrouter');
    expect(text(await client.messages.create(params))).toBe('openrouter');
    expect(fallback.messages.create).toHaveBeenCalledTimes(3);
    // Каждый запрос снова пробовал шлюз: «занято» не считается поломкой.
    const calls = gateway.messages.create.mock.calls.length;
    gateway.messages.create.mockImplementation(async () =>
      reply('освободился'),
    );
    expect(text(await client.messages.create(params))).toBe('освободился');
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('слоты заняты нашими запросами — ждём слот, а не платим', async () => {
    let release!: () => void;
    const first = new Promise<void>((r) => (release = r));
    let n = 0;
    const { client, gateway, fallback } = setup(
      async () => {
        n += 1;
        if (n === 1) await first;
        return reply(`шлюз ${n}`);
      },
      { maxConcurrent: 1 },
    );
    const a = client.messages.create(params);
    const b = client.messages.create(params);
    await Promise.resolve();
    release();
    expect(text(await a)).toBe('шлюз 1');
    expect(text(await b)).toBe('шлюз 2');
    expect(gateway.messages.create).toHaveBeenCalledTimes(2);
    expect(fallback.messages.create).not.toHaveBeenCalled();
  });

  it('слот так и не освободился — в OpenRouter', async () => {
    const { client, fallback } = setup(
      () => new Promise<Anthropic.Message>(() => undefined),
      { maxConcurrent: 1 },
    );
    void client.messages.create(params);
    expect(text(await client.messages.create(params))).toBe('openrouter');
    expect(fallback.messages.create).toHaveBeenCalledTimes(1);
  });

  it('что считается «занято»', () => {
    expect(gatewayBusy({ status: 429 })).toBe(true);
    expect(
      gatewayBusy(
        new Error('OpenRouter 429: No Agent key has available capacity.'),
      ),
    ).toBe(true);
    expect(gatewayBusy(new Error('OpenRouter 503: down'))).toBe(false);
    expect(gatewayBusy(new Error('нет связи'))).toBe(false);
  });

  it('липкий маршрут: чат, ушедший в OpenRouter, 15 минут остаётся там, другие чаты — нет', async () => {
    let busy = true;
    const { client, gateway, fallback, tick } = setup(async () => {
      if (busy)
        throw Object.assign(
          new Error('OpenRouter 429: No Agent key has available capacity.'),
          { status: 429 },
        );
      return reply('шлюз');
    });
    const a = { routeKey: 'chat:1' } as any;
    expect(text(await client.messages.create(params, a))).toBe('openrouter');
    busy = false;
    const calls = gateway.messages.create.mock.calls.length;
    // Тот же чат — сразу в OpenRouter, шлюз не трогаем.
    expect(text(await client.messages.create(params, a))).toBe('openrouter');
    expect(gateway.messages.create.mock.calls.length).toBe(calls);
    // Другой чат — как обычно, через шлюз.
    expect(
      text(await client.messages.create(params, { routeKey: 'chat:2' } as any)),
    ).toBe('шлюз');
    // Через 15 минут чат 1 снова пробует шлюз.
    tick(15 * 60_000);
    expect(text(await client.messages.create(params, a))).toBe('шлюз');
    // Ключ маршрута до клиентов не доходит.
    for (const [, opts] of [
      ...gateway.messages.create.mock.calls,
      ...fallback.messages.create.mock.calls,
    ] as any[])
      expect(opts?.routeKey).toBeUndefined();
  });

  it('без шлюза ключ маршрута снимается перед вызовом модели', async () => {
    const direct = {
      messages: { create: jest.fn(async () => reply('напрямую')) },
    };
    const client = withoutRouteKey(direct as any);
    await client.messages.create(params, {
      routeKey: 'chat:1',
      signal: undefined,
    } as any);
    expect((direct.messages.create.mock.calls[0] as any[])[1]).toEqual({
      signal: undefined,
    });
  });
});
