import { CALL_CONTEXT_RULE } from 'src/shared/call-context';
import type {
  CharacterConfig,
  Judgment,
  RuntimeSnapshot,
} from '../kernel/types';
import { jsonText } from '../kernel/coerce';
import type { SplitPrompt } from '../llm/anthropic';
import { withName, type PersonaPrompts } from '../config/prompts';
import { conversationPersona } from './persona';
import { QUESTION_POLICY_RULE } from '../config/question-policy';

import { TIME_RULES } from '../kernel/turn-time';
import { conversational } from './conversation';
import { CONTINUITY_RULES } from './continuity';

const CONTEXT_KEYS = [
  'call_context',
  'voice_availability',
  'conversation_context',
  'date',
  'day',
  'time_context',
  'day_continuity',
  'persona_events',
  'persona_statements',
  'delivery_context',
  'relationship',
  'onboarding',
  'known_interlocutor',
  'memories',
  'agreements',
  'deferred_slots',
  'reply_rhythm',
  'disclosure',
] as const;

const PLAN_KEYS = [
  'voice_reply',
  'intent',
  'goal',
  'target_slot',
  'question_allowed',
  'guidance',
  'callback_memory_id',
  'response_kind',
  'storyline_id',
] as const;

export interface CharacterPromptInput {
  config: CharacterConfig;
  runtime: RuntimeSnapshot;
  judgment: Partial<Judgment>;
  name: string;
  prompts: PersonaPrompts;
  customInstructions?: string;
}

export function buildCharacterPrompt(input: CharacterPromptInput): SplitPrompt {
  const {
    config,
    runtime,
    judgment,
    name,
    prompts,
    customInstructions = '',
  } = input;
  const context: Record<string, unknown> = {};
  for (const key of CONTEXT_KEYS) context[key] = runtime[key];
  context['goal_plan'] = conversational(config)
    ? runtime.goal_plan
    : {
        one_question_per_reply:
          runtime.goal_plan?.one_question_per_reply ?? true,
      };
  context['selected_story'] =
    runtime.storylines.find((item) => item.id === judgment.storyline_id) ??
    null;

  const plan: Record<string, unknown> = {};
  for (const key of PLAN_KEYS) plan[key] = judgment[key];

  const persona = conversationPersona(config.persona, name);
  if (!conversational(config)) delete persona['human_behavior'];
  delete persona['story_usage_rules'];

  const toneExamples =
    config.persona['chat_examples'] ??
    config.persona['dialogue_examples'] ??
    [];

  const stable = [
    withName(prompts.intro, name),
    `ПЕРСОНА:\n${jsonText(persona)}`,
    `ПРИМЕРЫ ТОНА (не факты вашей истории, не заготовки для копирования):\n${jsonText(toneExamples)}`,
    withName(prompts.author_rules, name),
    QUESTION_POLICY_RULE,
    TIME_RULES,
    CALL_CONTEXT_RULE,
    CONTINUITY_RULES,
    'ФОРМАТ ОТВЕТА: если delivery_context.kind=voice, напиши только естественный текст для одного голосового (до 800 знаков, обычно 1–4 предложения). Без эмодзи, ремарок в скобках, меток говорящего, перечней и технических деталей. Это уже содержание голосового, не обещание записать его потом. Запись может занять несколько минут: избегай мгновенных действий и точного времени без необходимости. Если выбран текст, не обещай отправить аудио: отвечай по теме, а на просьбу о голосе можешь естественно предпочесть текст согласно характеру. Решение судьи и устройство очереди собеседнику не пересказывай.',
  ].join('\n\n');

  const volatile = [
    `КОНТЕКСТ:\n${jsonText(context)}`,
    `РЕШЕНИЕ СКРЫТОГО СУДЬИ (подсказка, не сценарий):\n${jsonText(plan)}`,
  ];
  if (customInstructions.trim()) {
    volatile.push(
      `НАСТРОЙКИ СОБЕСЕДНИКА (актуальные исправления выше приоритетнее):\n${customInstructions.trim()}`,
    );
  }
  return { stable, volatile: volatile.join('\n\n') };
}
