import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ConversationState, Judgment } from './kernel/types';
import { CAPTION_LIMIT } from 'src/domain/photo-library';

export interface VoiceReplyPlan {
  emotion: string;
  reason: string;
  context_id: number;
  context_hash: string;
}
/** Фото из образа, выбранное к ответу: уходит первой частью, текст — подписью. */
export interface PhotoReplyPlan {
  photo_id: number;
  file_path: string;
  note: string;
  account_id: number;
  /** Текст до фото, подпись к нему и текст после — в таком порядке и уходят. */
  before?: string;
  caption?: string;
  after?: string;
}
export interface PreparedReply {
  voice?: VoiceReplyPlan;
  photo?: PhotoReplyPlan;
  reply: string;
  state: ConversationState;
  judgment: Judgment;
  date: string;
  today: string;
  basisState?: string;
  basisPersona?: string;
  generatedAt?: number;
}

export interface ReplyDelivery extends PreparedReply {
  id: string;
  parts: Array<{
    text: string;
    randomId: string;
    dispatchedAt?: number;
    photo?: boolean;
  }>;
  sentCount: number;
  preparedAt: number;
}

export function deliveryRandomId(): string {
  return (
    randomBytes(8).readBigUInt64BE() & ((1n << 63n) - 1n) || 1n
  ).toString();
}

export function prepareDelivery(
  reply: PreparedReply,
  parts: string[],
  now: number,
  /** Номер части-подписи; parts.length — фото последним без подписи. */
  photoAt = 0,
): ReplyDelivery {
  const list: ReplyDelivery['parts'] = parts.map((text) => ({
    text,
    randomId: deliveryRandomId(),
  }));
  if (reply.photo) {
    const at = Math.min(Math.max(0, photoAt), list.length);
    // Подпись длиннее лимита Telegram идёт сразу за фото обычным текстом.
    if (list[at] && list[at].text.length <= CAPTION_LIMIT)
      list[at].photo = true;
    else
      list.splice(at, 0, {
        text: '',
        randomId: deliveryRandomId(),
        photo: true,
      });
  }
  return {
    ...reply,
    id: randomUUID(),
    parts: list,
    sentCount: 0,
    preparedAt: now,
  };
}

export function stateFingerprint(state: ConversationState): string {
  return createHash('sha256')
    .update(JSON.stringify({ ...state, history_cursor: undefined }))
    .digest('hex');
}
export function personaFingerprint(persona: {
  slug: string;
  config: unknown;
  rhythm: unknown;
  prompts: unknown;
  variables: Record<string, string>;
  updatedAt?: number;
}): string {
  const shared = Object.fromEntries(
    Object.entries(persona.variables).filter(
      ([key]) =>
        key !== 'city' && key !== 'site' && key !== 'interlocutor_city',
    ),
  );
  return createHash('sha256')
    .update(
      JSON.stringify([
        persona.slug,
        persona.config,
        persona.rhythm,
        persona.prompts,
        shared,
        persona.updatedAt,
      ]),
    )
    .digest('hex');
}
export const REPLY_FRESH_SECONDS = 5 * 60;
export class StaleReply extends Error {}
