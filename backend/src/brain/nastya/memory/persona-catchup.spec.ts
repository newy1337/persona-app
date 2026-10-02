import type { ConversationState } from '../kernel/types';
import {
  catchUpPersonaMemory,
  latestPersonaMessageId,
  undigestedStatements,
} from './persona-catchup';

const message = (
  id: number,
  role: 'user' | 'assistant',
  content: string,
  source = 'dialogue',
) => ({
  id: `panel:${id}`,
  panel_message_id: id,
  role,
  content,
  created_at: 1_000,
  source,
});

const state = (
  messages: ReturnType<typeof message>[],
  cursor?: number,
): ConversationState =>
  ({
    history: messages,
    persona_events: [],
    ...(cursor === undefined ? {} : { persona_memory_cursor: cursor }),
  }) as any;

const deps = (reply: string) => {
  const calls: any[] = [];
  return {
    calls,
    deps: {
      client: {
        messages: {
          create: async (request: any) => {
            calls.push(request);
            return {
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: reply }],
              usage: {},
            };
          },
        },
      },
      usageDb: { record: async () => undefined },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    } as any,
  };
};

describe('догоняющий разбор своих реплик', () => {
  it('берёт и свои, и менеджерские реплики, но не сообщения собеседника', () => {
    const rows = undigestedStatements(
      state([
        message(1, 'user', 'привет'),
        message(2, 'assistant', 'привет, как ты?'),
        message(3, 'assistant', 'я завтра на пилатес', 'operator'),
      ]),
      'Europe/Moscow',
      2_000,
    );
    expect(rows.map((r) => r.text)).toEqual([
      'привет, как ты?',
      'я завтра на пилатес',
    ]);
    expect(rows.map((r) => r.source)).toEqual(['dialogue', 'operator']);
  });

  it('уже разобранное второй раз не берём', () => {
    const rows = undigestedStatements(
      state(
        [
          message(2, 'assistant', 'старое'),
          message(5, 'assistant', 'новое', 'operator'),
        ],
        2,
      ),
      'Europe/Moscow',
      2_000,
    );
    expect(rows.map((r) => r.text)).toEqual(['новое']);
  });

  it('реплика из будущего (отложенная) ещё не считается сказанной', () => {
    const future = { ...message(3, 'assistant', 'потом'), created_at: 9_999 };
    expect(
      undigestedStatements(state([future]), 'Europe/Moscow', 2_000),
    ).toEqual([]);
  });

  it('разбирать нечего — модель не зовём, курсор всё равно двигаем', async () => {
    const { deps: llm, calls } = deps('{}');
    const s = state([message(7, 'assistant', 'уже разобрано')], 7);
    const result = await catchUpPersonaMemory(s, llm, 'Europe/Moscow', 2_000);
    expect(calls).toHaveLength(0);
    expect(result).toEqual({ statements: 0, events: 0 });
    expect(s.persona_memory_cursor).toBe(7);
  });

  it('слова менеджера становятся долговременной памятью', async () => {
    const s = state([
      message(4, 'assistant', 'я в субботу уезжаю в Сочи', 'operator'),
    ]);
    const { deps: llm } = deps(
      JSON.stringify({
        persona_event_updates: [
          {
            event_id: '',
            source_id: 'panel:4',
            text: 'в субботу уезжаю в Сочи',
            status: 'planned',
            due_on: '',
          },
        ],
      }),
    );
    const result = await catchUpPersonaMemory(s, llm, 'Europe/Moscow', 2_000);
    expect(result.events).toBe(1);
    expect(s.persona_events?.[0]?.text).toBe('в субботу уезжаю в Сочи');
    expect(s.persona_memory_cursor).toBe(4);
  });

  it('курсор догоняет последнюю реплику персоны', () => {
    expect(
      latestPersonaMessageId(
        state([
          message(3, 'assistant', 'моё'),
          message(9, 'user', 'его'),
          message(7, 'assistant', 'моё позже', 'operator'),
        ]),
      ),
    ).toBe(7);
  });
});
