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
  const status = () => host.querySelector('[role="status"]');
  const jump = () => host.querySelector('input[aria-label="Перейти к странице"]');
  const cells = () => [...host.querySelector('nav').children].slice(1, -1);
  const type = (text) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(jump(), text);
    jump().dispatchEvent(new Event('input', { bubbles: true }));
  });
  const enter = () => act(() => {
    jump().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  const blur = () => act(() => {
    jump().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });

  it('одна страница: «‹ 1 ›» с выключенными стрелками', () => {
    draw({ page: 1, total: 12, label: 'Страницы лидов' });
    const nav = host.querySelector('nav[aria-label="Страницы лидов"]');
    expect([...nav.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')))
      .toEqual(['Предыдущая страница', 'Страница 1', 'Следующая страница']);
    expect(button('Страница 1').getAttribute('aria-current')).toBe('page');
    expect(button('Предыдущая страница').disabled).toBe(true);
    expect(button('Следующая страница').disabled).toBe(true);
    expect(jump()).toBeNull();
  });

  it('слева общее число и диапазон', () => {
    draw({ page: 2, total: 312 });
    expect(status().textContent).toBe('Всего: 312 · 26–50');
  });

  it('пустой список: «Всего: 0» без диапазона, страница одна', () => {
    draw({ page: 1, total: 0 });
    expect(status().textContent).toBe('Всего: 0');
    expect(button('Страница 1').getAttribute('aria-current')).toBe('page');
    expect(button('Следующая страница').disabled).toBe(true);
  });

  it('первая страница: «назад» недоступна, текущая помечена', () => {
    draw({ page: 1, total: 120 });
    expect(host.textContent).toContain('Всего: 120 · 1–25');
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
    expect(host.textContent).toContain('Всего: 60 · 51–60');
    expect(button('Следующая страница').disabled).toBe(true);
  });

  it('размер страницы показывается, только если его можно менять', () => {
    draw({ page: 1, total: 120 });
    expect(host.querySelector('select')).toBeNull();
    draw({ page: 1, total: 120, pageSizes: [25, 50, 100], onPageSize: vi.fn() });
    const select = host.querySelector('select[aria-label="Строк на странице"]');
    expect([...select.options].map((o) => o.textContent)).toEqual(['по 25', 'по 50', 'по 100']);
  });

  it('много страниц: семь ячеек на любой странице, пропуски не кнопки', () => {
    for (const page of [1, 4, 5, 10, 16, 17, 20]) {
      draw({ page, total: 500 });
      expect(cells()).toHaveLength(7);
      expect(host.querySelectorAll('nav [aria-current="page"]')).toHaveLength(1);
    }
    draw({ page: 10, total: 500 });
    expect(cells().map((c) => (c.tagName === 'BUTTON' ? c.textContent : '…')))
      .toEqual(['1', '…', '9', '10', '11', '…', '20']);
  });

  it('поле перехода есть только когда страниц больше семи', () => {
    draw({ page: 1, total: 175 });
    expect(jump()).toBeNull();
    draw({ page: 3, total: 176 });
    expect(jump().value).toBe('3');
    expect(jump().parentElement.textContent).toContain('из 8');
  });

  it('Enter в поле перехода открывает набранную страницу', () => {
    const onPage = vi.fn();
    draw({ page: 1, total: 500, onPage });
    type('12');
    expect(onPage).not.toHaveBeenCalled();
    enter();
    expect(onPage.mock.calls).toEqual([[12]]);
  });

  it('уход из поля с изменённым значением тоже переходит, с прежним — нет', () => {
    const onPage = vi.fn();
    draw({ page: 1, total: 500, onPage });
    blur();
    type('1');
    blur();
    expect(onPage).not.toHaveBeenCalled();
    type('7');
    blur();
    expect(onPage.mock.calls).toEqual([[7]]);
  });

  it('число за пределами прижимается к 1…pages', () => {
    const onPage = vi.fn();
    draw({ page: 5, total: 500, onPage });
    type('999');
    enter();
    type('0');
    enter();
    expect(onPage.mock.calls).toEqual([[20], [1]]);
    expect(jump().value).toBe('5');
  });

  it('не-число игнорируется, поле возвращается к текущей странице', () => {
    const onPage = vi.fn();
    draw({ page: 5, total: 500, onPage });
    for (const text of ['abc', '', '2.5', '-3', '1e1']) {
      type(text);
      expect(jump().value).toBe(text);
      enter();
      expect(jump().value).toBe('5');
    }
    expect(onPage).not.toHaveBeenCalled();
  });

  it('поле следует за страницей, пришедшей снаружи', () => {
    draw({ page: 5, total: 500 });
    draw({ page: 6, total: 500 });
    expect(jump().value).toBe('6');
  });
});
