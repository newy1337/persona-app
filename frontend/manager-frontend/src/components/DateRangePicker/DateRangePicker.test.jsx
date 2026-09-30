// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

const { default: DateRangePicker, addDays, monthEnd, monthGrid, presets, weekStart } = await import('./DateRangePicker');

function render(props) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => createRoot(host).render(React.createElement(DateRangePicker, props)));
  return host;
}

const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const byTitle = (host, title) => host.querySelector(`[title="${title}"]`);
const byText = (host, text) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);
const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

describe('дни периода', () => {
  it('конец месяца знает про декабрь и февраль', () => {
    expect(monthEnd('2026-09-10')).toBe('2026-09-30');
    expect(monthEnd('2026-12-05')).toBe('2026-12-31');
    expect(monthEnd('2026-02-14')).toBe('2026-02-28');
    expect(monthEnd('2028-02-01')).toBe('2028-02-29');
  });

  it('неделя начинается с понедельника', () => {
    expect(weekStart('2026-09-22')).toBe('2026-09-21');
    expect(weekStart('2026-09-21')).toBe('2026-09-21');
    expect(weekStart('2026-09-20')).toBe('2026-09-14');
  });

  it('сетка месяца — целые недели, первый день на своём месте', () => {
    const cells = monthGrid('2026-09-10');
    expect(cells.length % 7).toBe(0);
    expect(cells.filter(Boolean)).toHaveLength(30);
    expect(cells.indexOf('2026-09-01')).toBe(1);
  });

  it('пресеты считают периоды от сегодняшнего дня', () => {
    const map = Object.fromEntries(presets('2026-09-22', '2026-08-01').map((p) => [p.key, `${p.from}..${p.to}`]));
    expect(map.today).toBe('2026-09-22..2026-09-22');
    expect(map.yesterday).toBe('2026-09-21..2026-09-21');
    expect(map['7d']).toBe('2026-09-16..2026-09-22');
    expect(map.month).toBe('2026-09-01..2026-09-22');
    expect(map.prev_month).toBe('2026-08-01..2026-08-31');
    expect(map.all).toBe('2026-08-01..2026-09-22');
  });

  it('«Всё время» появляется только когда известен первый день', () => {
    expect(presets('2026-09-22', null).some((p) => p.key === 'all')).toBe(false);
  });
});

describe('DateRangePicker', () => {
  it('кнопка показывает название пресета, а произвольный период — датами', () => {
    expect(render({ from: today, to: today, onChange: vi.fn() }).textContent).toContain('Сегодня');
    const host = render({ from: '2026-01-05', to: '2026-01-09', onChange: vi.fn() });
    expect(host.textContent).toContain('05.01.2026 — 09.01.2026');
  });

  it('пресет отдаёт период и закрывает панель', () => {
    const onChange = vi.fn();
    const host = render({ from: '2026-01-05', to: '2026-01-09', onChange });
    click(host.querySelector('[data-testid="range-button"]'));
    click(byText(host, 'Вчера'));

    const yesterday = addDays(today, -1);
    expect(onChange).toHaveBeenCalledWith({ from: yesterday, to: yesterday });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('два клика по календарю задают период', () => {
    const onChange = vi.fn();
    const host = render({ from: '2026-01-05', to: '2026-01-09', onChange });
    click(host.querySelector('[data-testid="range-button"]'));
    click(byTitle(host, '03.01.2026'));
    expect(onChange).not.toHaveBeenCalled();

    click(byTitle(host, '11.01.2026'));
    expect(onChange).toHaveBeenCalledWith({ from: '2026-01-03', to: '2026-01-11' });
  });

  it('клик раньше начала начинает выбор заново', () => {
    const onChange = vi.fn();
    const host = render({ from: '2026-01-05', to: '2026-01-09', onChange });
    click(host.querySelector('[data-testid="range-button"]'));
    click(byTitle(host, '11.01.2026'));
    click(byTitle(host, '03.01.2026'));
    expect(onChange).not.toHaveBeenCalled();

    click(byTitle(host, '07.01.2026'));
    expect(onChange).toHaveBeenCalledWith({ from: '2026-01-03', to: '2026-01-07' });
  });

  it('будущие дни выбрать нельзя', () => {
    const host = render({ from: today, to: today, onChange: vi.fn() });
    click(host.querySelector('[data-testid="range-button"]'));
    const tomorrow = addDays(today, 1).split('-').reverse().join('.');
    const cell = byTitle(host, tomorrow);
    if (cell) expect(cell.disabled).toBe(true);
  });
});
