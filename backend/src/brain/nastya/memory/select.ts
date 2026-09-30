import type { ConversationState, Memory } from '../kernel/types';
import { characterDate, daysBetween, parseDate } from '../kernel/clock';
import { importance as toImportance } from '../kernel/coerce';
import { intersectionSize, tokens } from './text';

const CORRECTED_SOURCES = new Set([
  'user_correction',
  'dialogue_correction',
  'manual',
]);

export function selectRelevantMemories(
  state: ConversationState,
  query: string,
  today: string = characterDate(),
  limit = 24,
): Memory[] {
  const queryTokens = tokens(query);
  const scored: Array<{
    score: number;
    age: number;
    index: number;
    memory: Memory;
  }> = [];

  (state.memories ?? []).forEach((memory, index) => {
    if (!memory || typeof memory !== 'object' || !memory.text) return;
    const created = parseDate(memory.created_on) || today;
    const ageDays = Math.max(0, daysBetween(created, today));
    const overlap = intersectionSize(queryTokens, tokens(memory.text));
    let score = overlap * 12 + toImportance(memory.importance ?? 3);
    if (memory.kind === 'open_loop' && memory.status === 'active') score += 8;
    if (ageDays >= 2 && ageDays <= 30 && memory.last_recalled_on !== today)
      score += 3;
    if (memory.status === 'resolved') score -= 2;
    if (CORRECTED_SOURCES.has(memory.source)) score += 10;
    scored.push({ score, age: ageDays, index, memory });
  });

  scored.sort(
    (left, right) =>
      right.score - left.score ||
      left.age - right.age ||
      right.index - left.index,
  );

  return scored.slice(0, limit).map(({ memory }) => {
    const { revisions: _revisions, ...rest } = structuredClone(memory);
    return rest as Memory;
  });
}
