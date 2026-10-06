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
const prev = () => pager().querySelector('button[aria-label="Предыдущая страница"]');
const next = () => pager().querySelector('button[aria-label="Следующая страница"]');
const dataRows = () => host.querySelectorAll('tbody tr');

describe('пагинация списка диалогов', () => {
  it('до двадцати пяти строк — одна страница, стрелки выключены', async () => {
    await draw(20);
    expect(pager().querySelectorAll('button[aria-label^="Страница "]')).toHaveLength(1);
    expect(pager().querySelector('[aria-current="page"]').textContent).toBe('1');
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(true);
    expect(host.textContent).toContain('Всего: 20 · 1–20');
    expect(dataRows().length).toBe(20);
  });

  it('свыше двадцати пяти показывается первая страница и переключатель', async () => {
    await draw(120);
    expect(dataRows().length).toBe(25);
    expect(pager()).not.toBeNull();
    expect(host.textContent).toContain('Всего: 120 · 1–25');
  });

  it('«Предыдущая страница» на первой странице недоступна', async () => {
    await draw(120);
    expect(prev().disabled).toBe(true);
  });

  it('«Следующая страница» листает и доводит до последней страницы', async () => {
    await draw(120);
    await act(async () => next().click());
    expect(host.textContent).toContain('Всего: 120 · 26–50');
    for (let i = 0; i < 3; i += 1) {
      await act(async () => next().click());
    }
    expect(host.textContent).toContain('Всего: 120 · 101–120');
    expect(dataRows().length).toBe(20);
    expect(next().disabled).toBe(true);
  });

  it('кнопка с номером открывает свою страницу и помечается текущей', async () => {
    await draw(120);
    await act(async () => pager().querySelector('button[aria-label="Страница 3"]').click());
    expect(host.textContent).toContain('Всего: 120 · 51–75');
    expect(pager().querySelector('[aria-current="page"]').textContent).toBe('3');
  });

  it('размер страницы меняется и возвращает на первую страницу', async () => {
    await draw(120);
    await act(async () => next().click());
    const size = host.querySelector('select[aria-label="Строк на странице"]');
    expect([...size.options].map((o) => o.value)).toEqual(['25', '50', '100']);
    await act(async () => {
      size.value = '50';
      size.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.textContent).toContain('Всего: 120 · 1–50');
    expect(dataRows().length).toBe(50);
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
