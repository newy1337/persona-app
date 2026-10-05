// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import VoiceNotifications from './VoiceNotifications';
import { SHOWN_KEY, STORAGE_KEY, pruneDismissed, queueKey, queueText } from './queueNotices';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host, queue;
const notices = { unread: 0, items: [] };
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(SHOWN_KEY);
  queue = { items: [{ chat_id: 555, name: 'Олег', queue_reason: 'media_photo', waiting_since: Math.floor(Date.now() / 1000) - 600, manager_name: 'manager1' }] };
  vi.spyOn(api, 'get').mockImplementation(async (url) => (url.includes('/manager/queue') ? queue : notices));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
const render = () => act(async () => root.render(<MemoryRouter><VoiceNotifications userId={2} /></MemoryRouter>));

test('чат из очереди виден на колокольчике и в баннере, пока его не закроют', async () => {
  await render();
  expect(host.querySelector('[aria-label="Уведомления: 1 непрочитанных"]')).not.toBeNull();
  const banner = host.querySelector('[data-testid="queue-banner"]');
  expect(banner.textContent).toContain('Олег: Просит фото');
  await act(async () => host.querySelector('[aria-label="Закрыть уведомление"]').click());
  expect(host.querySelector('[data-testid="queue-banner"]')).toBeNull();
  expect(host.querySelector('[aria-label="Уведомления: 0 непрочитанных"]')).not.toBeNull();
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toHaveProperty(queueKey(queue.items[0]));
});

test('закрытое уведомление не возвращается после перерисовки, а новое попадание в очередь — да', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ [queueKey(queue.items[0])]: Math.floor(Date.now() / 1000) }));
  await render();
  expect(host.querySelector('[data-testid="queue-banner"]')).toBeNull();
  const again = { ...queue.items[0], waiting_since: queue.items[0].waiting_since + 100 };
  expect(pruneDismissed({ [queueKey(queue.items[0])]: 1 }, [again])).toEqual({});
  expect(queueText({ chat_id: 9, client_username: 'oleg', queue_reason: 'trigger_phrase' })).toBe('@oleg: Стоп-фраза клиента');
});

test('в списке есть кнопка «Открыть чат» и подсказка включить push', async () => {
  await render();
  await act(async () => host.querySelector('[aria-label="Уведомления: 1 непрочитанных"]').click());
  const notice = host.querySelector('[data-testid="queue-notice"]');
  expect(notice.textContent).toContain('ждёт 10 мин');
  expect([...notice.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Открыть чат', 'Закрыть']);
});

test('баннер уходит через три секунды, но чат остаётся в колокольчике непрочитанным', async () => {
  vi.useFakeTimers();
  await render();
  expect(host.querySelector('[data-testid="queue-banner"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(2999));
  expect(host.querySelector('[data-testid="queue-banner"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(1));
  expect(host.querySelector('[data-testid="queue-banner"]')).toBeNull();
  expect(host.querySelector('[aria-label="Уведомления: 1 непрочитанных"]')).not.toBeNull();
  expect(JSON.parse(sessionStorage.getItem(SHOWN_KEY))).toContain(queueKey(queue.items[0]));
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});
