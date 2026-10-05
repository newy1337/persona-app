import {
  personaStatements,
  recordPersonaEvents,
  relevantPersonaEvents,
  pruneUnsupportedEvents,
  validatePersonaEvents,
} from './persona-events';
import { historyMessage } from './history';
import { dayState } from '../character/day';
import { buildCharacterPrompt } from '../character/prompt';
import { mergePrompts } from '../config/prompts';

const at = Date.parse('2026-09-20T16:30:00Z') / 1000;
const state = () =>
  ({
    history: [
      historyMessage('assistant', 'Завтра пойду на пилатес', at, 'operator'),
    ],
    persona_events: [],
  }) as any;

it('anchors tomorrow to the original local date and retains it across restart and a long dialogue', () => {
  const s = state();
  recordPersonaEvents(
    s,
    [
      {
        event_id: '',
        source_id: s.history[0].id,
        text: 'Завтра пойду на пилатес',
        status: 'planned',
        due_on: '2099-01-01',
      },
    ],
    'Asia/Bangkok',
    at + 1,
  );
  const reloaded = JSON.parse(JSON.stringify(s));
  reloaded.history.push(
    ...Array.from({ length: 150 }, (_, i) =>
      historyMessage('assistant', 'Понимаю тебя', at + 100 + i, 'dialogue'),
    ),
  );
  const events = relevantPersonaEvents(reloaded.persona_events, 'Как пилатес?');
  expect(events[0]).toMatchObject({
    status: 'planned',
    due_on: '2026-09-21',
    stated_on: '2026-09-20',
  });
  const old = personaStatements(
    reloaded.history,
    'Asia/Bangkok',
    at + 7 * 86400,
    'Как пилатес?',
  );
  expect(old.some((q) => q.text === 'Завтра пойду на пилатес')).toBe(true);
});

it('requires a real own quote, keeps an explicit cancellation, and rejects fabricated source/date updates', () => {
  const s = state();
  const remember: any = {
    event_id: '',
    source_id: s.history[0].id,
    text: s.history[0].content,
    status: 'planned',
    due_on: '',
  };
  recordPersonaEvents(s, [remember], 'Asia/Bangkok', at + 1);
  const id = s.persona_events[0].id;
  s.history.push(
    historyMessage(
      'assistant',
      'Пилатес отменили, никуда не пойду',
      at + 600,
      'operator',
    ),
  );
  recordPersonaEvents(
    s,
    [
      {
        event_id: id,
        source_id: s.history[1].id,
        text: s.history[1].content,
        status: 'cancelled',
        due_on: '',
      },
    ],
    'Asia/Bangkok',
    at + 601,
  );
  expect(s.persona_events).toHaveLength(1);
  expect(s.persona_events[0].status).toBe('cancelled');
  expect(s.persona_events[0].previous[0].status).toBe('planned');
  recordPersonaEvents(
    s,
    [{ ...remember, event_id: id }],
    'Asia/Bangkok',
    at + 700,
  );
  expect(s.persona_events[0].status).toBe('cancelled');
  const sources = personaStatements(s.history, 'Asia/Bangkok', at + 700);
  expect(
    validatePersonaEvents(
      [
        { ...remember, source_id: 'invented' },
        { ...remember, text: 'Уже вернулась домой' },
      ],
      sources,
      s.persona_events,
    ),
  ).toEqual([]);
  s.history[1].content = 'Передумала обсуждать это';
  pruneUnsupportedEvents(s);
  expect(s.persona_events).toEqual([]);
});

it('never turns a client story into the persona event ledger', () => {
  const s = state();
  s.history[0].role = 'user';
  recordPersonaEvents(
    s,
    [
      {
        event_id: '',
        source_id: s.history[0].id,
        text: s.history[0].content,
        status: 'planned',
        due_on: '',
      },
    ],
    'Asia/Bangkok',
    at + 1,
  );
  expect(s.persona_events).toEqual([]);
});

it('removes fabricated completed/current actions from old day pools while retaining an untimed plan', () => {
  const day = dayState(
    {
      pool: {
        today: ['с утра поправила презентацию в Figma, к обеду закончила'],
        now: ['сижу в кафе'],
        mood: ['спокойная'],
        evening_plan: ['Сегодня пилатес'],
      },
    },
    '2026-09-24',
  ) as any;
  expect(JSON.stringify(day)).not.toContain('закончила');
  expect(JSON.stringify(day)).not.toContain('сижу');
  expect(day.plans).toEqual([
    { description: 'Сегодня пилатес', status: 'planned', time: null },
  ]);
  expect(day.background.mood).toBe('спокойная');
  expect(
    dayState(
      { date: '2026-09-24', state: { today: 'уже вернулся из зала' } },
      '2026-09-24',
    ),
  ).toMatchObject({ plans: [] });
});

it('passes persisted plans to the author even beyond the recent quote window', () => {
  const s = state();
  recordPersonaEvents(
    s,
    [
      {
        event_id: '',
        source_id: s.history[0].id,
        text: s.history[0].content,
        status: 'planned',
        due_on: '',
      },
    ],
    'Asia/Bangkok',
    at + 1,
  );
  const runtime = { storylines: [], persona_events: s.persona_events } as any;
  const prompt = buildCharacterPrompt({
    config: { persona: {}, goals: {}, day: {}, storylines: {} },
    name: 'Настя',
    runtime,
    judgment: {},
    prompts: mergePrompts({}),
  });
  expect(prompt.volatile).toContain('2026-09-21');
  expect(prompt.volatile).toContain('Завтра пойду на пилатес');
});

describe('цифра, названная собеседнику, остаётся находимой', () => {
  // Менеджер руками назвал рост; позже собеседник спорит, не повторяя цифру.
  const told = (text: string, source = 'operator') =>
    ({
      history: [
        historyMessage('assistant', text, at, source),
        ...Array.from({ length: 12 }, (_, i) =>
          historyMessage('assistant', `болтовня ${i}`, at + i + 1, 'dialogue'),
        ),
      ],
      persona_events: [],
    }) as any;

  it('цифра связывает вопрос с репликой, где общих слов нет', () => {
    const rows = personaStatements(
      told('у меня 175').history,
      'Europe/Moscow',
      at + 1000,
      'раньше 175 говорила, сейчас другое',
    );
    expect(rows.map((r) => r.text)).toContain('у меня 175');
  });

  it('вопрос без цифры, но про ту же тему, тоже достаёт её', () => {
    const rows = personaStatements(
      told('мой рост 175, а у тебя?').history,
      'Europe/Moscow',
      at + 1000,
      'а ты же вот выше писала другой рост',
    );
    expect(rows.map((r) => r.text)).toContain('мой рост 175, а у тебя?');
  });

  it('реплика менеджера отбирается наравне со своими', () => {
    const rows = personaStatements(
      told('мой рост 175, а у тебя?').history,
      'Europe/Moscow',
      at + 1000,
      'напомни рост',
    );
    expect(rows.find((r) => r.text.includes('175'))?.source).toBe('operator');
  });
});
