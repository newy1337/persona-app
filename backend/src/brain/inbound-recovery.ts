import type { StoredMessage } from 'src/shared/history.service';
import type { InboundTurn, InboundMedia } from './reply-brain.port';

export function restoredTurn(
  message: StoredMessage,
  accountId: number,
): InboundTurn {
  let saved: Partial<InboundTurn> = {};
  try {
    saved = JSON.parse(message.inbound_payload ?? '{}');
  } catch {
    /* no payload: rebuild from the columns below */
  }
  const kind = message.media_kind as InboundMedia['kind'] | null;
  const text = message.text.replace(/^\[[^\]]+\]\n?/, '');
  const media =
    saved.media ??
    (kind
      ? {
          kind,
          ...(message.file_path ? { path: message.file_path } : {}),
          ...(['voice', 'video_note'].includes(kind)
            ? { transcript: text || null }
            : {}),
        }
      : null);
  return {
    ...saved,
    chatId: message.chat_id,
    accountId,
    messageId: message.source_message_id!,
    ts: message.ts,
    text:
      saved.text ??
      (kind
        ? kind === 'voice' || kind === 'video_note'
          ? ''
          : text
        : message.text),
    media,
    replay: true,
  };
}
