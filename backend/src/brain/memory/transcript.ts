import type { StoredMessage } from 'src/shared/history.service';
import type { ConversationState, HistoryMessage } from '../kernel/types';

export function reconcileTranscript(
  state: ConversationState,
  rows: StoredMessage[],
  rebuild = false,
): void {
  const old = state.history ?? [];
  const used = new Set<string>();
  const messages = rebuild ? [] : [...old];
  for (const row of rows) {
    state.history_cursor = Math.max(state.history_cursor ?? 0, row.id);
    if (row.role !== 'assistant' && row.role !== 'user') continue;
    const match =
      old.find((m) => m.panel_message_id === row.id) ??
      old.find(
        (m) =>
          !used.has(m.id) &&
          !m.panel_message_id &&
          m.role === row.role &&
          ((row.tg_msg_id && m.telegram_message_id === row.tg_msg_id) ||
            (row.author === 'operator:voice' &&
              m.source === 'operator' &&
              m.created_at === row.ts) ||
            (m.content === row.text && Math.abs(m.created_at - row.ts) < 600)),
      );
    if (match) used.add(match.id);
    const index = match ? messages.findIndex((m) => m.id === match.id) : -1;
    if (row.deleted_at) {
      if (index >= 0) messages.splice(index, 1);
      continue;
    }
    const message: HistoryMessage = {
      ...match,
      id: match?.id ?? `panel:${row.id}`,
      panel_message_id: row.id,
      telegram_message_id: row.tg_msg_id ?? undefined,
      role: row.role,
      content:
        row.text === '[media:voice]' && match?.content
          ? match.content
          : row.text,
      created_at: row.ts,
      source: row.author.startsWith('operator')
        ? 'operator'
        : (match?.source ?? (row.role === 'user' ? 'dialogue' : row.author)),
    };
    if (index >= 0) messages[index] = message;
    else messages.push(message);
  }
  state.history = messages.sort(
    (a, b) =>
      a.created_at - b.created_at ||
      (a.panel_message_id ?? 0) - (b.panel_message_id ?? 0),
  );
}
