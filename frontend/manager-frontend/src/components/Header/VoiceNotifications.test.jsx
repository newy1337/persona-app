// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import VoiceNotifications from './VoiceNotifications';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host, result;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  result = { unread: 1, items: [{ id: 7, taskId: 42, text: 'Голосовое готово: Доброе утро', createdAt: 100, readAt: null }] };
  vi.spyOn(api, 'get').mockImplementation(async () => result);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
const render = () => act(async () => root.render(<MemoryRouter><VoiceNotifications userId={2} /></MemoryRouter>));
test('shows unread ready notification on any page and links to the task', async () => {
  await render();
  expect(host.querySelector('[role=status]').textContent).toContain('Голосовое готово');
  const bell = host.querySelector('[aria-label="Уведомления: 1 непрочитанных"]');
  await act(async () => bell.click());
  expect(host.querySelector('[role=dialog]')).not.toBeNull();
  expect(host.querySelector('a').getAttribute('href')).toBe('/voice?task=42');
  const post = vi.spyOn(api, 'post').mockImplementation(async () => { result = { ...result, unread: 0, items: [{ ...result.items[0], readAt: 200 }] }; return {}; });
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Прочитано').click());
  expect(post).toHaveBeenCalledWith('/api/voicer/notices/7/read', {});
  expect(host.querySelector('[aria-label="Уведомления: 0 непрочитанных"]')).not.toBeNull();
});
test('hiding the banner keeps the persistent unread notice', async () => {
  await render();
  await act(async () => host.querySelector('[aria-label="Скрыть уведомление"]').click());
  expect(host.querySelector('[role=status]')).toBeNull();
  expect(host.querySelector('[aria-label="Уведомления: 1 непрочитанных"]')).not.toBeNull();
});
test('auto-hides after seven seconds without marking read or removing bell history', async () => {
  vi.useFakeTimers(); const post = vi.spyOn(api, 'post'); await render();
  await act(async () => vi.advanceTimersByTime(6999)); expect(host.querySelector('[role=status]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(1)); expect(host.querySelector('[role=status]')).toBeNull();
  await act(async () => vi.advanceTimersByTime(10000)); expect(host.querySelector('[role=status]')).toBeNull();
  expect(post).not.toHaveBeenCalled();
  await act(async () => host.querySelector('[aria-label="Уведомления: 1 непрочитанных"]').click());
  expect(host.querySelector('[role=dialog]').textContent).toContain('Голосовое готово');
});
