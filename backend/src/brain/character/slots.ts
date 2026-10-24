import type { CharacterState, GoalPlan, Slot, Stage } from '../kernel/types';
import { asInt } from '../kernel/coerce';
import { stripMetadata } from './config';
import { stageIndex } from './stage';

const MAX_ASKS_PER_SLOT = 2;

export function slotCanBeAsked(
  slot: Slot,
  knownSlots: Record<string, string>,
): boolean {
  const policy = String(slot.ask_policy ?? '');
  if (policy === 'derive_only' || policy === 'topic_only') return false;
  const required = slot.requires;
  const requiredIds =
    typeof required === 'string' ? [required] : (required ?? []);
  return requiredIds.every((slotId) => String(slotId) in knownSlots);
}

export function openSlotIds(
  goals: Record<string, any>,
  character: CharacterState,
  dayNumber: number,
  query: string,
): string[] {
  const stages: Stage[] = goals['stages'] ?? [];
  const index = stageIndex(stages, character.stage_id);
  const ids: string[] = [];
  for (const stage of stages.slice(0, index + 1))
    ids.push(...(stage.ask_slots ?? []));

  const lowered = query.toLowerCase();
  for (const slot of (goals['slots'] ?? []) as Slot[]) {
    const notBeforeDay = Math.max(1, asInt(slot.not_before_day) || 1);
    if (dayNumber < notBeforeDay) continue;
    if (slot.required_by_day || slot.desired_by_day) {
      ids.push(slot.id);
    } else if (String(slot.ask_policy ?? '') === 'topic_only') {
      const triggers = (slot.topic_triggers ?? []).map((item) =>
        String(item).toLowerCase(),
      );
      if (triggers.some((trigger) => lowered.includes(trigger)))
        ids.push(slot.id);
    }
  }
  return ids;
}

export function availableSlots(
  goals: Record<string, any>,
  character: CharacterState,
  dayNumber: number,
  query: string,
): Slot[] {
  const open = new Set(openSlotIds(goals, character, dayNumber, query));
  const known = character.slots ?? {};
  const deferred = new Set(character.deferred_slots ?? []);
  const asks = character.slot_asks ?? {};
  return ((goals['slots'] ?? []) as Slot[])
    .filter(
      (slot) =>
        open.has(slot.id) &&
        !(slot.id in known) &&
        !deferred.has(slot.id) &&
        asInt(asks[slot.id]) < MAX_ASKS_PER_SLOT &&
        slotCanBeAsked(slot, known),
    )
    .map((slot) => stripMetadata(slot));
}

export function acquaintanceGoalPlan(
  character: CharacterState,
  available: Slot[],
  oneQuestionOnly = true,
): GoalPlan {
  const dayNumber = Math.max(1, character.days?.length ?? 0);
  const required: Array<[number, Slot]> = [];
  const desired: Array<[number, Slot]> = [];
  for (const slot of available) {
    const priority = asInt(slot.priority) || 999;
    if (
      asInt(slot.required_by_day) &&
      dayNumber >= asInt(slot.required_by_day)
    ) {
      required.push([priority, slot]);
    } else if (
      slot.suggest_when_unknown === true ||
      (asInt(slot.desired_by_day) && dayNumber >= asInt(slot.desired_by_day))
    ) {
      desired.push([priority, slot]);
    }
  }
  const byPriority = (left: [number, Slot], right: [number, Slot]) =>
    left[0] - right[0];
  required.sort(byPriority);
  desired.sort(byPriority);
  const ordered = [...required, ...desired].map(([, slot]) => slot);
  return {
    day_number: dayNumber,
    priority_slot: ordered[0] ?? {},
    suggested_topics: ordered.map((slot) => slot.id),
    optional: true,
    desired_missing: desired.map(([, slot]) => slot.id),
    one_question_per_reply: oneQuestionOnly,
    react_before_asking: true,
  };
}
