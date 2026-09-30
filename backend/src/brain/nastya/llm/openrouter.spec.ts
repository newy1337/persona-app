import { completeText } from './anthropic';
import {
  createOpenRouterClient,
  fromOpenRouterResponse,
  OpenRouterError,
  openRouterModel,
  toOpenRouterBody,
} from './openrouter';
import { usageValues } from './usage';

const system = [
  {
    type: 'text' as const,
    text: 'ПЕРСОНА: …',
    cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
  },
  { type: 'text' as const, text: 'КОНТЕКСТ: ход 3' },
];

function reply(body: Record<string, unknown>, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: 'x',
    json: async () => body,
  } as unknown as Response;
}

const okBody = {
  id: 'gen-1',
  model: 'anthropic/claude-sonnet-5',
  choices: [
    {
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'привет)' },
    },
  ],
  usage: {
    prompt_tokens: 20000,
    completion_tokens: 40,
    prompt_tokens_details: { cached_tokens: 15000, cache_write_tokens: 0 },
    cost: 0.0123,
  },
};

describe('OpenRouter: запрос', () => {
  it('модель с префиксом anthropic/, свои id не трогаем', () => {
    expect(openRouterModel('claude-opus-5')).toBe('anthropic/claude-opus-5');
    expect(openRouterModel('anthropic/claude-sonnet-5')).toBe(
      'anthropic/claude-sonnet-5',
    );
  });

  it('система — блоки с cache_control и часовым TTL; провайдер закреплён без запасных', () => {
    const body: any = toOpenRouterBody(
      {
        model: 'claude-opus-5',
        max_tokens: 6000,
        system,
        messages: [{ role: 'user', content: '{"a":1}' }],
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
      } as any,
      ['anthropic'],
    );
    expect(body.model).toBe('anthropic/claude-opus-5');
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: [
        {
          type: 'text',
          text: 'ПЕРСОНА: …',
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
        { type: 'text', text: 'КОНТЕКСТ: ход 3' },
      ],
    });
    expect(body.messages[1]).toEqual({ role: 'user', content: '{"a":1}' });
    expect(body.reasoning).toEqual({ effort: 'low', exclude: true });
    expect(body.provider).toEqual({
      order: ['anthropic'],
      allow_fallbacks: false,
    });
    expect(body.max_tokens).toBe(6000);
  });

  it('генератор без думания; картинка — data URL', () => {
    const body: any = toOpenRouterBody({
      model: 'claude-sonnet-5',
      max_tokens: 700,
      system: 'опиши фото',
      thinking: { type: 'disabled' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: 'AAAA',
              },
            },
            { type: 'text', text: '{}' },
          ],
        },
      ],
    } as any);
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.provider).toBeUndefined();
    expect(body.messages[0]).toEqual({ role: 'system', content: 'опиши фото' });
    expect(body.messages[1].content[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AAAA' },
    });
  });
});

describe('OpenRouter: ответ и учёт', () => {
  it('токены кеша раскладываются как у Anthropic; цена — фактическая от OpenRouter', () => {
    const message = fromOpenRouterResponse(okBody, {
      model: 'claude-sonnet-5',
      system,
      messages: [],
      max_tokens: 10,
    } as any);
    expect(message.content[0]).toMatchObject({ type: 'text', text: 'привет)' });
    expect(message.stop_reason).toBe('end_turn');
    expect(message.usage).toMatchObject({
      input_tokens: 5000,
      output_tokens: 40,
      cache_read_input_tokens: 15000,
      cache_creation_input_tokens: 0,
    });
    const values = usageValues(message, 'claude-sonnet-5');
    expect(values).toMatchObject({
      inputTokens: 20000,
      cachedTokens: 15000,
      cacheWriteTokens: 0,
      providerEstimatedCostUsd: 0.0123,
    });
  });

  it('запись кеша при часовом TTL учитывается как часовая', () => {
    const body = {
      ...okBody,
      usage: {
        prompt_tokens: 20000,
        completion_tokens: 10,
        prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 15000 },
      },
    };
    const message = fromOpenRouterResponse(body, {
      model: 'claude-opus-5',
      system,
      messages: [],
      max_tokens: 10,
    } as any);
    expect((message.usage as any).cache_creation).toEqual({
      ephemeral_1h_input_tokens: 15000,
      ephemeral_5m_input_tokens: 0,
    });
    expect(usageValues(message, 'claude-opus-5').cacheWrite1hTokens).toBe(
      15000,
    );
  });

  it('обрыв по длине и отказ — как stop_reason Anthropic', () => {
    const cut = fromOpenRouterResponse(
      { choices: [{ finish_reason: 'length', message: { content: 'обры' } }] },
      { model: 'm', messages: [], max_tokens: 1 } as any,
    );
    expect(cut.stop_reason).toBe('max_tokens');
    const refused = fromOpenRouterResponse(
      {
        choices: [
          {
            finish_reason: 'stop',
            native_finish_reason: 'refusal',
            message: { content: '' },
          },
        ],
      },
      { model: 'm', messages: [], max_tokens: 1 } as any,
    );
    expect(refused.stop_reason).toBe('refusal');
  });
});

describe('OpenRouter: клиент', () => {
  const deps = (client: any) => ({
    client,
    provider: 'openrouter',
    usageDb: { record: jest.fn(async () => undefined) } as any,
    logger: { info() {}, warn() {}, error() {} },
  });

  it('движок получает текст через обычный completeText, расход пишется с провайдером openrouter', async () => {
    const calls: any[] = [];
    const client = createOpenRouterClient({
      apiKey: 'sk-or-test',
      providers: ['anthropic'],
      fetch: (async (url: string, init: any) => {
        calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
        return reply(okBody);
      }) as any,
    });
    const d = deps(client);
    const text = await completeText(d, {
      model: 'claude-sonnet-5',
      system: { stable: 'ПЕРСОНА', volatile: 'ход' },
      messages: [{ role: 'user', content: 'ты откуда?' }],
      maxTokens: 100,
      effort: 'off',
      stage: 'generator',
    });
    expect(text).toBe('привет)');
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].headers.authorization).toBe('Bearer sk-or-test');
    expect(calls[0].body.messages[0].content[0].cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    });
    expect(d.usageDb.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openrouter',
        model: 'claude-sonnet-5',
        cachedTokens: 15000,
      }),
    );
  });

  it('429 и 5xx повторяются; 402 (нет денег) — сразу ошибка словами', async () => {
    let n = 0;
    const flaky = createOpenRouterClient({
      apiKey: 'k',
      maxRetries: 2,
      fetch: (async () =>
        ++n < 2
          ? reply({ error: { code: 429, message: 'rate limited' } }, 429)
          : reply(okBody)) as any,
    });
    await expect(
      (flaky as any).messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).resolves.toMatchObject({ stop_reason: 'end_turn' });
    expect(n).toBe(2);

    let m = 0;
    const broke = createOpenRouterClient({
      apiKey: 'k',
      fetch: (async () => {
        m += 1;
        return reply(
          { error: { code: 402, message: 'Insufficient credits' } },
          402,
        );
      }) as any,
    });
    const err = await (broke as any).messages
      .create({
        model: 'claude-sonnet-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'x' }],
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenRouterError);
    expect(err.message).toMatch(/402.*Insufficient credits/);
    expect(m).toBe(1);
  });

  it('обрыв сети («fetch failed») повторяется; не прошло — ошибка словами', async () => {
    const netError = () =>
      Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNRESET' },
      });
    let n = 0;
    const flaky = createOpenRouterClient({
      apiKey: 'k',
      maxRetries: 2,
      fetch: (async () => {
        n += 1;
        if (n < 2) throw netError();
        return reply(okBody);
      }) as any,
    });
    await expect(
      (flaky as any).messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).resolves.toMatchObject({ stop_reason: 'end_turn' });
    expect(n).toBe(2);

    const down = createOpenRouterClient({
      apiKey: 'k',
      maxRetries: 0,
      fetch: (async () => {
        throw netError();
      }) as any,
    });
    await expect(
      (down as any).messages.create({
        model: 'm',
        max_tokens: 1,
        messages: [],
      }),
    ).rejects.toThrow(/нет связи \(ECONNRESET\)/);
  });

  it('ошибка внутри ответа 200 тоже ошибка', async () => {
    const client = createOpenRouterClient({
      apiKey: 'k',
      maxRetries: 0,
      fetch: (async () =>
        reply({ error: { code: 400, message: 'bad param' } })) as any,
    });
    await expect(
      (client as any).messages.create({
        model: 'm',
        max_tokens: 1,
        messages: [],
      }),
    ).rejects.toThrow(/400: bad param/);
  });
});

it('external cancellation aborts the in-flight request without retrying', async () => {
  const controller = new AbortController();
  const fakeFetch = jest.fn(
    (_url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener(
          'abort',
          () => reject(opts.signal.reason),
          { once: true },
        );
      }),
  );
  const client = createOpenRouterClient({
    apiKey: 'test',
    fetch: fakeFetch as any,
    maxRetries: 3,
  });
  const result = client.messages.create(
    { model: 'test', max_tokens: 10, messages: [] },
    { signal: controller.signal },
  );
  controller.abort(new Error('new input'));
  await expect(result).rejects.toThrow('new input');
  expect(fakeFetch).toHaveBeenCalledTimes(1);
});
