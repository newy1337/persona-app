import { describe, expect, it } from 'vitest';
import { canEdit } from './ConversationPage';

describe('кнопка «Изменить»', () => {
  const ours = { id: 1, tg_msg_id: 10, role: 'assistant', content: 'я в Мадриде' };
  it('только наше текстовое сообщение, ушедшее в Telegram', () => {
    expect(canEdit(ours, 'bot')).toBe(true);
    expect(canEdit({ ...ours, role: 'user' }, 'client')).toBe(false);
    expect(canEdit({ ...ours, tg_msg_id: null }, 'bot')).toBe(false);
    expect(canEdit({ ...ours, deleted_at: 5 }, 'bot')).toBe(false);
    expect(canEdit({ ...ours, media_kind: 'photo' }, 'bot')).toBe(false);
    expect(canEdit({ ...ours, content: '[Реакция: 👍]' }, 'bot')).toBe(false);
  });
});
