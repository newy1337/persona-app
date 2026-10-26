// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// recharts ждёт ResizeObserver; в jsdom его нет.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

import DailyChart, { dayLabel } from './DailyChart';

const day = (d, extra = {}) => ({ day: `2026-10-${String(d).padStart(2, '0')}`, cost_usd: 0, calls: 0, messages_in: 0, messages_out: 0, ...extra });

let host, root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('график по дням', () => {
  it('по умолчанию — сообщения: итог в шапке и легенда входящие/исходящие', async () => {
    await act(async () => root.render(<DailyChart days={[day(20, { messages_in: 5, messages_out: 3, cost_usd: 0.2, calls: 9 }), day(21, { messages_in: 2 })]} />));
    expect(host.querySelector('[data-testid="daily-summary"]').textContent).toBe('Входящие и исходящие · всего 10');
    expect(host.querySelector('[data-testid="daily-legend"]').textContent).toBe('ВходящиеИсходящие');
    expect(host.querySelector('[role="img"]').getAttribute('aria-label')).toBe('По дням: Сообщения');
  });

  it('пустой период — понятная надпись вместо графика', async () => {
    await act(async () => root.render(<DailyChart days={[day(20), day(21)]} />));
    expect(host.textContent).toContain('За период сообщений не было');
    expect(host.querySelector('[data-testid="daily-legend"]')).toBeNull();
  });

  it('подпись дня — «21 окт»', () => {
    expect(dayLabel('2026-10-21')).toBe('21 окт');
    expect(dayLabel('2026-01-01')).toBe('1 янв');
  });
});
