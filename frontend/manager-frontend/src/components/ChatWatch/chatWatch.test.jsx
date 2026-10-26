// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../api/conversations', () => ({
  getConversationById: vi.fn(async (id) => ({
    chat_id: id,
    is_paused: id === 2,
    pinned_facts: { name: `Клиент ${id}` },
    messages: [
      { id: 1, role: 'user', content: 'привет', ts: 1_700_000_000 },
      { id: 2, role: 'assistant', author: 'bot', content: 'привет-привет', ts: 1_700_000_060 },
    ],
  })),
  getConversationRevision: vi.fn(async () => ({ revision: 'r1' })),
  markListened: vi.fn(async () => ({})),
}));

import ConversationsTable from '../ConversationsTable/ConversationsTable';
import ChatWatchLayer from './ChatWatchLayer';
import { ChatWatchContext, MAX_WATCH, WATCH_H, WATCH_W, clampWatch, freeSlot, nextSlot, useChatWatchState } from './chatWatch';

const now = Math.floor(Date.now() / 1000);
const ROWS = [1, 2].map((chat_id) => ({
  chat_id,
  name: `Клиент ${chat_id}`,
  last_message_ts: now - chat_id,
  unread_count: 0,
  stage: { id: 'knock', title: 'Знакомство', index: 0 },
}));

function Harness() {
  const watch = useChatWatchState();
  return (
    <ChatWatchContext.Provider value={watch}>
      <ConversationsTable rows={ROWS} />
      <ChatWatchLayer />
    </ChatWatchContext.Provider>
  );
}

let host, root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

// Окно грузится лениво: ждём, пока появятся окна с лентой.
const settle = async (count = 1) => {
  for (let i = 0; i < 200; i += 1) {
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    const feeds = document.querySelectorAll('[data-testid="watch-feed"]').length;
    if (feeds >= count) return;
  }
};
const rowButton = (chatId, label) =>
  document.querySelector(`tbody tr[data-chat-id="${chatId}"] button[aria-label="${label}"]`);
const windows = () => [...document.querySelectorAll('[data-testid="watch-window"]')];

describe('окна наблюдения за диалогами', () => {
  it('«Следить» открывает окно с перепиской и тем, кто ведёт; окон может быть несколько', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => rowButton(1, 'Следить').click());
    await act(async () => rowButton(2, 'Следить').click());
    await settle(2);

    expect(windows().map((w) => w.dataset.chatId)).toEqual(['1', '2']);
    const first = windows()[0];
    expect(first.getAttribute('aria-label')).toBe('Наблюдение: Клиент 1');
    expect(first.querySelector('[data-testid="watch-feed"]').textContent).toContain('привет-привет');
    expect(first.textContent).toContain('Ведёт бот');
    expect(windows()[1].textContent).toContain('Ведёт менеджер');
    // Кнопка в строке меняется на «Не следить» и закрывает окно.
    await act(async () => rowButton(1, 'Не следить').click());
    expect(windows().map((w) => w.dataset.chatId)).toEqual(['2']);
  });

  it('свёрнутое окно уходит на полку и разворачивается обратно; набор окон переживает перезагрузку', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => rowButton(1, 'Следить').click());
    await settle();
    await act(async () => windows()[0].querySelector('button[aria-label="Свернуть"]').click());
    expect(windows()).toHaveLength(0);
    const dock = document.querySelector('[data-testid="watch-dock"]');
    expect(dock.textContent).toContain('Клиент 1');

    const saved = JSON.parse(localStorage.getItem('chat_watch_v1'));
    expect(saved).toEqual([expect.objectContaining({ chatId: 1, minimized: true })]);

    await act(async () => dock.querySelector('button[title="Развернуть: Клиент 1"]').click());
    await settle();
    expect(windows()).toHaveLength(1);
    await act(async () => windows()[0].querySelector('button[aria-label="Открыть чат"]').click());
    expect(navigate).toHaveBeenCalledWith('/conversation/1');
  });

  it('окно не уезжает за край экрана, новые встают справа налево', () => {
    const view = { width: 1600, height: 900 };
    expect(clampWatch(-50, 2000, view)).toEqual({ x: 12, y: 900 - WATCH_H - 12 });
    expect(nextSlot(0, view).x).toBe(1600 - WATCH_W - 12);
    expect(nextSlot(1, view).x).toBe(1600 - 2 * (WATCH_W + 12));
    expect(MAX_WATCH).toBe(6);
  });

  it('новое окно встаёт на освободившееся место, а не на последнее окно', () => {
    // Шесть окон в ряд: седьмое закрывает самое старое (место 0) и встаёт туда.
    const wide = { width: 2200, height: 1000 };
    const kept = [1, 2, 3, 4, 5].map((i) => ({ chatId: i, ...nextSlot(i, wide) }));
    expect(freeSlot(kept, wide)).toEqual(nextSlot(0, wide));
    // Свёрнутые места не занимают; подвинутое окно освобождает своё.
    expect(freeSlot([{ chatId: 9, ...nextSlot(0, wide), minimized: true }, ...kept], wide)).toEqual(nextSlot(0, wide));
    const moved = [{ chatId: 0, x: 12, y: 12 }, ...kept.slice(1)];
    expect(freeSlot(moved, wide)).toEqual(nextSlot(0, wide));

    // 1920px: в ряд пять, шестое — лесенкой поверх первого. Седьмое не ложится
    // точно на шестое, а встаёт на место закрытого со сдвигом — шапки видны.
    const view = { width: 1920, height: 1000 };
    const six = [1, 2, 3, 4, 5].map((i) => ({ chatId: i, ...nextSlot(i, view) }));
    const slot = freeSlot(six, view);
    expect(six.some((w) => w.x === slot.x && w.y === slot.y)).toBe(false);
    expect(slot).toEqual(nextSlot(0, view));
  });
});
