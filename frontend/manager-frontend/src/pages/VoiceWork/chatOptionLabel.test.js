import { expect, test } from 'vitest';
import { chatOptionLabel } from './TaskChat';

test('в списке диалогов сначала мессенджер; у VK — id собеседника, а не номер чата', () => {
  expect(chatOptionLabel({ chat_id: '6000000250165010', channel: 'vk', peer_id: '250165010', label: 'Дима', persona_name: 'nastya' }, true))
    .toBe('ВК · Дима · id250165010 · nastya');
  expect(chatOptionLabel({ chat_id: '516013134', channel: 'telegram', peer_id: '516013134', label: 'Диана', persona_name: 'artem' }, true))
    .toBe('Telegram · Диана · 516013134 · artem');
  expect(chatOptionLabel({ chat_id: '42', channel: 'telegram', peer_id: '42', label: 'Вова', unassigned: true }))
    .toBe('Telegram · Вова · 42 · без менеджера');
});
