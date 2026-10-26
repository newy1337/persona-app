// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountsTable, AccountsTableSkeleton } from './AccountsTable';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Меню Radix ждёт ResizeObserver, которого нет в jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

const KEY = 'panel_columns_accounts';
const ROWS = [
  {
    id: 7,
    username: 'sender_test',
    phone_e164: '+70000000000',
    status: 'active',
    persona_id: 'nastya',
    manager_username: 'manager_test',
    region_code: '0077',
    chats: 3,
  },
];
const helpers = { Avatar: () => null, statusLabel: () => 'активен', date: () => '—' };

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
});

const draw = (rows = ROWS) => act(async () => root.render(<AccountsTable rows={rows} alive={{}} helpers={helpers} />));
const heads = () => [...host.querySelectorAll('thead th')].map((th) => th.textContent.trim());
const firstRow = () => [...host.querySelectorAll('tbody tr:first-child td')];
const cellOf = (label) => firstRow()[heads().indexOf(label)];
const openPicker = () =>
  act(async () =>
    host
      .querySelector('thead button[aria-label="Настроить поля"]')
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })),
  );
const boxes = () => [...document.querySelectorAll('[role="menuitemcheckbox"]')];
const box = (label) => boxes().find((item) => item.textContent === label);
const click = (el) => act(async () => el.click());
const facts = () =>
  Object.fromEntries([...host.querySelectorAll('[role="region"] dl > div')].map((el) => [el.querySelector('dt').textContent, el.querySelector('dd').textContent]));

describe('таблица аккаунтов: настройка полей', () => {
  it('по умолчанию на узком экране нет «Региона» и «Пульса»', async () => {
    await draw();
    expect(heads()).toEqual(['Подробнее', 'Аккаунт', 'Соцсеть', 'Телефон', 'Личность', 'Менеджер', 'Диалоги', 'Прокси', 'Состояние', 'Действия']);
    expect(firstRow().length).toBe(heads().length);
    expect(host.querySelector('table').style.minWidth).toBe('1388px');
  });

  it('на широком экране видны «Регион», «Пульс» и «Образ»; минимальная ширина та же', async () => {
    setWide(true);
    await draw();
    expect(cellOf('Регион').textContent).toBe('0077');
    expect(heads()).toContain('Пульс');
    expect(cellOf('Образ').textContent).toBe('без образа');
    expect(host.querySelector('table').style.minWidth).toBe('1388px');
  });

  it('явное включение показывает «Регион» на узком экране', async () => {
    await draw();
    await openPicker();
    await click(box('Регион'));
    expect(cellOf('Регион').textContent).toBe('0077');
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ region: true });
    expect(host.querySelector('table').style.minWidth).toBe('1472px');
  });

  it('скрытая колонка пропадает из заголовка и строк, значение переезжает в раскрытие строки', async () => {
    await draw();
    await click(host.querySelector('tr[data-account-id="7"]'));
    expect(facts()).not.toHaveProperty('Телефон');
    await openPicker();
    await click(box('Телефон'));
    await click(box('Состояние'));
    expect(heads()).toEqual(['Подробнее', 'Аккаунт', 'Соцсеть', 'Личность', 'Менеджер', 'Диалоги', 'Прокси', 'Действия']);
    expect(firstRow().length).toBe(heads().length);
    expect(facts()).toMatchObject({ Телефон: '+70000000000', Состояние: 'активен' });
    expect(host.querySelector('[role="region"]').closest('td').colSpan).toBe(heads().length);
  });

  it('без «Прокси» минимальная ширина — сумма оставшихся колонок', async () => {
    localStorage.setItem(KEY, JSON.stringify({ proxy: false }));
    await draw();
    expect(heads()).not.toContain('Прокси');
    expect(host.querySelector('table').style.minWidth).toBe('1208px');
  });

  it('раскрытие, аккаунт и действия обязательны: в меню их нет, запись в хранилище их не прячет', async () => {
    localStorage.setItem(KEY, JSON.stringify({ toggle: false, account: false, actions: false }));
    await draw();
    expect(heads().slice(0, 2)).toEqual(['Подробнее', 'Аккаунт']);
    expect(heads().at(-1)).toBe('Действия');
    await openPicker();
    expect(boxes().map((item) => item.textContent)).toEqual(['Соцсеть', 'Телефон', 'Личность', 'Менеджер', 'Регион', 'Диалоги', 'Образ', 'Прокси', 'Состояние', 'Пульс']);
  });

  it('пустое состояние занимает все видимые колонки, настройка полей остаётся доступной', async () => {
    localStorage.setItem(KEY, JSON.stringify({ phone: false }));
    await draw([]);
    expect(host.querySelector('tbody td').colSpan).toBe(heads().length);
    expect(host.querySelector('thead button[aria-label="Настроить поля"]')).not.toBeNull();
  });

  it('заглушка собрана из видимых колонок и без кнопки настройки', async () => {
    localStorage.setItem(KEY, JSON.stringify({ phone: false, pulse: true }));
    await act(async () => root.render(<AccountsTableSkeleton rows={2} />));
    const head = host.querySelectorAll('[role="status"] thead th');
    expect([...head].map((th) => th.textContent)).toEqual(['Подробнее', 'Аккаунт', 'Соцсеть', 'Личность', 'Менеджер', 'Диалоги', 'Прокси', 'Состояние', 'Пульс', 'Действия']);
    for (const row of host.querySelectorAll('[role="status"] tbody tr')) expect(row.children.length).toBe(head.length);
    expect(host.querySelector('button')).toBeNull();
  });
});
