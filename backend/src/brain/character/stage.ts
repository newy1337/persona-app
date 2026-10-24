import type { CharacterState, Stage } from '../kernel/types';
import { asInt } from '../kernel/coerce';
import { shiftDate } from '../kernel/clock';

export function currentStreak(days: readonly string[], today: string): number {
  const known = new Set(days.map(String));
  let streak = 0;
  let cursor = today;
  while (known.has(cursor)) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

export function stageIndex(
  stages: readonly Stage[],
  stageId: string | undefined,
): number {
  const index = stages.findIndex((stage) => stage.id === stageId);
  return index < 0 ? 0 : index;
}

export function advanceStage(
  goals: Record<string, any>,
  character: CharacterState,
  today: string,
): void {
  const stages: Stage[] = goals['stages'] ?? [];
  const index = stageIndex(stages, character.stage_id);
  if (index >= stages.length - 1) return;
  if (goals['one_step_per_day'] && character.last_stage_change === today)
    return;

  const current = stages[index]!;
  const following = stages[index + 1]!;
  const enter = following.enter ?? {};
  const turns = asInt(character.turns);
  const turnsOnStage = turns - asInt(character.stage_started_turn);

  let requiredTurns = asInt(enter.turns);
  const streakBoost = goals['streak_boost'] ?? {};
  if (
    currentStreak(character.days ?? [], today) >= asInt(streakBoost['days'])
  ) {
    requiredTurns = Math.ceil(
      requiredTurns * Number(streakBoost['factor'] ?? 1),
    );
  }

  const ready =
    turns >= requiredTurns &&
    (character.days?.length ?? 0) >= asInt(enter.days) &&
    Object.keys(character.slots ?? {}).length >= asInt(enter.slots) &&
    turnsOnStage >= asInt(current.min_turns);

  if (!ready) return;
  character.stage_id = following.id;
  character.stage_started_turn = turns;
  character.last_stage_change = today;
}
