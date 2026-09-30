import type { CharacterState } from '../kernel/types';
import { asInt, asText } from '../kernel/coerce';

export function applyGap(
  goals: Record<string, any>,
  character: CharacterState,
  gapDays: number,
): void {
  const gap = goals['gap'] ?? {};
  let selected: Record<string, any> | undefined;
  for (const level of gap['levels'] ?? []) {
    if (gapDays >= asInt(level?.days)) selected = level;
  }
  if (!selected) return;
  character.gap_note = asText(selected['note']);
  character.cool_turns_remaining = asInt(gap['cool_turns']);
}

export function spendCoolTurn(character: CharacterState): void {
  const remaining = asInt(character.cool_turns_remaining);
  if (remaining <= 0) return;
  character.cool_turns_remaining = remaining - 1;
  if (character.cool_turns_remaining === 0) character.gap_note = '';
}
