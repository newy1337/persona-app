import { dropRepeatedGreeting } from './reply';
import { greeting } from './snapshot';
import { pacingAllowsAsk } from './judgment';
import type { CharacterConfig, ConversationState } from '../kernel/types';

const OPENER_TS = 1_789_374_600;

const stateWithOpener = (): ConversationState =>
  ({
    history: [
      {
        id: '1',
        role: 'assistant',
        content: 'Привет, это Настя с beboo',
        created_at: OPENER_TS,
        source: 'outreach',
      },
    ],
    character: {},
    memories: [],
  }) as unknown as ConversationState;

describe('она уже поздоровалась', () => {
  it('первое сообщение лиду полчаса назад — здороваться снова нельзя', () => {
    const g = greeting(stateWithOpener(), OPENER_TS + 2 * 60);
    expect(g.already_greeted).toBe(true);
    expect(g.greeting_note).toMatch(/не здоровайся снова/i);
    expect(g.greeting_note).toMatch(/одним лёгким вопросом о нём/);
  });

  it('на следующий день приветствие снова уместно', () => {
    expect(
      greeting(stateWithOpener(), OPENER_TS + 20 * 3600).already_greeted,
    ).toBe(false);
  });

  it('разговора ещё не было — здороваться можно', () => {
    expect(
      greeting({ history: [] } as unknown as ConversationState, OPENER_TS)
        .already_greeted,
    ).toBe(false);
  });
});

describe('страховка от второго «привет» в готовой реплике', () => {
  it('реплика из того диалога', () => {
    expect(
      dropRepeatedGreeting(
        'привет)\nкак сам? что ищешь тут, знакомства просто или что-то конкретное',
      ),
    ).toBe('как сам? что ищешь тут, знакомства просто или что-то конкретное');
  });

  it.each([
    ['Приветик! как день прошёл?', 'как день прошёл?'],
    ['Привет, рада что ответил)', 'рада что ответил)'],
    ['здравствуй 🙂 да, это я', 'да, это я'],
    ['добрый вечер) как ты', 'как ты'],
  ])('«%s»', (input, expected) => {
    expect(dropRepeatedGreeting(input)).toBe(expected);
  });

  it('слово, а не приветствие, и реплика из одного приветствия — не трогаются', () => {
    expect(dropRepeatedGreeting('приветливо ты это сказал)')).toBe(
      'приветливо ты это сказал)',
    );
    expect(dropRepeatedGreeting('салютую твоему упорству')).toBe(
      'салютую твоему упорству',
    );
    expect(dropRepeatedGreeting('привет)')).toBe('привет)');
    expect(dropRepeatedGreeting('как сам?')).toBe('как сам?');
  });
});

describe('темп анкеты из «Целей»', () => {
  const config = (pacing: Record<string, unknown> = {}) =>
    ({
      goals: { stages: [{ id: 'knock', pacing }] },
    }) as unknown as CharacterConfig;
  const never = () => 1;

  it('на первый ответ анкетный вопрос не задаётся', () => {
    expect(
      pacingAllowsAsk(
        config({ min_turns_between_goals: 2 }),
        { stage_id: 'knock', turns: 1 },
        never,
      ),
    ).toBe(false);
    expect(
      pacingAllowsAsk(
        config({ min_turns_between_goals: 2 }),
        { stage_id: 'knock', turns: 2 },
        never,
      ),
    ).toBe(true);
  });

  it('first_ask_turn у этапа переопределяет умолчание', () => {
    expect(
      pacingAllowsAsk(
        config({ first_ask_turn: 1 }),
        { stage_id: 'knock', turns: 1 },
        never,
      ),
    ).toBe(true);
    expect(
      pacingAllowsAsk(
        config({ first_ask_turn: 4 }),
        { stage_id: 'knock', turns: 3 },
        never,
      ),
    ).toBe(false);
  });

  it('между вопросами — не меньше min_turns_between_goals ходов', () => {
    const c = config({ min_turns_between_goals: 2 });
    expect(
      pacingAllowsAsk(
        c,
        { stage_id: 'knock', turns: 5, last_goal_turn: 4 },
        never,
      ),
    ).toBe(false);
    expect(
      pacingAllowsAsk(
        c,
        { stage_id: 'knock', turns: 6, last_goal_turn: 4 },
        never,
      ),
    ).toBe(true);
  });

  it('chance_to_skip пропускает вопрос в своей доле ходов', () => {
    const c = config({ chance_to_skip: 0.2 });
    expect(pacingAllowsAsk(c, { stage_id: 'knock', turns: 5 }, () => 0.1)).toBe(
      false,
    );
    expect(pacingAllowsAsk(c, { stage_id: 'knock', turns: 5 }, () => 0.5)).toBe(
      true,
    );
  });
});
