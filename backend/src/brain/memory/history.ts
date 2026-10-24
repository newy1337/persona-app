import { randomUUID } from 'node:crypto';
import type { ConversationState, HistoryMessage, Role } from '../kernel/types';

export function historyMessage(
  role: Role,
  content: string,
  createdAt: number,
  source: string,
): HistoryMessage {
  return {
    id: randomUUID().replace(/-/g, ''),
    role,
    content,
    created_at: createdAt,
    source,
  };
}

export function rememberExchange(
  state: ConversationState,
  userText: string,
  assistantText: string | string[],
  createdAt?: number,
): void {
  const timestamp = createdAt ?? Math.floor(Date.now() / 1000);
  const replies = Array.isArray(assistantText)
    ? assistantText
    : [assistantText];
  state.history = [
    ...(state.history ?? []),
    historyMessage('user', userText, timestamp, 'dialogue'),
    ...replies
      .filter((text) => text.trim())
      .map((text) => historyMessage('assistant', text, timestamp, 'dialogue')),
  ];
}

export function appendAssistantMessage(
  state: ConversationState,
  text: string,
  source = 'initiative',
  createdAt?: number,
): HistoryMessage {
  const message = historyMessage(
    'assistant',
    text,
    createdAt ?? Math.floor(Date.now() / 1000),
    source,
  );
  (state.history ??= []).push(message);
  return message;
}
