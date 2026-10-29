import { Api } from 'telegram';
import { replyOf } from 'src/channels/telegram/telegram.service';
import type { StoredMessage } from 'src/shared/history.service';
import type { ConversationState } from '../kernel/types';
import { buildMessages } from '../llm/generate';
import { quoteSnippet, withReplyQuote } from './reply-quote';
import { reconcileTranscript } from './transcript';

const row = (over: Partial<StoredMessage>): StoredMessage => ({
  id: 1,
  chat_id: 1,
  ts: 100,
  role: 'user',
  text: '',
  author: 'client',
  source_message_id: null,
  source_modality: 'text',
  tg_msg_id: null,
  media_kind: null,
  file_path: null,
  reply_to: null,
  reaction: null,
  deleted_at: null,
  edited_at: null,
  ...over,
});

describe('ответ собеседника на конкретное сообщение', () => {
  it('Telegram: номер сообщения и выделенная цитата; чужой чат не считаем', () => {
    const msg = (replyTo: Api.MessageReplyHeader | undefined) =>
      ({ message: 'да', replyTo }) as Api.Message;
    expect(replyOf(msg(undefined))).toEqual({
      replyTo: null,
      replyQuote: null,
    });
    expect(
      replyOf(msg(new Api.MessageReplyHeader({ replyToMsgId: 42 }))),
    ).toEqual({ replyTo: 42, replyQuote: null });
    expect(
      replyOf(
        msg(
          new Api.MessageReplyHeader({
            replyToMsgId: 42,
            quote: true,
            quoteText: ' в субботу ',
          }),
        ),
      ),
    ).toEqual({ replyTo: 42, replyQuote: 'в субботу' });
    expect(
      replyOf(
        msg(
          new Api.MessageReplyHeader({
            replyToMsgId: 42,
            replyToPeerId: new Api.PeerUser({ userId: 7 as any }),
          }),
        ),
      ),
    ).toEqual({ replyTo: null, replyQuote: null });
  });

  it('пометка для модели: одна строка, длинное обрезано, без цитаты — как было', () => {
    expect(withReplyQuote('да', 'Пойдём\nв кино?')).toBe(
      '[в ответ на: «Пойдём в кино?»]\nда',
    );
    expect(withReplyQuote('да', null)).toBe('да');
    expect(withReplyQuote('да', '  ')).toBe('да');
    const long = quoteSnippet('а'.repeat(500))!;
    expect(long.length).toBe(160);
    expect(long.endsWith('…')).toBe(true);
  });

  it('история: ответ на старое сообщение получает его текст и доходит до модели', () => {
    const state = { history: [] } as unknown as ConversationState;
    reconcileTranscript(state, [
      row({
        id: 1,
        role: 'assistant',
        author: 'llm',
        text: 'Ты любишь кино?',
        tg_msg_id: 10,
      }),
      row({
        id: 2,
        role: 'assistant',
        author: 'llm',
        text: 'А где работаешь?',
        tg_msg_id: 11,
      }),
    ]);
    reconcileTranscript(state, [
      row({ id: 3, text: 'очень', tg_msg_id: 12, reply_to: 10 }),
    ]);
    const reply = state.history.find((m) => m.panel_message_id === 3)!;
    expect(reply.reply_quote).toBe('Ты любишь кино?');
    expect(
      state.history.find((m) => m.panel_message_id === 2)!.reply_quote,
    ).toBeUndefined();
    const messages = buildMessages(state.history, 'и сериалы');
    const userBlocks = messages
      .filter((m) => m.role === 'user')
      .flatMap((m) => m.content as Array<{ text: string }>)
      .map((b) => b.text);
    expect(userBlocks).toContain('[в ответ на: «Ты любишь кино?»]\nочень');
  });
});
