import type { CharacterState, Slot, Stage } from '../kernel/types';
import { asInt } from '../kernel/coerce';
import {
  acquaintanceGoalPlan,
  availableSlots,
  openSlotIds,
  slotCanBeAsked,
} from './slots';
import { stageIndex } from './stage';
import { oneQuestionPerReply } from '../config/question-policy';

export type GoalSlotState = 'known' | 'open' | 'asked' | 'deferred' | 'locked';

export interface GoalSlotView {
  id: string;
  title: string;
  state: GoalSlotState;
  value: string | null;
  asks: number;
  priority: number | null;
  required_by_day: number | null;
}

export interface GoalsView {
  stage: {
    id: string;
    title: string;
    index: number;
    total: number;
    turns: number;
    days: number;
  };
  known: number;
  total: number;
  next: { id: string; title: string } | null;
  slots: GoalSlotView[];
}

const MAX_ASKS_PER_SLOT = 2;

function titleOf(slot: Slot): string {
  const hint = String((slot as any).hint ?? '').trim();
  if (hint) return hint;
  const topic = String((slot as any).topic ?? '').trim();
  if (topic) return topic.split(/[;.]/)[0]!.trim();
  return slot.id;
}

function planned(slots: Slot[], known: Record<string, string>): Slot[] {
  return slots.filter(
    (slot) =>
      asInt(slot.required_by_day) ||
      asInt(slot.desired_by_day) ||
      slot.id in known,
  );
}

export function goalProgress(
  goals: Record<string, any>,
  character: CharacterState | undefined,
): GoalsView {
  const state = character ?? {};
  const stages: Stage[] = goals['stages'] ?? [];
  const index = stageIndex(stages, state.stage_id);
  const stage = stages[index];
  const dayNumber = Math.max(1, state.days?.length ?? 0);

  const known = state.slots ?? {};
  const asks = state.slot_asks ?? {};
  const deferred = new Set(state.deferred_slots ?? []);
  const open = new Set(openSlotIds(goals, state, dayNumber, ''));
  const catalog = (goals['slots'] ?? []) as Slot[];
  const available = availableSlots(goals, state, dayNumber, '');
  const askable = new Set(available.map((slot) => slot.id));

  const rows: GoalSlotView[] = planned(catalog, known).map((slot) => {
    const count = asInt(asks[slot.id]);
    let slotState: GoalSlotState;
    if (slot.id in known) slotState = 'known';
    else if (deferred.has(slot.id)) slotState = 'deferred';
    else if (askable.has(slot.id)) slotState = count > 0 ? 'asked' : 'open';
    else if (
      !open.has(slot.id) ||
      count >= MAX_ASKS_PER_SLOT ||
      !slotCanBeAsked(slot, known)
    ) {
      slotState = 'locked';
    } else slotState = 'open';
    return {
      id: slot.id,
      title: titleOf(slot),
      state: slotState,
      value: slot.id in known ? String(known[slot.id]) : null,
      asks: count,
      priority: asInt(slot.priority) || null,
      required_by_day: asInt(slot.required_by_day) || null,
    };
  });

  const rank = (row: GoalSlotView) =>
    row.state === 'known'
      ? 2
      : row.state === 'locked' || row.state === 'deferred'
        ? 1
        : 0;
  rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.priority ?? 999) - (b.priority ?? 999) ||
      a.id.localeCompare(b.id),
  );

  const nextId = acquaintanceGoalPlan(
    state,
    available,
    oneQuestionPerReply(goals),
  ).suggested_topics[0];
  const nextSlot = available.find((slot) => slot.id === nextId) ?? available[0];
  return {
    stage: {
      id: String(state.stage_id ?? stage?.id ?? ''),
      title: String(stage?.title ?? stage?.id ?? ''),
      index: index + 1,
      total: stages.length,
      turns: asInt(state.turns),
      days: state.days?.length ?? 0,
    },
    known: rows.filter((row) => row.state === 'known').length,
    total: rows.length,
    next: nextSlot ? { id: nextSlot.id, title: titleOf(nextSlot) } : null,
    slots: rows,
  };
}
