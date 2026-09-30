import { dayContinuity } from './continuity';
import { buildCharacterPrompt } from './prompt';
import { mergePrompts } from '../config/prompts';
const ts = (s: string) => Date.parse(s) / 1000;
const msg = (
  text: string,
  at: string,
  role: 'assistant' | 'user' = 'assistant',
) => ({ role, content: text, created_at: ts(at) });

it('keeps the completed Pilates outside the short history tail with its local time', () => {
  const history = [
    msg('С пилатеса уже вернулась домой', '2026-09-24T09:00:00Z'),
    ...Array.from({ length: 40 }, (_, i) =>
      msg('Понимаю тебя)', `2026-09-24T10:${String(i).padStart(2, '0')}:00Z`),
    ),
  ];
  const result = dayContinuity(
    history,
    'Asia/Bangkok',
    ts('2026-09-24T15:00:00Z'),
    'Ты на пилатес собираешься?',
    { evening_plan: 'сегодня на пилатес' },
  );
  expect(result.previous_statements).toContainEqual({
    date: '2026-09-24',
    time: '16:00',
    text: 'С пилатеса уже вернулась домой',
  });
  expect(result.previous_statements.length).toBeLessThanOrEqual(18);
});
it('dates previous plans on their own local day across midnight and excludes future/user/old claims', () => {
  const result = dayContinuity(
    [
      msg('Сегодня на пилатес', '2026-09-24T16:45:00Z'),
      msg('Уже сходила', '2026-09-25T16:00:00Z'),
      msg('Я закончил тренировку', '2026-09-24T16:00:00Z', 'user'),
      msg('Давно закончила', '2026-09-20T16:00:00Z'),
    ],
    'Asia/Bangkok',
    ts('2026-09-24T17:15:00Z'),
  );
  expect(result.previous_statements).toEqual([
    { date: '2026-09-24', time: '23:45', text: 'Сегодня на пилатес' },
  ]);
});
it('sends chronology only in volatile context while plans stay unmodified', () => {
  const runtime = {
    date: '2026-09-24',
    day: { evening_plan: 'сегодня на пилатес' },
    storylines: [],
    day_continuity: {
      timezone: 'Asia/Bangkok',
      previous_statements: [
        { date: '2026-09-24', time: '16:00', text: 'Уже вернулась с пилатеса' },
      ],
      omitted_statements: 0,
    },
  } as any;
  const prompt = buildCharacterPrompt({
    config: { persona: {}, day: {}, goals: {}, storylines: {} },
    runtime,
    judgment: {},
    name: 'Настя',
    prompts: mergePrompts({}),
  });
  expect(prompt.volatile).toContain('Уже вернулась с пилатеса');
  expect(prompt.stable).not.toContain('Уже вернулась с пилатеса');
  expect(runtime.day).toEqual({ evening_plan: 'сегодня на пилатес' });
});
