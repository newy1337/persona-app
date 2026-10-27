import { completeText } from './anthropic';
import { windowStart } from './cache';
import { buildMessages } from './generate';
import { judgePayloadBlocks } from '../judge/transport';

const turns = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: `сообщение ${i}`,
  }));

/** Блоки запроса до метки кеша включительно — то, что должно совпасть с прошлым ходом. */
function cachedPrefix(messages: any[]): string[] {
  const out: string[] = [];
  for (const m of messages)
    for (const b of typeof m.content === 'string'
      ? [{ text: m.content }]
      : m.content) {
      out.push(`${m.role}:${b.text}`);
      if (b.cache_control) return out;
    }
  return [];
}

describe('кеш истории', () => {
  it('окно сдвигается блоками: от limit до limit+step-1 сообщений', () => {
    expect(windowStart(30, 40)).toBe(0);
    expect(windowStart(40, 40)).toBe(0);
    expect(windowStart(49, 40)).toBe(0);
    expect(windowStart(50, 40)).toBe(10);
    expect(windowStart(59, 40)).toBe(10);
    expect(windowStart(25, 16, 8)).toBe(8);
  });

  it('генератор: метка на последнем сообщении истории, реплика — отдельным блоком', () => {
    const messages = buildMessages(turns(4) as any, 'новая реплика');
    const last = messages.at(-1)!;
    expect(last.role).toBe('user');
    expect((last.content as any[]).at(-1)).toEqual({
      type: 'text',
      text: 'новая реплика',
    });
    expect(cachedPrefix(messages).at(-1)).toBe('assistant:сообщение 3');
  });

  it('генератор: на следующем ходе начало запроса до прошлой метки то же самое', () => {
    const history = turns(44);
    const now = buildMessages(history as any, 'реплика A');
    const next = buildMessages(
      [
        ...history,
        { role: 'user', content: 'реплика A' },
        { role: 'assistant', content: 'ответ' },
      ] as any,
      'реплика B',
    );
    const before = cachedPrefix(now);
    const flat = next.flatMap((m: any) =>
      m.content.map((b: any) => `${m.role}:${b.text}`),
    );
    expect(flat.slice(0, before.length)).toEqual(before);
  });

  it('судья: история по блоку на сообщение, метка на последнем, состояние — после', () => {
    const blocks = judgePayloadBlocks({
      recent_history: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
      latest_user_message: 'c',
    });
    expect(blocks).toHaveLength(4);
    expect(blocks[2]).toMatchObject({
      text: '{"role":"assistant","content":"b"}',
      cache_control: { type: 'ephemeral' },
    });
    expect(JSON.parse(blocks[3].text)).toEqual({ latest_user_message: 'c' });
  });

  it('cacheHistory: в system только стабильная часть, изменчивое — перед последним блоком', async () => {
    const calls: any[] = [];
    const client = {
      messages: {
        create: async (body: any) => {
          calls.push(body);
          return {
            content: [{ type: 'text', text: 'ок' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    };
    await completeText(
      {
        client: client as any,
        usageDb: { record: async () => undefined } as any,
        logger: { info() {}, warn() {}, error() {} } as any,
      },
      {
        model: 'claude-sonnet-5',
        system: { stable: 'ПРАВИЛА', volatile: 'КОНТЕКСТ: ход 3' },
        messages: buildMessages(turns(2) as any, 'привет'),
        maxTokens: 10,
        effort: 'off',
        stage: 'generator',
        cacheHistory: true,
      },
    );
    const body = calls[0];
    expect(body.system).toHaveLength(1);
    expect(body.system[0].text).toBe('ПРАВИЛА');
    const last = body.messages.at(-1).content;
    expect(last.at(-1).text).toBe('привет');
    expect(last.at(-2).text).toContain('КОНТЕКСТ: ход 3');
    expect(last.at(-2).text).toContain('не сообщение собеседника');
  });
});
