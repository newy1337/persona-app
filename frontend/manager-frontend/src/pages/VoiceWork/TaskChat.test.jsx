// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import { TaskChat, TaskChatSelect } from './TaskChat';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;
const task = { id: 42, chatId: '444', status: 'in_progress', kind: 'call', contactLabel: 'Дима', personaName: 'Настя' };
const row = (id, role, text, author = 'llm') => ({ id, role, text, author, ts: 100 + id });
const click = async text => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === text).click());
beforeEach(() => {
  vi.useFakeTimers(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

test('shows client, manager and bot messages during a call and refreshes without write controls', async () => {
  let result = { items: [row(1, 'user', 'Привет'), row(2, 'assistant', 'От менеджера', 'operator:web'), row(3, 'assistant', 'От бота')] };
  vi.spyOn(api, 'get').mockImplementation(async () => result);
  await act(async () => root.render(<TaskChat task={task} />));
  expect(host.textContent).toContain('Привет'); expect(host.textContent).toContain('Менеджер'); expect(host.textContent).toContain('Бот · Настя');
  expect(host.querySelector('input, textarea')).toBeNull();
  result = { items: [...result.items, row(4, 'user', 'Новое сообщение')] };
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(host.textContent).toContain('Новое сообщение');
  expect(api.get).toHaveBeenLastCalledWith('/api/voicer/tasks/42/conversation');
});

test('pages older history separately and returns to live latest messages', async () => {
  vi.spyOn(api, 'get').mockImplementation(async url => url.includes('before=') ? { items: [row(1, 'user', 'Старая история')], next_before: null } : { items: [row(101, 'user', 'Свежий ответ')], next_before: 101 });
  await act(async () => root.render(<TaskChat task={task} />));
  await click('Ранние сообщения'); expect(host.textContent).toContain('Старая история');
  expect(api.get).toHaveBeenLastCalledWith('/api/voicer/tasks/42/conversation?before=101');
  await click('К последним'); expect(host.textContent).toContain('Свежий ответ');
});

test('clears previously loaded messages when access is revoked', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [row(1, 'user', 'Приватная переписка')] });
  await act(async () => root.render(<TaskChat task={task} />));
  api.get.mockRejectedValue(Object.assign(new Error('Доступ закрыт'), { status: 404 }));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(host.textContent).not.toContain('Приватная переписка'); expect(host.querySelector('[role=alert]').textContent).toContain('Доступ закрыт');
});

test('keeps readable history with a visible connection error and explains an unlinked task', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [row(1, 'user', 'Сохранённый ответ')] });
  await act(async () => root.render(<TaskChat task={task} />));
  api.get.mockRejectedValue(new Error('Нет связи'));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(host.textContent).toContain('Сохранённый ответ'); expect(host.querySelector('[role=alert]').textContent).toContain('ранее загруженные');
  await act(async () => root.render(<TaskChat task={{ ...task, chatId: null }} />));
  expect(host.textContent).toContain('Диалог не привязан');
});

test('hides deleted content and marks edited messages', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [{ ...row(1, 'user', 'Удалённый секрет'), deletedAt: 300, has_file: true }, { ...row(2, 'user', 'Исправление'), editedAt: 301 }] });
  await act(async () => root.render(<TaskChat task={task} />));
  expect(host.textContent).not.toContain('Удалённый секрет'); expect(host.textContent).toContain('Сообщение удалено'); expect(host.textContent).toContain('Изменено');
});

test('chooses an explicit conversation and never silently assigns the first match', async () => {
  const onChange = vi.fn();
  vi.spyOn(api, 'get').mockResolvedValue({ items: [{ chat_id: '444', label: 'Дима', contact_ref: '@dima' }] });
  await act(async () => root.render(<TaskChatSelect managerId={2} persona="nastya" value="" onChange={onChange} />));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(onChange).not.toHaveBeenCalled(); expect(host.textContent).toContain('Без привязки');
  const select = host.querySelector('select');
  await act(async () => { select.value = '444'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(onChange).toHaveBeenCalledWith('444', { chat_id: '444', label: 'Дима', contact_ref: '@dima' });
});

test('explains task-only access for an unassigned conversation selected by an admin', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ items: [{ chat_id: '666', label: 'Дима', unassigned: true }] });
  await act(async () => root.render(<TaskChatSelect managerId={2} persona="nastya" value="666" onChange={vi.fn()} />));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(host.querySelector('select').value).toBe('666');
  expect(host.textContent).toContain('без менеджера');
  expect(host.textContent).toContain('Остальные диалоги аккаунта останутся закрыты');
});
