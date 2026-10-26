// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import Stats from './Stats';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tokens = { input: 1000, output: 500, cache_read: 9000, cache_write: 0 };
const usage = {
  range: { first_day: '2026-08-01' },
  totals: {
    cost_usd: 12.5, paid_usd: 9.75, gateway_saved_usd: 2.75, gateway_calls: 90, calls: 400, messages_in: 120, messages_out: 150, chats: 14,
    cache_hit_rate: 0.9, manual_share: 0.2, avg_latency_ms: 2100, tokens,
  },
  by_day: [{ day: '2026-10-05', cost_usd: 12.5, calls: 400, messages_in: 120, messages_out: 150 }],
  by_stage: [{ stage: 'generator', cost_usd: 10, calls: 300 }, { stage: 'judge_plan', cost_usd: 2.5, calls: 100 }],
  by_persona: [{ persona_id: 'nastya', cost_usd: 12.5, calls: 400 }],
  by_model: [{ model: 'vendor/model-a', priced: false, calls: 400, cost_usd: 12.5, avg_latency_ms: 2100, tokens }],
  top_chats: [{ chat_id: 4242, calls: 40, cost_usd: 3.25, tokens }],
  prices: { is_default: false },
  unpriced_models: [],
};
const prices = {
  is_default: false,
  note: '',
  families: {},
  models: { 'vendor/model-a': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 } },
};

let host;
let root;
let get;

const flush = () => act(async () => { await Promise.resolve(); });
const buttonByText = (scope, text) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const typeInto = (el, value) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  get = vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (path.startsWith('/api/stats/balance')) return { left: 249.15, today: 1, week: 2, month: 3, days_left: 12, error: null };
    if (path.startsWith('/api/stats/prices')) return prices;
    if (path.startsWith('/api/stats/managers')) return { by_manager: [], by_team: [{ manager_id: 9, username: 'boss', role: 'head', region_code: '0101', members: 3, cost_usd: 1, calls: 1, days: [], tokens }] };
    if (path.startsWith('/api/stats/cold')) return { active_after: 5, totals: { received: 2, written: 1, replied: 0, active: 0 }, by_manager: [] };
    if (path.startsWith('/api/stats/stages')) return { stages: [], days: [], totals: {}, reached: {} };
    return usage;
  });
  await act(async () => root.render(<MemoryRouter><Stats /></MemoryRouter>));
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('страница статистики', () => {
  it('«Куда уходят деньги»: список полосок по умолчанию, «Диаграмма» — кольцо; выбор запоминается', async () => {
    localStorage.removeItem('stats_spend_view');
    const list = host.querySelector('[data-testid="bar-list"]');
    expect([...list.querySelectorAll('li')].map((li) => li.dataset.key)).toEqual(['generator', 'judge_plan']);
    expect(list.textContent).toContain('Ответ');
    expect(list.textContent).toContain('80%');
    await act(async () => buttonByText(host.querySelector('[data-testid="spend-view"]'), 'Диаграмма').click());
    expect(host.querySelector('[data-testid="bar-list"]')).toBeNull();
    const donut = host.querySelector('[data-testid="donut"]');
    expect(donut.textContent).toContain('$12.50');
    expect([...donut.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Ответ$10.0080%', 'Судья: разбор$2.5020%']);
    expect(localStorage.getItem('stats_spend_view')).toBe('chart');
    await act(async () => buttonByText(host.querySelector('[data-testid="spend-view"]'), 'Список').click());
    expect(host.querySelector('[data-testid="bar-list"]')).not.toBeNull();
    localStorage.removeItem('stats_spend_view');
  });

  it('шапка страницы одна, показатели стоят одной полосой', () => {
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.querySelector('h1').textContent).toBe('Статистика');
    for (const title of ['Расход', 'LLMR', 'За ход клиента', 'Из кеша', 'Токенов', 'Сообщений', 'Чатов']) {
      expect(host.textContent).toContain(title);
    }
    // Расход — факт OpenRouter (paid_usd), а не расчётная стоимость; LLMR — экономия шлюза и число вызовов.
    expect(host.textContent).toContain('$9.75');
    expect(host.textContent).toContain('$2.75');
    expect(host.textContent).toContain('90 вызовов');
    expect(host.textContent).toContain('120 ↓ / 150 ↑');
  });

  it('модель без цены помечена, диалог открывается кнопкой-иконкой', () => {
    expect(host.textContent).toContain('без цены');
    const open = host.querySelector('button[aria-label="Открыть"]');
    expect(open).not.toBeNull();
    expect(open.closest('tr').textContent).toContain('4242');
  });

  it('цены не запрашиваются, пока окно закрыто', () => {
    expect(get.mock.calls.some(([path]) => path === '/api/stats/prices')).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('«Цены моделей» открывает окно: правка включает сохранение и уходит одним запросом', async () => {
    const put = vi.spyOn(api, 'put').mockImplementation(async (_path, table) => ({ ...prices, models: table.models }));
    await act(async () => buttonByText(host, 'Цены моделей').click());
    await flush();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('vendor/model-a');
    const save = buttonByText(dialog, 'Сохранить цены');
    expect(save.disabled).toBe(true);

    await typeInto(dialog.querySelector('input[aria-label="vendor/model-a: вход"]'), '4');
    expect(save.disabled).toBe(false);
    const loadsBefore = get.mock.calls.filter(([path]) => path.startsWith('/api/stats?')).length;
    await act(async () => save.click());
    await flush();

    expect(put).toHaveBeenCalledWith('/api/stats/prices', {
      models: { 'vendor/model-a': { input: '4', output: 15, cache_write: 3.75, cache_read: 0.3 } },
      families: {},
      note: '',
    });
    // После сохранения страница пересчитывает расход по новым ценам.
    expect(get.mock.calls.filter(([path]) => path.startsWith('/api/stats?')).length).toBe(loadsBefore + 1);
    expect(buttonByText(dialog, 'Сохранить цены').disabled).toBe(true);
  });

  it('ошибка сохранения цен остаётся в окне', async () => {
    vi.spyOn(api, 'put').mockRejectedValue({ detail: 'цена должна быть числом' });
    await act(async () => buttonByText(host, 'Цены моделей').click());
    await flush();
    const dialog = document.querySelector('[role="dialog"]');
    await typeInto(dialog.querySelector('input[aria-label="vendor/model-a: выход"]'), 'x');
    await act(async () => buttonByText(dialog, 'Сохранить цены').click());
    await flush();
    expect(dialog.textContent).toContain('цена должна быть числом');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('«Отмена» закрывает окно цен', async () => {
    await act(async () => buttonByText(host, 'Цены моделей').click());
    await flush();
    await act(async () => buttonByText(document.querySelector('[role="dialog"]'), 'Отмена').click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('вкладки «По командам» и «Холодка» (как в рабочей панели)', () => {
  const open = (id) =>
    act(async () => {
      const tab = host.querySelector(`[data-testid="stats-tab-${id}"]`);
      tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

  it('«По командам» берёт by_team из того же запроса и показывает состав команды', async () => {
    await open('teams');
    await flush();
    expect(get.mock.calls.some(([path]) => path.startsWith('/api/stats/managers'))).toBe(true);
    expect(host.textContent).toContain('По командам');
    expect(host.querySelector('[data-testid="team-meta-9"]').textContent).toBe('хед · регион 0101 · команда: 3 чел.');
  });

  it('«Холодка» запрашивает свою статистику и показывает итог', async () => {
    await open('cold');
    await flush();
    expect(get.mock.calls.some(([path]) => path.startsWith('/api/stats/cold'))).toBe(true);
    expect(host.querySelector('[data-testid="cold-kpis"]').textContent).toContain('Получено лидов2');
  });
});
