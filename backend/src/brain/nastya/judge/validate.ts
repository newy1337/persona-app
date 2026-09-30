import type {
  Judgment,
  MediaRequest,
  MemoryKind,
  MemoryUpdate,
  ResponseKind,
} from '../kernel/types';
import { GOALS, MEDIA_REQUESTS, MEMORY_KINDS } from '../kernel/types';
import { asText, clamp, stringList } from '../kernel/coerce';
import { isIsoDate } from '../kernel/clock';

const RESPONSE_KINDS: readonly ResponseKind[] = ['short', 'normal', 'story'];
const MAX_MEMORY_UPDATES = 12;

export function validateMemoryUpdates(
  value: unknown,
  allowedMemoryIds: Set<string>,
): MemoryUpdate[] {
  if (!Array.isArray(value)) return [];
  const updates: MemoryUpdate[] = [];
  for (const item of value.slice(0, MAX_MEMORY_UPDATES)) {
    if (!item || typeof item !== 'object') continue;
    const action = asText(item.action) || 'remember';
    const kind = (asText(item.kind) || 'fact') as MemoryKind;
    const text = asText(item.text).trim().slice(0, 800);
    const memoryId = asText(item.memory_id);
    if (!['remember', 'replace', 'resolve'].includes(action)) continue;
    if (!MEMORY_KINDS.includes(kind)) continue;
    if (
      (action === 'replace' || action === 'resolve') &&
      !allowedMemoryIds.has(memoryId)
    )
      continue;
    if (action !== 'resolve' && !text) continue;
    const rawImportance = Number(item.importance ?? 3);
    updates.push({
      action: action as MemoryUpdate['action'],
      kind,
      ...(item.scope === 'communication' && kind === 'preference'
        ? { scope: 'communication' as const }
        : {}),
      text,
      memory_id: action === 'remember' ? '' : memoryId,
      importance: Number.isFinite(rawImportance)
        ? clamp(Math.trunc(rawImportance), 1, 5)
        : 3,
      due_on: isIsoDate(asText(item.due_on)) ? asText(item.due_on) : '',
    });
  }
  return updates;
}

export function validateJudgment(
  value: Record<string, any>,
  allowedSlots: Set<string>,
  askableSlots: Set<string>,
  allowedMemoryIds: Set<string>,
  allowedStorylineIds: Set<string>,
  userText: string,
): Judgment {
  const rawSlots = value['slot_updates'];
  const slotUpdates: Record<string, string> = {};
  if (rawSlots && typeof rawSlots === 'object' && !Array.isArray(rawSlots)) {
    for (const [key, item] of Object.entries(rawSlots)) {
      const usable =
        typeof item === 'string' ||
        (typeof item === 'number' && Number.isFinite(item));
      if (!allowedSlots.has(key) || !usable) continue;
      const text = String(item).trim().slice(0, 500);
      if (text) slotUpdates[key] = text;
    }
  }

  let goal = asText(value['goal']) || 'respond';
  if (!GOALS.includes(goal as any)) goal = 'respond';
  let target = asText(value['target_slot']);
  if (!askableSlots.has(target) || goal !== 'ask') target = '';
  if (goal === 'ask' && !target) goal = 'respond';

  const callback = asText(value['callback_memory_id']);
  const storyline = asText(value['storyline_id']);
  const responseKind = asText(value['response_kind']) || 'normal';

  const voice = value['voice_reply'];
  return {
    voice_reply: {
      send:
        voice?.send === true &&
        typeof voice?.reason === 'string' &&
        Boolean(voice.reason.trim()),
      emotion:
        typeof voice?.emotion === 'string'
          ? voice.emotion.trim().slice(0, 300)
          : 'Естественно, в характере личности',
      reason:
        typeof voice?.reason === 'string'
          ? voice.reason.trim().slice(0, 500)
          : '',
    },
    intent: (asText(value['intent']) || userText.slice(0, 200)).slice(0, 300),
    sentiment: (asText(value['sentiment']) || 'neutral').slice(0, 30),
    user_asked_question:
      (value['user_asked_question'] ?? userText.includes('?')) === true,
    question_allowed: value['question_allowed'] === true,
    slot_updates: slotUpdates,
    memory_updates: validateMemoryUpdates(
      value['memory_updates'],
      allowedMemoryIds,
    ),
    agreements: stringList(value['agreements'], 10, 500),
    deferred_slots: stringList(value['deferred_slots'], 30, 80).filter((id) =>
      allowedSlots.has(id),
    ),
    resumed_slots: stringList(value['resumed_slots'], 30, 80).filter((id) =>
      allowedSlots.has(id),
    ),
    callback_memory_id: allowedMemoryIds.has(callback) ? callback : '',
    storyline_id: allowedStorylineIds.has(storyline) ? storyline : '',
    goal: goal as Judgment['goal'],
    target_slot: target,
    response_kind: (RESPONSE_KINDS.includes(responseKind as ResponseKind)
      ? responseKind
      : 'normal') as ResponseKind,
    guidance: (
      asText(value['guidance']) || 'Ответить прямо и естественно.'
    ).slice(0, 1000),
    media_request: (MEDIA_REQUESTS as readonly string[]).includes(
      asText(value['media_request']),
    )
      ? (asText(value['media_request']) as MediaRequest)
      : '',
  };
}
