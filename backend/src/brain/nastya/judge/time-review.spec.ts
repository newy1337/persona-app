import { reviewReply } from './review';
import { judgeResponseText } from './transport';
import { cityPlace } from '../kernel/location';
import { turnTime } from '../kernel/turn-time';
import { buildCharacterPrompt } from '../character/prompt';
import { mergePrompts } from '../config/prompts';

jest.mock('./transport', () => ({
  ...jest.requireActual('./transport'),
  judgeResponseText: jest.fn(),
}));
const respond = judgeResponseText as jest.Mock;
const time_context = turnTime(
  cityPlace('Madrid', 'ES'),
  cityPlace('Калининград', 'RU'),
  new Date('2026-09-21T16:22:42Z'),
);
const runtime = { date: '2026-09-21', time_context, storylines: [] } as any;
const bad =
  'у меня как раз только обед начинается, разница во времени немаленькая)';
const input = {
  prompt: 'Проверь ответ',
  persona: {},
  runtime,
  judgment: {},
  history: [],
  userText: 'Уже вечер',
  draft: bad,
};

beforeEach(() => respond.mockReset());
it('gives author and reviewer identical current clocks outside the prompt cache', async () => {
  const prompt = buildCharacterPrompt({
    config: { persona: {}, day: {}, goals: {}, storylines: {} },
    runtime,
    judgment: {},
    name: 'Денис',
    prompts: mergePrompts({}),
  });
  expect(prompt.volatile).toContain('18:22');
  expect(prompt.volatile).toContain('Europe/Madrid');
  expect(prompt.stable).not.toContain('18:22');
  respond.mockResolvedValue(
    JSON.stringify({
      approved: false,
      issues: ['Вечер, одинаковое время'],
      final_text: 'У меня тоже вечер, у нас одинаковое время)',
    }),
  );
  expect((await reviewReply(input, {} as any)).final_text).toContain(
    'тоже вечер',
  );
  const payload = respond.mock.calls[0][2];
  expect(payload.dialogue_state.time_context).toEqual(time_context);
  expect(payload.time_violations).toHaveLength(2);
});
it('does not send a wrong time even when the reviewer approves it twice', async () => {
  respond.mockResolvedValue(JSON.stringify({ approved: true, issues: [] }));
  await expect(reviewReply(input, {} as any)).rejects.toThrow(
    'verified local time',
  );
  expect(respond).toHaveBeenCalledTimes(2);
});
it('accepts a corrected second review without an unbounded loop', async () => {
  respond
    .mockResolvedValueOnce(JSON.stringify({ approved: true, issues: [] }))
    .mockResolvedValueOnce(
      JSON.stringify({
        approved: false,
        issues: ['Время'],
        final_text: 'У меня сейчас вечер',
      }),
    );
  expect((await reviewReply(input, {} as any)).final_text).toBe(
    'У меня сейчас вечер',
  );
});
it('lets the reviewer suppress an optional goodnight without manufacturing a replacement', async () => {
  respond.mockResolvedValue(
    JSON.stringify({
      approved: false,
      should_send: false,
      issues: ['Разговор продолжается'],
      final_text: '',
    }),
  );
  const result = await reviewReply(
    {
      ...input,
      draft: 'Ладно, пора спать, спокойной ночи',
      runtime: {
        ...runtime,
        delivery_context: { kind: 'goodnight', reason: 'Я уже засыпаю' },
        day_continuity: { previous_statements: [] },
      },
    },
    {} as any,
  );
  expect(result.should_send).toBe(false);
  expect(result.final_text).toBe('');
  expect(respond.mock.calls[0][2].dialogue_state.delivery_context.kind).toBe(
    'goodnight',
  );
});
it('fails closed for optional goodnight when the reviewer omits the send decision', async () => {
  respond.mockResolvedValue(JSON.stringify({ approved: true, issues: [] }));
  const result = await reviewReply(
    {
      ...input,
      draft: 'Спокойной ночи',
      runtime: {
        ...runtime,
        delivery_context: { kind: 'goodnight', reason: 'Я уже засыпаю' },
      },
    },
    {} as any,
  );
  expect(result.should_send).toBe(false);
});
it('gives the reviewer dated earlier actions even if they are outside recent_history', async () => {
  respond.mockResolvedValue(
    JSON.stringify({
      approved: false,
      issues: ['Пилатес уже закончился'],
      final_text: 'Сегодня уже сходила, сейчас дома',
    }),
  );
  const day_continuity = {
    timezone: 'Asia/Bangkok',
    previous_statements: [
      { date: '2026-09-24', time: '16:00', text: 'С пилатеса вернулась' },
    ],
    omitted_statements: 0,
  };
  const result = await reviewReply(
    {
      ...input,
      draft: 'Сейчас собираюсь на пилатес',
      runtime: { ...runtime, day_continuity },
    },
    {} as any,
  );
  expect(result.approved).toBe(false);
  expect(respond.mock.calls[0][2].dialogue_state.day_continuity).toEqual(
    day_continuity,
  );
});
it('reviews only the remaining bubbles with delivered parts as evidence and may omit a redundant continuation', async () => {
  respond.mockResolvedValue(
    JSON.stringify({
      approved: false,
      should_send: false,
      issues: ['Уже сказано в первой части'],
      final_text: '',
    }),
  );
  const result = await reviewReply(
    {
      ...input,
      draft: 'Погуляла у моря',
      runtime: {
        ...runtime,
        delivery_context: {
          kind: 'continuation',
          reason: 'Наступил новый день',
          sent_parts: ['Вчера гуляла у моря'],
        },
      },
    },
    {} as any,
  );
  expect(result).toMatchObject({ should_send: false, final_text: '' });
  expect(
    respond.mock.calls[0][2].dialogue_state.delivery_context.sent_parts,
  ).toEqual(['Вчера гуляла у моря']);
});
