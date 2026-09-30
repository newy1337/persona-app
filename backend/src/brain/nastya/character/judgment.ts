import type {
  CharacterConfig,
  ConversationState,
  Judgment,
  MemoryUpdate,
  RuntimeSnapshot,
  Slot,
} from '../kernel/types';
import { asText, extendUnique } from '../kernel/coerce';
import { characterDate } from '../kernel/clock';
import { recordMemoryUpdates } from '../memory/memories';
import { advanceStage, stageIndex } from './stage';
import { moveTone } from './tone';
import { buildRuntimeSnapshot } from './snapshot';

import { recordPersonaEvents } from '../memory/persona-events';

const SLOT_VALUE_LIMIT = 500;
/** С какого хода можно задавать анкетный вопрос, если у этапа не сказано иначе: первый ответ — просто разговор. */
const DEFAULT_FIRST_ASK_TURN = 2;

/**
 * Folds the judge's decision into the conversation and rebuilds the snapshot.
 *
 * The judgment is edited in place when it asks for something the state no
 * longer allows — an unaskable slot, or a second questionnaire question in a
 * row — so the author never receives a plan the rules forbid.
 */
export function applyJudgment(
  config: CharacterConfig,
  state: ConversationState,
  judgment: Judgment,
  userText = '',
  today: string = characterDate(new Date(), config.timeZone),
  random: () => number = Math.random,
  nowTs: number = Math.floor(Date.now() / 1000),
): RuntimeSnapshot {
  const character = (state.character ??= {});
  const allowed = new Set(
    ((config.goals['slots'] ?? []) as Slot[]).map((slot) => slot.id),
  );
  const slots = (character.slots ??= {});

  const updates: Array<Partial<MemoryUpdate>> = [
    ...(judgment.memory_updates ?? []),
  ];
  for (const [slotId, value] of Object.entries(judgment.slot_updates ?? {})) {
    if (!allowed.has(slotId) || typeof value !== 'string' || !value.trim())
      continue;
    const text = value.trim().slice(0, SLOT_VALUE_LIMIT);
    slots[slotId] = text;
    character.cleared_slots = (character.cleared_slots ?? []).filter(
      (id) => id !== slotId,
    );
    updates.push({
      action: 'remember',
      kind: 'fact',
      slot_id: slotId,
      text,
      importance: 4,
    });
  }
  recordMemoryUpdates(state, updates, today, userText);
  recordPersonaEvents(
    state,
    judgment.persona_event_updates ?? [],
    config.timeZone ?? 'UTC',
    nowTs,
  );

  const deferred = new Set(character.deferred_slots ?? []);
  for (const slotId of judgment.deferred_slots ?? [])
    if (allowed.has(slotId)) deferred.add(slotId);
  for (const slotId of judgment.resumed_slots ?? [])
    if (allowed.has(slotId)) deferred.delete(slotId);
  character.deferred_slots = [...deferred].sort();

  extendUnique(
    (state.agreements ??= []),
    judgment.agreements ?? [],
    SLOT_VALUE_LIMIT,
  );

  advanceStage(config.goals, character, today);
  moveTone(config.goals, character);

  const runtime = buildRuntimeSnapshot(config, state, today, userText, nowTs);

  if (runtime.conversation_context)
    runtime.conversation_context.answer_question_ids =
      judgment.answer_question_ids ?? [];
  const askable = new Set(runtime.available_slots.map((slot) => slot.id));
  const target = judgment.target_slot;
  if (
    judgment.goal === 'ask' &&
    (!target ||
      !askable.has(target) ||
      !pacingAllowsAsk(config, character, random))
  ) {
    judgment.goal = 'respond';
    judgment.target_slot = '';
    judgment.question_allowed = false;
    judgment.guidance = `${asText(judgment.guidance)} Не задавай новый анкетный вопрос. Останься в текущей теме.`;
  }

  if (runtime.onboarding.already_greeted && judgment.guidance) {
    judgment.guidance = `${asText(judgment.guidance)} ${runtime.onboarding.greeting_note}`;
  }

  state.judge = judgment;
  runtime.reply_rhythm = {
    kind: judgment.response_kind ?? 'normal',
    guidance: 'Длина по смыслу сообщения, без обязательной шутки или вопроса.',
  };
  return runtime;
}

/**
 * Темп анкеты — `pacing` этапа в документе «Цели» личности:
 *  · `first_ask_turn` — с какого хода можно спрашивать (по умолчанию со второго:
 *    на «Приветики» не отвечают «что ищешь тут»);
 *  · `min_turns_between_goals` — сколько ходов между анкетными вопросами;
 *  · `chance_to_skip` — доля ходов, где вопрос пропускается, чтобы разговор не шёл по списку.
 */
export function pacingAllowsAsk(
  config: CharacterConfig,
  character: NonNullable<ConversationState['character']>,
  random: () => number = Math.random,
): boolean {
  const stages = (config.goals['stages'] ?? []) as Array<Record<string, any>>;
  const pacing = (stages[stageIndex(stages as any, character.stage_id)]?.[
    'pacing'
  ] ?? {}) as Record<string, unknown>;
  const turns = Number(character.turns ?? 0);
  const firstAsk =
    pacing['first_ask_turn'] === undefined
      ? DEFAULT_FIRST_ASK_TURN
      : Number(pacing['first_ask_turn']) || 0;
  if (turns < firstAsk) return false;
  const between = Math.max(1, Number(pacing['min_turns_between_goals']) || 1);
  if (
    character.last_goal_turn !== undefined &&
    turns - Number(character.last_goal_turn) < between
  )
    return false;
  const skip = Number(pacing['chance_to_skip']) || 0;
  return !(skip > 0 && random() < skip);
}
