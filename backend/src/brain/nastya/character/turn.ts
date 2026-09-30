import type {
  CharacterConfig,
  ConversationState,
  RuntimeSnapshot,
  Stage,
} from '../kernel/types';
import { asInt } from '../kernel/coerce';
import { characterDate, daysBetween, parseDate } from '../kernel/clock';
import { applyGap, spendCoolTurn } from './gap';
import { buildRuntimeSnapshot } from './snapshot';

/**
 * Opens a turn: counts it, records the day, settles the stage and accounts for
 * any silence since the last visit. Returns the snapshot the judge reads.
 */
export function prepareTurn(
  config: CharacterConfig,
  state: ConversationState,
  userText = '',
  today: string = characterDate(new Date(), config.timeZone),
  nowTs: number = Math.floor(Date.now() / 1000),
): RuntimeSnapshot {
  const character = (state.character ??= {});

  const historyTurns = (state.history ?? []).filter(
    (message) => message.role === 'user',
  ).length;
  character.turns = Math.max(asInt(character.turns), historyTurns) + 1;

  const days = (character.days ?? []).map(String);
  if (!days.includes(today)) days.push(today);
  character.days = days;
  character.first_seen ??= today;
  character.storyline_started ??= today;

  const stages: Stage[] = config.goals['stages'] ?? [];
  if (stages.length === 0)
    throw new Error('character/goals.json has no stages');
  if (!stages.some((stage) => stage.id === character.stage_id)) {
    character.stage_id = stages[0]!.id;
    character.stage_started_turn = 0;
  }

  const previousSeen = parseDate(character.last_seen_date);
  if (previousSeen && previousSeen < today) {
    applyGap(config.goals, character, daysBetween(previousSeen, today));
  } else {
    spendCoolTurn(character);
  }
  character.last_seen_date = today;

  return buildRuntimeSnapshot(config, state, today, userText, nowTs);
}
