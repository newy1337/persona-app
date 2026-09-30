import { JUDGE_MODELS } from './models';
import { oneQuestionPerReply, QUESTION_POLICY_RULE } from './question-policy';
import { prepareTurn } from '../character/turn';
import { buildCharacterPrompt } from '../character/prompt';
import { judgeDialogue } from '../judge/plan';
import { reviewReply } from '../judge/review';
import { mergePrompts } from './prompts';
import type { CharacterConfig, ConversationState } from '../kernel/types';

describe('переключатель одного вопроса на ответ', () => {
  it.each([undefined, null, 'false', 0, true])(
    'старые или некорректные значения %p сохраняют ограничение',
    (value) => {
      expect(
        oneQuestionPerReply({
          acquaintance_plan: { one_question_per_reply: value },
        }),
      ).toBe(true);
      expect(oneQuestionPerReply({})).toBe(true);
    },
  );

  it.each(
    [true, false].flatMap((enabled) =>
      JUDGE_MODELS.map((model) => ({ enabled, model })),
    ),
  )(
    'правило $enabled сохраняется при выбранной модели $model',
    async ({ enabled, model }) => {
      const now = Math.floor(Date.now() / 1000);
      const config: CharacterConfig = {
        persona: { name: 'Денис', gender: 'male' },
        day: {},
        storylines: {},
        goals: {
          stages: [{ id: 'knock', ask_slots: ['name'] }],
          slots: [{ id: 'name', required_by_day: 1 }],
          acquaintance_plan: { one_question_per_reply: enabled },
        },
      };
      const state = {
        character: {},
        memories: [],
        agreements: [],
        history: [
          { role: 'assistant', content: 'привет', created_at: now - 60 },
        ],
      } as unknown as ConversationState;
      const runtime = prepareTurn(config, state, 'привет', '2026-09-22');
      expect(runtime.goal_plan.one_question_per_reply).toBe(enabled);
      expect(runtime.onboarding.greeting_note).toContain('не здоровайся снова');
      expect(runtime.onboarding.greeting_note.includes('ровно одним')).toBe(
        enabled,
      );
      expect(
        runtime.onboarding.greeting_note.includes('не два вопроса подряд'),
      ).toBe(enabled);

      const author = buildCharacterPrompt({
        config,
        runtime,
        judgment: {},
        name: 'Денис',
        prompts: mergePrompts({}),
      });
      expect(author.stable).toContain(QUESTION_POLICY_RULE);
      const context = JSON.parse(
        author.volatile!.split('КОНТЕКСТ:\n')[1].split('\n\nРЕШЕНИЕ')[0],
      );
      expect(context.goal_plan.one_question_per_reply).toBe(enabled);

      const calls: any[] = [];
      const replies = [
        JSON.stringify({ goal: 'respond' }),
        JSON.stringify({ approved: true, issues: [] }),
      ];
      const deps = {
        model,
        client: {
          messages: {
            create: async (body: any) => {
              calls.push(body);
              return {
                content: [{ type: 'text', text: replies.shift() }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 1, output_tokens: 1 },
              };
            },
          },
        } as any,
        usageDb: { record: async () => undefined } as any,
        logger: { info() {}, warn() {}, error() {} },
      };
      await judgeDialogue(
        { prompt: 'План', runtime, history: [], userText: 'привет' },
        deps,
      );
      await reviewReply(
        {
          prompt: 'Проверка',
          runtime,
          persona: config.persona,
          judgment: {},
          history: [],
          userText: 'привет',
          draft: 'ответ',
        },
        deps,
      );
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(call.model).toBe(model);
        expect(call.system[0].text).toContain(QUESTION_POLICY_RULE);
        const payload = JSON.parse(call.messages[0].content);
        expect(payload.dialogue_state.goal_plan.one_question_per_reply).toBe(
          enabled,
        );
      }
    },
  );
});
