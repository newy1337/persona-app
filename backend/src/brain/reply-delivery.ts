import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ConversationState, Judgment } from './nastya/kernel/types';

export interface VoiceReplyPlan {
  emotion: string;
  reason: string;
  context_id: number;
  context_hash: string;
}
export interface PreparedReply {
  voice?: VoiceReplyPlan;
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
  parts: Array<{ text: string; randomId: string; dispatchedAt?: number }>;
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
): ReplyDelivery {
  return {
    ...reply,
    id: randomUUID(),
    parts: parts.map((text) => ({ text, randomId: deliveryRandomId() })),
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
