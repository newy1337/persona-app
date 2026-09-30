import type { RuntimeSnapshot, Storyline } from '../kernel/types';

export interface JudgeReference {
  persona: Record<string, unknown>;
  slot_catalog: Record<string, unknown>[];
  past_episodes: Record<string, unknown>[];
}

export const REFERENCED_STATE_KEYS = ['persona', 'slot_catalog'] as const;

export function judgeReference(runtime: RuntimeSnapshot): JudgeReference {
  return {
    persona: runtime.persona as Record<string, unknown>,
    slot_catalog: runtime.slot_catalog as unknown as Record<string, unknown>[],
    past_episodes: (runtime.storylines as Storyline[])
      .filter((line) => line.kind === 'past_episode')
      .map((line) => ({ ...line, last_shared_on: '' })),
  };
}

export function referenceText(reference: JudgeReference): string {
  return `СПРАВОЧНИК (общий для всех диалогов; persona, slot_catalog и past_episodes ниже — те же поля, что раньше были в dialogue_state):\n${JSON.stringify(reference)}`;
}
