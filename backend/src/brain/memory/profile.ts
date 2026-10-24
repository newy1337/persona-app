import type { ConversationState } from '../kernel/types';
import { characterDate } from '../kernel/clock';
import { recordMemoryUpdates } from './memories';

const LIMITS = { name: 80, age: 20, dating_site: 120 } as const;

export interface InterlocutorProfile {
  name?: string;
  age?: string;
  dating_site?: string;
}

export function seedInterlocutorSettings(
  state: ConversationState,
  profile: InterlocutorProfile,
  today: string = characterDate(),
): void {
  const character = (state.character ??= {});
  const slots = (character.slots ??= {});
  const previous = (character.settings_snapshot ??= {});

  const incoming: Record<string, string> = {
    name: (profile.name ?? '').slice(0, LIMITS.name),
    age: (profile.age ?? '').slice(0, LIMITS.age),
    dating_site: (profile.dating_site ?? '').slice(0, LIMITS.dating_site),
  };

  for (const [key, raw] of Object.entries(incoming)) {
    const value = raw.trim();
    const known = key in previous;
    const changed = known && value !== previous[key];
    if (value && (changed || (!known && !(key in slots)))) {
      slots[key] = value;
      recordMemoryUpdates(
        state,
        [
          {
            action: 'remember',
            kind: 'fact',
            slot_id: key,
            text: value,
            importance: 4,
          },
        ],
        today,
        'profile_settings',
      );
    } else if (changed && !value) {
      delete slots[key];
      state.memories = (state.memories ?? []).filter(
        (item) => item.slot_id !== key,
      );
    }
    previous[key] = value;
  }
  state.user_name = slots['name'] ?? '';
}

const OPERATOR_SLOT_LIMIT = 500;

export function applyOperatorSlots(
  state: ConversationState,
  patch: Record<string, string | null>,
  today: string = characterDate(),
): string[] {
  const character = (state.character ??= {});
  const slots = (character.slots ??= {});
  const changed: string[] = [];
  for (const [slotId, raw] of Object.entries(patch)) {
    const value = (raw ?? '').trim().slice(0, OPERATOR_SLOT_LIMIT);
    if (!value) {
      character.cleared_slots = [
        ...new Set([...(character.cleared_slots ?? []), slotId]),
      ];
      if (!(slotId in slots)) continue;
      delete slots[slotId];
      state.memories = (state.memories ?? []).filter(
        (item) => item.slot_id !== slotId,
      );
      changed.push(slotId);
      continue;
    }
    character.cleared_slots = (character.cleared_slots ?? []).filter(
      (id) => id !== slotId,
    );
    if (slots[slotId] === value) continue;
    slots[slotId] = value;
    recordMemoryUpdates(
      state,
      [
        {
          action: 'remember',
          kind: 'fact',
          slot_id: slotId,
          text: value,
          importance: 4,
        },
      ],
      today,
      'operator',
    );
    changed.push(slotId);
  }
  if ('name' in patch) state.user_name = slots['name'] ?? '';
  return changed;
}
