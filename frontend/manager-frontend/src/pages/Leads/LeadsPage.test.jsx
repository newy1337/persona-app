// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), Link: () => null, NavLink: () => null }));
const getLeads = vi.fn();
vi.mock('../../api/leads', () => ({
  getLeads: (...a) => getLeads(...a),
  getOutreachStatus: async () => null,
  getLeadPersonas: async () => ({ items: [] }),
  startOutreach: vi.fn(), stopOutreach: vi.fn(), updateLead: vi.fn(), deleteLead: vi.fn(),
  createLead: vi.fn(), importLeads: vi.fn(), writeFromAnother: vi.fn(),
}));
vi.mock('../../api/accounts', () => ({ getAccounts: async () => [] }));
const { default: Leads } = await import('./Leads');

const lead = (id) => ({ id, status: 'replied', first_name: `Лид ${id}`, telegram_user_id: 9000 + id, channel: 'telegram' });

beforeEach(() => {
  getLeads.mockReset();
  getLeads.mockImplementation(async ({ page = 1 }) => ({
    items: page === 1 ? [lead(3), lead(2)] : [lead(1)],
    total: 3, page, pages: 2, size: 2,
    counts: { total: 3, replied: 3, pending: 0 },
    stages: { lead: 2, none: 1 },
    pending_all: 7,
    chat_ids: [9003, 9002, 9001],
  }));
});

async function render() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => createRoot(host).render(React.createElement(Leads)));
  return host;
}

describe('страница лидов: страницы, поиск и выгрузка на сервере', () => {
  it('счётчики этапов и итог — из ответа сервера, прозвон — по всем ожидающим', async () => {
    const host = await render();
    expect(host.querySelector('[data-testid="lead-stage-filters"]').textContent).toContain('Лид 2');
    expect(host.textContent).toContain('Найдено: 3');
    expect(host.textContent).toContain('Запустить прозвон (7)');
    expect(host.querySelector('[data-testid="export-dialogs"]').textContent).toBe('Выгрузить 3 диалога');
  });

  it('«Вперёд» запрашивает следующую страницу', async () => {
    const host = await render();
    const next = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Вперёд');
    await act(async () => next.click());
    expect(getLeads).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, size: 100 }));
    expect(host.textContent).toContain('Лид 1');
  });

  it('этап и поиск уходят на сервер и сбрасывают на первую страницу', async () => {
    vi.useFakeTimers();
    try {
      const host = await render();
      const stage = [...host.querySelectorAll('[data-testid="lead-stage-filters"] button')].find((b) => b.textContent.startsWith('Лид'));
      await act(async () => stage.click());
      expect(getLeads).toHaveBeenLastCalledWith(expect.objectContaining({ deal_stage: 'lead', page: 1 }));
      const input = host.querySelector('input[placeholder^="поиск"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      await act(async () => {
        setter.call(input, '900');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => vi.advanceTimersByTime(400));
      expect(getLeads).toHaveBeenLastCalledWith(expect.objectContaining({ q: '900', deal_stage: 'lead', page: 1 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('период: по умолчанию всё время; выбранный уходит на сервер, «Всё время» сбрасывает', async () => {
    const host = await render();
    const button = host.querySelector('[data-testid="leads-range"] [data-testid="range-button"]');
    expect(button.textContent).toContain('Всё время');
    expect(getLeads).toHaveBeenLastCalledWith(expect.objectContaining({ from: null, to: null }));
    await act(async () => button.click());
    const preset = (label) => [...host.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === label);
    await act(async () => preset('Сегодня').click());
    const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    expect(getLeads).toHaveBeenLastCalledWith(expect.objectContaining({ from: today, to: today, page: 1 }));
    await act(async () => button.click());
    await act(async () => preset('Всё время').click());
    expect(getLeads).toHaveBeenLastCalledWith(expect.objectContaining({ from: null, to: null }));
  });

  it('выбрали лидов — выгружаются только их диалоги', async () => {
    const host = await render();
    const box = host.querySelector('input[aria-label="Выбрать лид: Лид 3"]');
    await act(async () => box.click());
    expect(host.querySelector('[data-testid="export-dialogs"]').textContent).toBe('Выгрузить 1 диалог');
  });
});
