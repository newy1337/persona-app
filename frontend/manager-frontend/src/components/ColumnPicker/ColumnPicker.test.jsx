// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColumnPicker } from './ColumnPicker';
import { tableMinWidth, useColumnPrefs } from './columnPrefs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Меню Radix ждёт ResizeObserver, которого нет в jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

const COLUMNS = [
  { key: 'name', label: 'Имя', required: true },
  { key: 'phone', label: 'Телефон', width: 100 },
  { key: 'site', label: 'Сайт', width: 80, show: 'wide' },
  { key: 'note', label: 'Заметка', width: 60, show: false },
  { key: 'actions', label: 'Действия', width: 40, required: true },
];
const KEY = 'panel_columns_demo';

function Demo({ id = 'demo' }) {
  const prefs = useColumnPrefs(id, COLUMNS, { wide: '(min-width: 1000px)' });
  return (
    <div>
      <p data-testid="visible">{prefs.columns.map((col) => col.key).join(',')}</p>
      <p data-testid="min">{tableMinWidth(prefs.columns, 200)}</p>
      <ColumnPicker prefs={prefs} />
    </div>
  );
}

let host;
let root;
const realMatchMedia = window.matchMedia;
const setWide = (matches) => {
  window.matchMedia = () => ({ matches, addEventListener() {}, removeEventListener() {} });
};

beforeEach(() => {
  localStorage.clear();
  setWide(false);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

const draw = (props) => act(async () => root.render(<Demo {...props} />));
const visible = () => host.querySelector('[data-testid="visible"]').textContent;
const stored = () => JSON.parse(localStorage.getItem(KEY));
const trigger = () => host.querySelector('button[aria-label="Настроить поля"]');
const open = () =>
  act(async () => trigger().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })));
const boxes = () => [...document.querySelectorAll('[role="menuitemcheckbox"]')];
const box = (label) => boxes().find((item) => item.textContent === label);
const reset = () => [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === 'Сбросить');
const click = (el) => act(async () => el.click());

describe('настройка полей таблицы', () => {
  it('по умолчанию: обязательные и обычные колонки, «широкая» — только на широком экране', async () => {
    await draw();
    expect(visible()).toBe('name,phone,actions');
    act(() => root.unmount());
    setWide(true);
    root = createRoot(host);
    await draw();
    expect(visible()).toBe('name,phone,site,actions');
  });

  it('в меню только скрываемые колонки, галочка повторяет то, что видно', async () => {
    await draw();
    await open();
    expect(boxes().map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Телефон', 'true'],
      ['Сайт', 'false'],
      ['Заметка', 'false'],
    ]);
    expect(reset().hasAttribute('data-disabled')).toBe(true);
  });

  it('переключение скрывает и показывает колонку, меню остаётся открытым, выбор уходит в хранилище', async () => {
    await draw();
    await open();
    await click(box('Телефон'));
    expect(visible()).toBe('name,actions');
    expect(stored()).toEqual({ phone: false });
    expect(box('Телефон').getAttribute('aria-checked')).toBe('false');

    await click(box('Сайт'));
    expect(visible()).toBe('name,site,actions');
    expect(stored()).toEqual({ phone: false, site: true });

    // Возврат к умолчанию запись убирает.
    await click(box('Телефон'));
    expect(visible()).toBe('name,phone,site,actions');
    expect(stored()).toEqual({ site: true });
  });

  it('«Сбросить» возвращает умолчания и чистит хранилище', async () => {
    localStorage.setItem(KEY, JSON.stringify({ phone: false, note: true }));
    await draw();
    expect(visible()).toBe('name,note,actions');
    await open();
    expect(reset().hasAttribute('data-disabled')).toBe(false);
    await click(reset());
    expect(visible()).toBe('name,phone,actions');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(reset().hasAttribute('data-disabled')).toBe(true);
  });

  it('сохранённый выбор читается при следующем открытии; явное true показывает «широкую» колонку на узком экране', async () => {
    localStorage.setItem(KEY, JSON.stringify({ site: true, phone: false }));
    await draw();
    expect(visible()).toBe('name,site,actions');
  });

  it('явное false прячет «широкую» колонку и на широком экране', async () => {
    setWide(true);
    localStorage.setItem(KEY, JSON.stringify({ site: false }));
    await draw();
    expect(visible()).toBe('name,phone,actions');
  });

  it('битый JSON и не-объект в хранилище — умолчания', async () => {
    localStorage.setItem(KEY, '{не json');
    await draw();
    expect(visible()).toBe('name,phone,actions');
    act(() => root.unmount());
    localStorage.setItem(KEY, '[true]');
    root = createRoot(host);
    await draw();
    expect(visible()).toBe('name,phone,actions');
  });

  it('неизвестные ключи, не-булевы значения и попытка скрыть обязательную колонку игнорируются', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ghost: false, phone: 'no', name: false, actions: false, note: true }));
    await draw();
    expect(visible()).toBe('name,phone,note,actions');
    await open();
    expect(boxes().map((item) => item.textContent)).toEqual(['Телефон', 'Сайт', 'Заметка']);
    // Следующая запись оставляет в хранилище только известные скрываемые колонки.
    await click(box('Телефон'));
    expect(stored()).toEqual({ phone: false, note: true });
  });

  it('ошибки хранилища не ломают таблицу: выбор живёт в памяти', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await draw({ id: 'broken' });
    expect(visible()).toBe('name,phone,actions');
    await open();
    await click(box('Телефон'));
    expect(visible()).toBe('name,actions');
  });

  it('у каждой таблицы свой ключ', async () => {
    localStorage.setItem('panel_columns_other', JSON.stringify({ phone: false }));
    await draw();
    expect(visible()).toBe('name,phone,actions');
  });

  it('минимальная ширина считается по видимым колонкам; «широкая» по умолчанию в неё не входит', async () => {
    await draw();
    // гибкая «Имя» 200 + 100 + 40
    expect(host.querySelector('[data-testid="min"]').textContent).toBe('340');
    await open();
    await click(box('Сайт'));
    expect(host.querySelector('[data-testid="min"]').textContent).toBe('420');
    await click(box('Телефон'));
    expect(host.querySelector('[data-testid="min"]').textContent).toBe('320');
    expect(tableMinWidth([{ width: 80, auto: true }, { width: 50 }], 200)).toBe(50);
  });
});
