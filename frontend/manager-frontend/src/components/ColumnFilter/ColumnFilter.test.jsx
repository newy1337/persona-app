// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ColumnFilter } from './ColumnFilter';
import { FilterChips } from './FilterChips';
import { applyFilters, describe as describeFilter, inPeriod, isActive, matches, optionsFrom } from './filters';
import { useColumnFilters } from './useColumnFilters';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROWS = [
  { id: 1, name: 'Настя', city: 'Томск', stage: 'first', lead: 'bot', manager: '', ts: 0 },
  { id: 2, name: 'Оля', city: 'Туапсе', stage: 'warm', lead: 'manager', manager: 'olga', ts: 0 },
  { id: 3, name: 'Василий', city: 'Питер', stage: 'first', lead: 'manager', manager: '', ts: 0 },
];
const DEFS = {
  who: { type: 'text', get: (r) => [r.name, r.city] },
  stage: {
    type: 'options',
    get: (r) => r.stage,
    options: [
      { value: 'first', label: 'первое касание', count: 2 },
      { value: 'warm', label: 'разговорились', count: 1 },
    ],
  },
  lead: { type: 'options', get: (r) => r.lead, options: [{ value: 'bot', label: 'Бот' }, { value: 'manager', label: 'Менеджер' }] },
  last: { type: 'period', get: (r) => r.ts },
};
const ids = (rows) => rows.map((r) => r.id);

describe('логика фильтров', () => {
  it('пустые значения фильтром не считаются', () => {
    expect(isActive([])).toBe(false);
    expect(isActive('  ')).toBe(false);
    expect(isActive(null)).toBe(false);
    expect(isActive(['a'])).toBe(true);
    expect(isActive('7d')).toBe(true);
  });

  it('список: строка подходит, если её значение среди выбранных', () => {
    expect(ids(applyFilters(ROWS, DEFS, { stage: ['first'] }))).toEqual([1, 3]);
    expect(ids(applyFilters(ROWS, DEFS, { stage: ['first', 'warm'] }))).toEqual([1, 2, 3]);
  });

  it('текст: «содержит» без учёта регистра по любому из полей колонки', () => {
    expect(ids(applyFilters(ROWS, DEFS, { who: 'туа' }))).toEqual([2]);
    expect(ids(applyFilters(ROWS, DEFS, { who: 'НАС' }))).toEqual([1]);
  });

  it('фильтры разных колонок складываются через «и», чужие ключи не мешают', () => {
    expect(ids(applyFilters(ROWS, DEFS, { stage: ['first'], lead: ['manager'], unknown: ['x'] }))).toEqual([3]);
    expect(applyFilters(ROWS, DEFS, {})).toBe(ROWS);
  });

  it('период считается по московским суткам', () => {
    const now = Date.parse('2026-10-07T12:00:00+03:00');
    const at = (iso) => Date.parse(iso) / 1000;
    expect(inPeriod(at('2026-10-07T00:10:00+03:00'), 'today', now)).toBe(true);
    expect(inPeriod(at('2026-10-06T23:50:00+03:00'), 'today', now)).toBe(false);
    expect(inPeriod(at('2026-10-06T23:50:00+03:00'), 'yesterday', now)).toBe(true);
    expect(inPeriod(at('2026-10-01T12:00:00+03:00'), '7d', now)).toBe(true);
    expect(inPeriod(at('2026-09-20T12:00:00+03:00'), '7d', now)).toBe(false);
    expect(inPeriod(at('2026-09-20T12:00:00+03:00'), '30d', now)).toBe(true);
    expect(inPeriod(0, 'today', now)).toBe(false);
    expect(matches(DEFS.last, '', { ts: 0 }, now)).toBe(true);
  });

  it('варианты из строк: подписи, счётчики, пустое значение в конце', () => {
    const options = optionsFrom(ROWS, (r) => r.manager, { empty: 'не назначен' });
    expect(options).toEqual([
      { value: 'olga', label: 'olga', count: 1 },
      { value: '', label: 'не назначен', count: 2 },
    ]);
  });

  it('описание для плашки', () => {
    expect(describeFilter(DEFS.stage, ['first', 'warm'])).toBe('первое касание, разговорились');
    expect(describeFilter(DEFS.who, ' том ')).toBe('«том»');
    expect(describeFilter(DEFS.last, '7d')).toBe('За 7 дней');
    expect(describeFilter(DEFS.stage, [])).toBe('');
  });
});

describe('компоненты', () => {
  let host;
  let root;

  beforeEach(() => {
    window.sessionStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const trigger = (label) => host.querySelector(`button[aria-label="Фильтр: ${label}"]`);
  const popover = () => document.querySelector('[data-slot="popover-content"]');

  function Harness({ col, label, onState }) {
    const [state, setFilter, reset] = useColumnFilters('test');
    onState?.(state);
    return (
      <>
        <ColumnFilter label={label} def={DEFS[col]} value={state[col]} onChange={(v) => setFilter(col, v)} />
        <FilterChips
          columns={[{ key: col, label, filter: DEFS[col] }, { key: 'lead', label: 'Ведёт', filter: DEFS.lead }]}
          state={state}
          onChange={setFilter}
          onReset={reset}
        />
      </>
    );
  }

  it('список: галочки сразу меняют значение, воронка отмечена, «Сбросить» очищает', async () => {
    let last;
    await act(async () => root.render(<Harness col="stage" label="Стадия" onState={(s) => { last = s; }} />));
    expect(trigger('Стадия').hasAttribute('data-active')).toBe(false);
    await act(async () => trigger('Стадия').click());
    const boxes = () => [...popover().querySelectorAll('[role="checkbox"]')];
    expect(popover().textContent).toContain('первое касание');
    await act(async () => boxes()[0].click());
    expect(last).toEqual({ stage: ['first'] });
    expect(trigger('Стадия').hasAttribute('data-active')).toBe(true);
    await act(async () => boxes()[1].click());
    expect(last).toEqual({ stage: ['first', 'warm'] });
    await act(async () => boxes()[0].click());
    expect(last).toEqual({ stage: ['warm'] });
    const reset = [...popover().querySelectorAll('button')].find((b) => b.textContent === 'Сбросить');
    await act(async () => reset.click());
    expect(last).toEqual({});
    expect(reset.disabled).toBe(true);
  });

  it('плашка показывает заданный фильтр и снимает его крестиком', async () => {
    window.sessionStorage.setItem('panel_filters_test', JSON.stringify({ stage: ['first'], lead: ['bot'] }));
    let last;
    await act(async () => root.render(<Harness col="stage" label="Стадия" onState={(s) => { last = s; }} />));
    const chips = host.querySelector('[aria-label="Заданные фильтры"]');
    expect(chips.textContent).toContain('Стадия: первое касание');
    expect(chips.textContent).toContain('Ведёт: Бот');
    await act(async () => host.querySelector('button[aria-label="Убрать фильтр: Стадия"]').click());
    expect(last).toEqual({ lead: ['bot'] });
    expect(JSON.parse(window.sessionStorage.getItem('panel_filters_test'))).toEqual({ lead: ['bot'] });
  });

  it('«Сбросить все» появляется от двух фильтров и очищает всё', async () => {
    window.sessionStorage.setItem('panel_filters_test', JSON.stringify({ stage: ['first'], lead: ['bot'] }));
    let last;
    await act(async () => root.render(<Harness col="stage" label="Стадия" onState={(s) => { last = s; }} />));
    const all = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Сбросить все');
    await act(async () => all.click());
    expect(last).toEqual({});
    expect(host.querySelector('[aria-label="Заданные фильтры"]')).toBeNull();
  });

  it('период: один выбранный вариант, повторный клик снимает', async () => {
    let last;
    await act(async () => root.render(<Harness col="last" label="Последнее" onState={(s) => { last = s; }} />));
    await act(async () => trigger('Последнее').click());
    const option = (text) => [...popover().querySelectorAll('button[aria-pressed]')].find((b) => b.textContent === text);
    await act(async () => option('За 7 дней').click());
    expect(last).toEqual({ last: '7d' });
    expect(option('За 7 дней').getAttribute('aria-pressed')).toBe('true');
    await act(async () => option('За 7 дней').click());
    expect(last).toEqual({});
  });

  it('текст: поле «содержит» меняет значение по мере ввода', async () => {
    const onChange = vi.fn();
    function Text() {
      const [value, setValue] = useState('');
      return <ColumnFilter label="Собеседник" def={DEFS.who} value={value} onChange={(v) => { setValue(v); onChange(v); }} />;
    }
    await act(async () => root.render(<Text />));
    await act(async () => trigger('Собеседник').click());
    const input = popover().querySelector('input[aria-label="Собеседник: содержит"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    await act(async () => {
      setter.call(input, 'том');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith('том');
    expect(trigger('Собеседник').hasAttribute('data-active')).toBe(true);
  });

  it('сломанное хранилище не мешает: список начинается без фильтров', async () => {
    window.sessionStorage.setItem('panel_filters_test', '{oops');
    let last;
    await act(async () => root.render(<Harness col="stage" label="Стадия" onState={(s) => { last = s; }} />));
    expect(last).toEqual({});
  });
});
