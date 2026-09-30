import { randomUUID } from 'node:crypto';
import type {
  ConversationState,
  Memory,
  MemoryKind,
  MemoryUpdate,
} from '../kernel/types';
import { MEMORY_KINDS } from '../kernel/types';
import { characterDate } from '../kernel/clock';
import { asText, importance as toImportance } from '../kernel/coerce';
import { normalizeMemoryText } from './text';

const TEXT_LIMIT = 800;
const EVIDENCE_LIMIT = 2000;

/** Replacing a memory keeps the superseded wording in its revision history. */
function reviseMemory(memory: Memory, text: string, today: string): void {
  if (text !== memory.text) {
    (memory.revisions ??= []).push({
      text: memory.text ?? '',
      replaced_on: today,
    });
  }
  memory.text = text;
  memory.updated_on = today;
}

function writeSlot(
  state: ConversationState,
  slotId: string,
  text: string,
): void {
  ((state.character ??= {}).slots ??= {})[slotId] = text;
}

/**
 * Applies the judge's memory updates in place.
 *
 * `remember` merges into an existing record for the same slot (or the same
 * wording), so repeating a fact revises it instead of duplicating it.
 */
export function recordMemoryUpdates(
  state: ConversationState,
  updates: Array<Partial<MemoryUpdate>>,
  today: string = characterDate(),
  evidence = '',
): void {
  const memories = (state.memories ??= []);
  const byId = new Map<string, Memory>(
    memories.filter((item) => item?.id).map((item) => [item.id, item]),
  );

  for (const update of updates) {
    if (!update || typeof update !== 'object') continue;
    const action = asText(update.action) || 'remember';
    const memoryId = asText(update.memory_id);
    const kind = (asText(update.kind) || 'fact') as MemoryKind;
    const text = asText(update.text).trim().slice(0, TEXT_LIMIT);

    if (action === 'replace' || action === 'resolve') {
      const existing = byId.get(memoryId);
      if (!existing || (action === 'replace' && !text)) continue;
      reviseMemory(existing, text || existing.text, today);
      existing.status = action === 'resolve' ? 'resolved' : 'active';
      existing.source =
        action === 'replace' ? 'dialogue_correction' : 'dialogue';
      if (update.scope === 'communication' && update.kind === 'preference') {
        existing.scope = 'communication';
        existing.kind = 'preference';
      }
      existing.evidence = evidence.slice(0, EVIDENCE_LIMIT);
      if (evidence === 'operator' || evidence === 'profile_settings')
        delete existing.source_message_ids;
      if (update.due_on) existing.due_on = update.due_on;
      if (existing.slot_id) writeSlot(state, existing.slot_id, existing.text);
      continue;
    }

    if (action !== 'remember' || !MEMORY_KINDS.includes(kind) || !text)
      continue;

    const slotId = asText(update.slot_id);
    const normalized = normalizeMemoryText(text);
    const existing = memories.find((item) =>
      slotId
        ? item.slot_id === slotId
        : !item.slot_id &&
          item.kind === kind &&
          normalizeMemoryText(item.text ?? '') === normalized,
    );

    if (existing) {
      reviseMemory(existing, text, today);
      existing.importance = toImportance(update.importance ?? 3);
      if (update.scope === 'communication' && kind === 'preference')
        existing.scope = 'communication';
      existing.evidence = evidence.slice(0, EVIDENCE_LIMIT);
      if (evidence === 'operator' || evidence === 'profile_settings')
        delete existing.source_message_ids;
      if (update.due_on) existing.due_on = update.due_on;
      if (slotId) {
        existing.source =
          evidence === 'operator'
            ? 'operator'
            : evidence === 'profile_settings'
              ? 'profile_settings'
              : 'dialogue_correction';
      }
      continue;
    }

    const memory: Memory = {
      id: randomUUID().replace(/-/g, ''),
      ...(update.scope === 'communication' && kind === 'preference'
        ? { scope: 'communication' as const }
        : {}),
      kind,
      text,
      status: 'active',
      importance: toImportance(update.importance ?? 3),
      created_on: today,
      updated_on: today,
      last_recalled_on: '',
      recall_count: 0,
      source:
        evidence === 'operator'
          ? 'operator'
          : evidence === 'profile_settings'
            ? 'profile_settings'
            : 'dialogue',
      evidence: evidence.slice(0, EVIDENCE_LIMIT),
    };
    if (slotId) memory.slot_id = slotId;
    if (update.due_on) memory.due_on = update.due_on;
    memories.push(memory);
    byId.set(memory.id, memory);
  }
}

export function markMemoryRecalled(
  state: ConversationState,
  memoryId: string,
  today: string,
): void {
  const memory = (state.memories ?? []).find((item) => item.id === memoryId);
  if (!memory) return;
  memory.last_recalled_on = today;
  memory.recall_count = (memory.recall_count ?? 0) + 1;
}
