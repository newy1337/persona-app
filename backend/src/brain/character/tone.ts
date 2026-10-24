import type { CharacterState, Stage } from '../kernel/types';

export function moveTone(
  goals: Record<string, any>,
  character: CharacterState,
): void {
  const stages: Stage[] = goals['stages'] ?? [];
  const stage =
    stages.find((item) => item.id === character.stage_id) ?? stages[0];
  const target = stage?.manner ?? {};
  const current = (character.tone ??= { ...target });
  const step = Number(goals['tone_step'] ?? 0.04);
  for (const [key, targetValue] of Object.entries(target)) {
    const value = Number(current[key] ?? targetValue);
    const difference = Number(targetValue) - value;
    current[key] = Number(
      (value + Math.max(-step, Math.min(step, difference))).toFixed(4),
    );
  }
}
