import { stripMetadata } from './config';

const CONVERSATION_KEYS = [
  'card',
  'voice',
  'tastes',
  'biography',
  'relationship_values',
  'daily_life',
  'human_behavior',
  'fun_facts',
  'story_usage_rules',
  'work_and_income',
] as const;

export function conversationPersona(
  persona: Record<string, any>,
  name = String(persona?.name ?? ''),
): Record<string, any> {
  const stripped = stripMetadata(persona);
  const { direct_question: _dropped, ...identity } = (stripped['identity'] ??
    {}) as Record<string, unknown>;
  const result: Record<string, any> = { name, identity };
  for (const key of CONVERSATION_KEYS) {
    if (key in stripped) result[key] = stripped[key];
  }
  return result;
}
