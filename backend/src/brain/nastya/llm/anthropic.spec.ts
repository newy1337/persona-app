import { completeText } from './anthropic';

function fakeClient(answer: string) {
  const calls: any[] = [];
  const client = {
    messages: {
      create: async (body: any) => {
        calls.push(body);
        return {
          content: [{ type: 'text', text: answer }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    },
  };
  return { client: client as any, calls };
}

const deps = (client: any, variables?: Record<string, string>) => ({
  client,
  usageDb: { record: async () => undefined } as any,
  logger: { info() {}, warn() {}, error() {} },
  variables,
});

const request = {
  model: 'claude-sonnet-5',
  system: {
    stable: 'ПЕРСОНА: выросла в {city}, познакомились на {site}',
    volatile: 'КОНТЕКСТ: ход 3',
  },
  messages: [{ role: 'user' as const, content: 'ты откуда?' }],
  maxTokens: 100,
  effort: 'off' as const,
  stage: 'generator',
};

describe('completeText: переменные диалога и кеш', () => {
  it('у чатов с разными городами кешируемый блок одинаковый, значения — отдельным блоком после него', async () => {
    const omsk = fakeClient('я из Омск');
    const moscow = fakeClient('я из Москва');
    await completeText(
      deps(omsk.client, { city: 'Омск', site: 'beboo' }),
      request,
    );
    await completeText(
      deps(moscow.client, { city: 'Москва', site: 'mamba' }),
      request,
    );

    const [a, b] = [omsk.calls[0].system, moscow.calls[0].system];
    expect(a[0]).toEqual(b[0]);
    expect(a[0]).toMatchObject({
      text: request.system.stable,
      cache_control: { type: 'ephemeral' },
    });
    expect(a[1].cache_control).toBeUndefined();
    expect(a[1].text).toContain('{city} = Омск');
    expect(a[1].text).toContain('{site} = beboo');
    expect(b[1].text).toContain('{city} = Москва');
    expect(a[2].text).toBe('КОНТЕКСТ: ход 3');
  });

  it('скобки, проскочившие в ответ модели, заполняются значениями чата', async () => {
    const fake = fakeClient('выросла в {city}, а ты тоже с {site}?');
    expect(
      await completeText(
        deps(fake.client, { city: 'Омск', site: 'beboo' }),
        request,
      ),
    ).toBe('выросла в Омск, а ты тоже с beboo?');
  });

  it('значения нет — модель знает, что его нельзя называть', async () => {
    const fake = fakeClient('ок');
    await completeText(deps(fake.client, { site: 'beboo' }), request);
    expect(fake.calls[0].system[1].text).toMatch(/\{city\} — не известно/);
  });

  it('скобок в запросе нет — лишнего блока тоже нет', async () => {
    const fake = fakeClient('ок');
    await completeText(deps(fake.client, { city: 'Омск' }), {
      ...request,
      system: { stable: 'правила', volatile: 'контекст' },
    });
    expect(fake.calls[0].system.map((b: any) => b.text)).toEqual([
      'правила',
      'контекст',
    ]);
  });
});
