import { reviewReply } from './review';
import { judgeDialogue } from './plan';
import { completeText } from '../llm/anthropic';
jest.mock('../llm/anthropic', () => ({ completeText: jest.fn() }));

const runtime = (): any => ({
  persona: { human_behavior: ['Own opinion'] },
  slot_catalog: [],
  available_slots: [],
  memories: [],
  storylines: [],
  callback_candidates: [],
  conversation_context: {
    questions: [{ id: 'q:1', text: 'А дети есть?', latest: true }],
    answer_question_ids: ['q:1'],
    open_question_ids: [],
    preferences: [],
  },
});
beforeEach(() => jest.clearAllMocks());
it('review retains the character rules and validates unresolved question references', async () => {
  (completeText as jest.Mock).mockResolvedValue(
    JSON.stringify({
      approved: true,
      issues: [],
      unanswered_question_ids: ['q:1', 'fake'],
    }),
  );
  const r = await reviewReply(
    {
      prompt: 'Review',
      persona: {},
      runtime: runtime(),
      judgment: {},
      history: [],
      userText: 'А дети есть?',
      draft: 'Как работа?',
    },
    {} as any,
  );
  expect(r.unanswered_question_ids).toEqual(['q:1']);
  expect((completeText as jest.Mock).mock.calls[0][1].system.stable).toContain(
    'Own opinion',
  );
  expect((completeText as jest.Mock).mock.calls[0][1].system.stable).toContain(
    'unanswered_question_ids',
  );
});
it('an unsolicited message can be cancelled without inventing a replacement', async () => {
  (completeText as jest.Mock).mockResolvedValue(
    JSON.stringify({
      approved: false,
      should_send: false,
      issues: ['Человек просил тишины'],
    }),
  );
  const r = await reviewReply(
    {
      prompt: 'Review',
      persona: {},
      runtime: { ...runtime(), delivery_context: { kind: 'initiative' } },
      judgment: {},
      history: [],
      userText: '',
      draft: 'Как дела?',
    },
    {} as any,
  );
  expect(r.should_send).toBe(false);
  expect(r.final_text).toBe('');
});
it('planner can focus on a prior question but cannot manufacture ids', async () => {
  (completeText as jest.Mock).mockResolvedValue(
    JSON.stringify({ goal: 'respond', answer_question_ids: ['q:1', 'fake'] }),
  );
  const r = await judgeDialogue(
    {
      prompt: 'Plan',
      runtime: runtime(),
      history: [],
      userText: 'Ты не ответил',
    },
    {} as any,
  );
  expect(r.answer_question_ids).toEqual(['q:1']);
});
it('allows an old pinned communication preference to be updated even outside the relevance-selected memories', async () => {
  const r = runtime();
  r.conversation_context.preferences = [
    { id: 'old-feedback', text: 'Не задавать личных вопросов' },
  ];
  (completeText as jest.Mock).mockResolvedValue(
    JSON.stringify({
      goal: 'respond',
      memory_updates: [
        {
          action: 'resolve',
          kind: 'preference',
          scope: 'communication',
          memory_id: 'old-feedback',
          text: 'Теперь готова говорить об этом',
        },
        {
          action: 'resolve',
          kind: 'preference',
          memory_id: 'invented',
          text: 'Нет',
        },
      ],
    }),
  );
  const result = await judgeDialogue(
    {
      prompt: 'Plan',
      runtime: r,
      history: [],
      userText: 'Теперь можно спрашивать о личном',
    },
    {} as any,
  );
  expect(result.memory_updates).toHaveLength(1);
  expect(result.memory_updates[0]).toMatchObject({
    action: 'resolve',
    memory_id: 'old-feedback',
  });
});
