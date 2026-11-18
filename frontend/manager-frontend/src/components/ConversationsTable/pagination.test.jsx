// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
const { page } = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock('../../api/conversations', () => ({ getConversationPage: page, downloadChats: vi.fn() }));

import ConversationsTable from './ConversationsTable';
import { fakeConversationPage } from '../../test/fakeConversationPage';

const now = Math.floor(Date.now() / 1000);
const rows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    chat_id: 1000 + i,
    id: 1000 + i,
    name: `Клиент ${i}`,
    last_message_ts: now - i * 60,
    pause_state: 'active',
    unread_count: 0,
    deal_stage: i % 4 === 0 ? 'vbros' : null,
    stage: { id: 'knock', title: 'Знакомство', index: 0 },
  }));

let host;
let root;

beforeEach(() => {
  sessionStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

const draw = async (count) => {
  page.mockImplementation(fakeConversationPage(rows(count)));
  await act(async () => root.render(<ConversationsTable />));
};

const pager = () => host.querySelector('nav[aria-label="Страницы диалогов"]');
const buttons = () => [...host.querySelectorAll('nav button')];
const dataRows = () => host.querySelectorAll('tbody tr');

describe('пагинация списка диалогов (страницы считает сервер)', () => {
  it('до пятидесяти строк переключателя нет', async () => {
    await draw(30);
    expect(pager()).toBeNull();
    expect(dataRows().length).toBe(30);
  });

  it('свыше пятидесяти показывается первая страница и переключатель', async () => {
    await draw(120);
    expect(dataRows().length).toBe(50);
    expect(pager()).not.toBeNull();
    expect(host.textContent).toContain('1–50 из 120');
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, size: 50 }));
  });

  it('«Назад» на первой странице недоступна', async () => {
    await draw(120);
    expect(buttons()[0].disabled).toBe(true);
  });

  it('«Вперёд» запрашивает следующую страницу и доводит до последней', async () => {
    await draw(120);
    await act(async () => buttons()[1].click());
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(host.textContent).toContain('51–100 из 120');
    await act(async () => buttons()[1].click());
    expect(host.textContent).toContain('101–120 из 120');
    expect(dataRows().length).toBe(20);
    expect(buttons()[1].disabled).toBe(true);
  });

  it('в заголовке — все чаты, а не размер страницы и не предел выдачи', async () => {
    await draw(1500);
    expect(host.textContent).toContain('ВСЕГО: 1500');
    expect(host.textContent).not.toContain('показаны последние');
  });
});

describe('счётчики — по всем чатам с сервера', () => {
  it('чипы этапа считают весь набор; отбор — «НАЙДЕНО: x из y»', async () => {
    await draw(1500);
    const chips = [...host.querySelectorAll('[data-testid="deal-stage-filters"] button')];
    expect(chips.map((b) => b.textContent)).toEqual(['Вброс · 375', 'Без этапа · 1125']);
    await act(async () => chips[0].click());
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ deal: 'vbros', page: 1 }));
    expect(host.querySelector('[data-testid="dialogs-total"]').textContent).toBe('НАЙДЕНО: 375 из 1500');
  });
});
