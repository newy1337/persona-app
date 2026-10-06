// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Pager } from './Pager';
import { pageItems } from './pageItems';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('pageItems', () => {
  it('до семи страниц показывает все', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('в начале, середине и конце длинного списка ячеек всегда семь', () => {
    expect(pageItems(1, 20)).toEqual([1, 2, 3, 4, 5, 'gap-end', 20]);
    expect(pageItems(4, 20)).toEqual([1, 2, 3, 4, 5, 'gap-end', 20]);
    expect(pageItems(5, 20)).toEqual([1, 'gap-start', 4, 5, 6, 'gap-end', 20]);
    expect(pageItems(16, 20)).toEqual([1, 'gap-start', 15, 16, 17, 'gap-end', 20]);
    expect(pageItems(17, 20)).toEqual([1, 'gap-start', 16, 17, 18, 19, 20]);
    expect(pageItems(20, 20)).toEqual([1, 'gap-start', 16, 17, 18, 19, 20]);
    for (let page = 1; page <= 20; page += 1) expect(pageItems(page, 20)).toHaveLength(7);
  });
});

describe('Pager', () => {
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

  const draw = (props) => act(() => root.render(<Pager pageSize={25} onPage={() => {}} {...props} />));
  const button = (name) => host.querySelector(`button[aria-label="${name}"]`);

  it('одна страница: только диапазон, переключателя нет', () => {
    draw({ page: 1, total: 12 });
    expect(host.textContent).toContain('1–12 из 12');
    expect(host.querySelector('nav')).toBeNull();
  });

  it('пустой список не пишет «0–0 из 0»', () => {
    draw({ page: 1, total: 0 });
    expect(host.textContent).toContain('Нет записей');
  });

  it('первая страница: «назад» недоступна, текущая помечена', () => {
    draw({ page: 1, total: 120 });
    expect(host.textContent).toContain('1–25 из 120');
    expect(button('Предыдущая страница').disabled).toBe(true);
    expect(button('Следующая страница').disabled).toBe(false);
    expect(button('Страница 1').getAttribute('aria-current')).toBe('page');
    expect(button('Страница 2').getAttribute('aria-current')).toBeNull();
  });

  it('клики по номеру и стрелкам сообщают нужную страницу', () => {
    const onPage = vi.fn();
    draw({ page: 2, total: 120, onPage });
    act(() => button('Страница 4').click());
    act(() => button('Следующая страница').click());
    act(() => button('Предыдущая страница').click());
    expect(onPage.mock.calls.map(([n]) => n)).toEqual([4, 3, 1]);
  });

  it('страница за пределами списка прижимается к последней', () => {
    draw({ page: 9, total: 60 });
    expect(host.textContent).toContain('51–60 из 60');
    expect(button('Следующая страница').disabled).toBe(true);
  });

  it('размер страницы показывается, только если его можно менять', () => {
    draw({ page: 1, total: 120 });
    expect(host.querySelector('select')).toBeNull();
    draw({ page: 1, total: 120, pageSizes: [25, 50, 100], onPageSize: vi.fn() });
    const select = host.querySelector('select[aria-label="Строк на странице"]');
    expect([...select.options].map((o) => o.textContent)).toEqual(['по 25', 'по 50', 'по 100']);
  });
});
