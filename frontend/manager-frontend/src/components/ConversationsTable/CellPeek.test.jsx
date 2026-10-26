// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import ConversationsTable from './ConversationsTable';

const now = Math.floor(Date.now() / 1000);
const ROWS = [
  { chat_id: 1, name: 'Константин', city: 'Нижний Новгород', age: 43, last_message_ts: now, unread_count: 0, stage: { id: 'knock', title: 'Знакомство', index: 0 } },
];

// jsdom не считает раскладку: «обрезан» ли текст, задаём размерами вручную.
let clipped = true;
const sizes = {
  scrollWidth: { get() { return clipped && this.classList?.contains('truncate') ? 200 : 0; } },
  clientWidth: { get() { return clipped && this.classList?.contains('truncate') ? 100 : 0; } },
};

let host, root;
beforeEach(() => {
  Object.defineProperties(HTMLElement.prototype, Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, { ...v, configurable: true }])));
  navigate.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete HTMLElement.prototype.scrollWidth;
  delete HTMLElement.prototype.clientWidth;
});

const nameText = () => [...host.querySelectorAll('tbody td:first-child .truncate')].pop();
const peek = () => document.querySelector('[data-cell-peek]');

describe('раскрытие обрезанной ячейки', () => {
  it('щелчок по обрезанному тексту раскрывает ячейку и не открывает чат; Escape закрывает', async () => {
    clipped = true;
    await act(async () => root.render(<ConversationsTable rows={ROWS} />));
    await act(async () => nameText().click());
    expect(peek().textContent).toContain('43 лет · Нижний Новгород');
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(peek()).toBeNull();
  });

  it('повторный щелчок по плашке закрывает её, а не открывает чат', async () => {
    clipped = true;
    await act(async () => root.render(<ConversationsTable rows={ROWS} />));
    await act(async () => nameText().click());
    await act(async () => peek().click());
    expect(peek()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('текст виден целиком — щелчок открывает чат, как раньше', async () => {
    clipped = false;
    await act(async () => root.render(<ConversationsTable rows={ROWS} />));
    await act(async () => nameText().click());
    expect(peek()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/conversation/1');
  });
});
