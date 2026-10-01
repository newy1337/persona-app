// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import ConversationsTable from './ConversationsTable';

const now = Math.floor(Date.now() / 1000);
const rows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    chat_id: 1000 + i,
    id: 1000 + i,
    name: `Клиент ${i}`,
    last_message_ts: now - i * 60,
    pause_state: 'active',
    unread_count: 0,
    stage: { id: 'knock', title: 'Знакомство', index: 0 },
  }));

let host;
let root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const draw = async (count) =>
  act(async () => root.render(<ConversationsTable rows={rows(count)} />));

const pager = () => host.querySelector('nav[aria-label="Страницы диалогов"]');
const buttons = () => [...host.querySelectorAll('nav button')];
const dataRows = () => host.querySelectorAll('tbody tr');

describe('пагинация списка диалогов', () => {
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
  });

  it('«Назад» на первой странице недоступна', async () => {
    await draw(120);
    expect(buttons()[0].disabled).toBe(true);
  });

  it('«Вперёд» листает и доводит до последней страницы', async () => {
    await draw(120);
    await act(async () => buttons()[1].click());
    expect(host.textContent).toContain('51–100 из 120');
    await act(async () => buttons()[1].click());
    expect(host.textContent).toContain('101–120 из 120');
    expect(dataRows().length).toBe(20);
    expect(buttons()[1].disabled).toBe(true);
  });

  it('в заголовке остаётся общее число, а не размер страницы', async () => {
    await draw(120);
    expect(host.textContent).toContain('ВСЕГО: 120');
  });
});

describe('честный счётчик', () => {
  it('когда список урезан, в заголовке видно и общее число, и срез', async () => {
    const list = rows(120);
    list.total = 378;
    await act(async () => root.render(<ConversationsTable rows={list} />));
    expect(host.textContent).toContain('ВСЕГО: 378');
    expect(host.textContent).toContain('показаны последние 120');
  });

  it('без урезания лишнего не пишем', async () => {
    await draw(30);
    expect(host.textContent).toContain('ВСЕГО: 30');
    expect(host.textContent).not.toContain('показаны последние');
  });
});
