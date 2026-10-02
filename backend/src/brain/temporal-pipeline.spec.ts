import { ChatActivity } from './chat-activity';
import { NastyaBrainService } from './nastya-brain.service';
import { judgeDialogue } from './nastya/judge/plan';
import { generateDraft } from './nastya/llm/generate';
import { reviewReply } from './nastya/judge/review';
import { cityPlace } from './nastya/kernel/location';
import { DEFAULT_RHYTHM } from './nastya/config/rhythm';
import { mergePrompts } from './nastya/config/prompts';
jest.mock('./nastya/judge/plan', () => ({ judgeDialogue: jest.fn() }));
jest.mock('./nastya/llm/generate', () => ({ generateDraft: jest.fn() }));
jest.mock('./nastya/judge/review', () => ({ reviewReply: jest.fn() }));

function setup(zone = 'Asia/Bangkok') {
  const now = new Date('2026-09-24T16:55:00Z'),
    ts = now.getTime() / 1000;
  const state: any = {
    history: [],
    character: { slots: { location: 'Madrid' } },
    memories: [],
    agreements: [],
    initiative: {},
  };
  const persona: any = {
    slug: 'test',
    name: 'Тест',
    variables: {},
    prompts: mergePrompts({}),
    rhythm: {
      ...DEFAULT_RHYTHM,
      timezone: zone,
      goodnight: { enabled: true, from: '23:00', to: '00:00' },
    },
    config: {
      timeZone: zone,
      persona: {},
      day: {},
      storylines: {},
      goals: {
        stages: [{ id: 'knock', ask_slots: ['location'] }],
        slots: [{ id: 'location' }],
      },
    },
  };
  const brain: any = Object.create(NastyaBrainService.prototype);
  Object.assign(brain, {
    activity: new ChatActivity(),
    clock: { now: () => now, ts: () => ts },
    persona: {
      forChat: async () => persona,
      forAccount: async () => persona,
      interlocutorLocation: jest.fn(async (city) =>
        cityPlace(city, city === 'Madrid' ? 'ES' : 'JP'),
      ),
      personaPlace: jest.fn(async (loaded: any) => ({
        status: 'resolved',
        city: '',
        country: '',
        timezone: loaded.rhythm.timezone,
      })),
    },
    state: {
      reconcile: async () => state,
      load: async () => state,
      save: jest.fn(),
    },
    settings: { get: async () => ({ custom_prompt: '' }) },
    history: {
      isBlockedByClient: async () => false,
      hasPendingManualReply: async () => false,
      rhythmMarks: async () => ({
        prevUserTs: ts - 1800,
        lastAssistantTs: ts - 1700,
      }),
      chatOwnerAccount: async () => 1,
      getLeadFacts: async () => ({}),
    },
    pause: { status: async () => ({ status: 'active' }) },
    schedule: { get: async () => null },
    gate: { stopped: false },
    log: { log: jest.fn() },
    llmDeps: () => ({}),
    judgeDeps: () => ({}),
    mirrorLeadFacts: jest.fn(),
    deliverParts: jest.fn(),
    funnel: { emit: jest.fn() },
    canReach: async () => true,
  });
  return { brain, state, persona, ts };
}
beforeEach(() => jest.clearAllMocks());
it('uses persona timezone for the day and resolves a newly reported city before author and reviewer', async () => {
  const { brain, state } = setup('Europe/Madrid');
  const clocks: any[] = [];
  (judgeDialogue as jest.Mock).mockImplementation(async (input) => {
    clocks.push(input.runtime.time_context);
    return { goal: 'respond', slot_updates: { location: 'Tokyo' } };
  });
  (generateDraft as jest.Mock).mockImplementation(async (input) => {
    expect(input.system.volatile).toContain('Asia/Tokyo');
    expect(input.system.volatile).toContain('01:55');
    return 'У меня сейчас вечер';
  });
  (reviewReply as jest.Mock).mockImplementation(async (input) => {
    expect(input.runtime.date).toBe('2026-09-24');
    expect(input.runtime.time_context.persona.time).toBe('18:55');
    expect(input.runtime.time_context.interlocutor.date).toBe('2026-09-25');
    expect(input.runtime.time_context.interlocutor.time).toBe('01:55');
    return { approved: true, issues: [], final_text: input.draft };
  });
  const prepared = await brain.generateReply(1, 'Я уже в Токио', '');
  expect(clocks[0].persona.timezone).toBe('Europe/Madrid');
  expect(clocks[0].interlocutor.timezone).toBe('Europe/Madrid');
  expect(prepared.state.character.slots.location).toBe('Tokyo');
  expect(state.character.slots.location).toBe('Madrid');
  expect(brain.state.save).not.toHaveBeenCalled();
});
it('does not invoke a model for a night window without a conversational reason', async () => {
  const { brain, state, ts } = setup();
  state.history = [
    { role: 'user', content: 'Расскажи про отпуск', created_at: ts - 1800 },
    {
      role: 'assistant',
      content: 'Мне понравилось море',
      created_at: ts - 1700,
    },
  ];
  expect(await brain.ritual(1, {})).toBe(false);
  expect(generateDraft).not.toHaveBeenCalled();
});
it('persists a skipped goodnight without sending it or recording a farewell timestamp', async () => {
  const { brain, state, persona, ts } = setup();
  state.history = [
    { role: 'user', content: 'Я уже засыпаю', created_at: ts - 1800 },
  ];
  (generateDraft as jest.Mock).mockResolvedValue('Спокойной ночи');
  (reviewReply as jest.Mock).mockResolvedValue({
    approved: false,
    should_send: false,
    issues: ['Неуместно'],
    final_text: '',
  });
  const record = jest.fn();
  expect(
    await brain.sendUnprompted(
      1,
      1,
      persona,
      {},
      {},
      { author: 'goodnight', stillDue: () => true, record },
    ),
  ).toBe(false);
  expect(brain.deliverParts).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
  expect(state.rhythm.goodnight['2026-09-24']).toBe('skipped');
  expect(state.rhythm.last_goodnight_ts).toBeUndefined();
  expect(state.history).toHaveLength(1);
});
it('rechecks new inbound activity after generation before sending goodnight', async () => {
  const { brain, state, persona, ts } = setup();
  state.history = [
    { role: 'user', content: 'Я уже засыпаю', created_at: ts - 1800 },
  ];
  (generateDraft as jest.Mock).mockResolvedValue('Спокойной ночи');
  (reviewReply as jest.Mock).mockResolvedValue({
    approved: true,
    should_send: true,
    issues: [],
    final_text: 'Спокойной ночи',
  });
  brain.history.rhythmMarks = async () => ({
    prevUserTs: ts + 1,
    lastAssistantTs: ts - 1700,
  });
  expect(
    await brain.sendUnprompted(
      1,
      1,
      persona,
      {},
      {},
      { author: 'goodnight', stillDue: () => true, record: jest.fn() },
    ),
  ).toBe(false);
  expect(brain.deliverParts).not.toHaveBeenCalled();
});
it('enabled conversation policy blocks initiative over an unanswered incoming message even without a queue', async () => {
  const { brain, state, persona, ts } = setup();
  persona.config.goals.conversation_policy = { enabled: true };
  state.history = [
    {
      role: 'user',
      content: 'Ты ответишь на мой вопрос?',
      created_at: ts - 3600,
    },
  ];
  brain.automationBlock = async () => null;
  expect(await brain.proactive(1, {})).toBe(false);
  expect(generateDraft).not.toHaveBeenCalled();
});
it('a remembered unanswered question prevents an unrelated initiative after a partial response', async () => {
  const { brain, state, persona, ts } = setup();
  persona.config.goals.conversation_policy = { enabled: true };
  state.history = [
    { role: 'user', content: 'Почему не ответил?', created_at: ts - 3600 },
    { role: 'assistant', content: 'Как работа?', created_at: ts - 3500 },
  ];
  state.character.open_questions = [{ id: 'old', text: 'Почему не ответил?' }];
  brain.automationBlock = async () => null;
  expect(await brain.proactive(1, {})).toBe(false);
  expect(generateDraft).not.toHaveBeenCalled();
});
it('Denis may skip an unnecessary initiative without sending a replacement', async () => {
  const { brain, state, persona, ts } = setup();
  persona.config.goals.conversation_policy = { enabled: true };
  state.history = [
    { role: 'user', content: 'Я буду без связи', created_at: ts - 3600 },
    { role: 'assistant', content: 'Хорошего отдыха', created_at: ts - 3500 },
  ];
  (generateDraft as jest.Mock).mockResolvedValue('Как отдых?');
  (reviewReply as jest.Mock).mockResolvedValue({
    approved: false,
    should_send: false,
    issues: ['Без связи'],
    final_text: '',
  });
  expect(
    await brain.sendUnprompted(
      1,
      1,
      persona,
      {},
      {},
      { author: 'initiative', stillDue: () => true, record: jest.fn() },
    ),
  ).toBe(false);
  expect(brain.deliverParts).not.toHaveBeenCalled();
});
it('Denis also blocks a scheduled goodnight over an unanswered question', async () => {
  const { brain, state, persona, ts } = setup();
  persona.config.goals.conversation_policy = { enabled: true };
  state.history = [
    { role: 'user', content: 'Почему не ответил?', created_at: ts - 1800 },
  ];
  expect(await brain.ritual(1, {})).toBe(false);
  expect(generateDraft).not.toHaveBeenCalled();
});
it('uses the new question review when a partially delivered response is rewritten', async () => {
  const { brain, state, persona, ts } = setup();
  persona.config.goals.conversation_policy = { enabled: true };
  state.history = [
    { role: 'user', content: 'Что для тебя поддержка?', created_at: ts - 600 },
    { role: 'assistant', content: 'Сейчас отвечу', created_at: ts - 500 },
  ];
  state.character.open_questions = [
    { id: 'old', text: 'Что для тебя поддержка?' },
  ];
  brain.schedule.prepare = jest.fn(async () => true);
  brain.schedule.restore = jest.fn();
  let id: string;
  (reviewReply as jest.Mock).mockImplementation(async ({ runtime }) => {
    id = runtime.conversation_context.questions[0].id;
    return {
      approved: true,
      issues: [],
      final_text: 'Пока не могу сформулировать',
      unanswered_question_ids: [id],
    };
  });
  const draft = {
    judgment: { question_review: { questions: [], unanswered_ids: [] } },
    sentCount: 1,
    parts: [
      { text: 'Сейчас отвечу', randomId: '1' },
      { text: 'Старый ответ', randomId: '2' },
    ],
  };
  await brain.refreshContinuation(
    { chatId: 1, accountId: 1, turns: [{ text: 'Что для тебя поддержка?' }] },
    draft,
    new AbortController().signal,
  );
  const refreshed = brain.schedule.prepare.mock.calls[0][1];
  expect(refreshed.sentCount).toBe(1);
  expect(refreshed.judgment.question_review.unanswered_ids).toEqual([id!]);
  brain.bookkeep(
    refreshed.state,
    refreshed.judgment,
    '2026-09-24',
    refreshed.reply,
    '2026-09-24',
  );
  expect(refreshed.state.character.open_questions).toEqual([
    { id: id!, text: 'Что для тебя поддержка?' },
  ]);
  expect(draft.judgment.question_review.unanswered_ids).toEqual([]);
});
