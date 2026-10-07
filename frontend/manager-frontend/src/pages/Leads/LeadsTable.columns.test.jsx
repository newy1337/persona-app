// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LeadsTable } from './LeadsTable';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Меню Radix ждёт ResizeObserver, которого нет в jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

const KEY = 'panel_columns_leads';
const ROWS = [
  {
    id: 5,
    first_name: 'Ира',
    phone_e164: '+79000000005',
    status: 'pending',
    site: 'mamba',
    telegram_username: 'ira_tg',
    manager_username: 'olga',
    persona_id: 'nastya',
    first_contact_at: 1790000000,
  },
];
const helpers = {
  PersonaSelect: () => null,
  statusLabels: { pending: 'Новый' },
  statusBadges: {},
  date: () => '01.10.2026',
};

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

const draw = (rows = ROWS) =>
  act(async () =>
    root.render(<LeadsTable rows={rows} query="" status="" selected={new Set()} personas={[]} helpers={helpers} />),
  );
const heads = () => [...host.querySelectorAll('thead th')].map((th) => th.textContent.trim());
const firstRow = () => [...host.querySelectorAll('tbody tr:first-child td')];
const cellOf = (label) => firstRow()[heads().indexOf(label)];
const pointer = (el) =>
  act(async () => el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })));
const openPicker = () => pointer(host.querySelector('thead button[aria-label="Настроить поля"]'));
const boxes = () => [...document.querySelectorAll('[role="menuitemcheckbox"]')];
const box = (label) => boxes().find((item) => item.textContent === label);
const click = (el) => act(async () => el.click());

describe('таблица лидов: настройка полей', () => {
  it('по умолчанию на узком экране нет «Telegram» и «Сайта»; сайт дописан под имя', async () => {
    await draw();
    expect(heads()).toEqual(['', 'Лид', 'Контакт', 'Личность', 'Менеджер', 'Аккаунт', 'Статус', 'Написали', 'Действия']);
    expect(firstRow().length).toBe(heads().length);
    expect(cellOf('Лид').textContent).toContain('· mamba');
    expect(cellOf('Лид').getAttribute('title')).toContain('Telegram: @ira_tg');
    expect(host.querySelector('table').style.minWidth).toBe('1200px');
  });

  it('на широком экране обе колонки видны, сайт под именем не повторяется', async () => {
    setWide(true);
    await draw();
    expect(cellOf('Telegram').textContent).toBe('@ira_tg');
    expect(cellOf('Сайт').textContent).toBe('mamba');
    expect(cellOf('Лид').textContent).not.toContain('mamba');
    expect(host.querySelector('table').style.minWidth).toBe('1200px');
  });

  it('явное включение показывает «Telegram» на узком экране', async () => {
    await draw();
    await openPicker();
    await click(box('Telegram'));
    expect(cellOf('Telegram').querySelector('a').getAttribute('href')).toBe('https://t.me/ira_tg');
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ telegram: true });
    expect(host.querySelector('table').style.minWidth).toBe('1368px');
  });

  it('скрытая колонка пропадает из заголовка и строк, значение остаётся в подсказке лида', async () => {
    await draw();
    await openPicker();
    await click(box('Менеджер'));
    await click(box('Написали'));
    expect(heads()).toEqual(['', 'Лид', 'Контакт', 'Личность', 'Аккаунт', 'Статус', 'Действия']);
    expect(firstRow().length).toBe(heads().length);
    const title = cellOf('Лид').getAttribute('title');
    expect(title).toContain('Менеджер: olga');
    expect(title).toContain('Написали: 01.10.2026');
  });

  it('чекбокс, лид и действия обязательны: в меню их нет, запись в хранилище их не прячет', async () => {
    localStorage.setItem(KEY, JSON.stringify({ select: false, lead: false, actions: false }));
    await draw();
    expect(host.querySelector('thead [aria-label="Выбрать лидов на странице"]')).not.toBeNull();
    expect(heads()).toContain('Лид');
    await openPicker();
    expect(boxes().map((item) => item.textContent)).toEqual(['Контакт', 'Telegram', 'Сайт', 'Личность', 'Менеджер', 'Аккаунт', 'Статус', 'Написали']);
  });

  it('заглушка и пустое состояние собраны из видимых колонок', async () => {
    localStorage.setItem(KEY, JSON.stringify({ contact: false, site: true }));
    await draw(null);
    expect(host.querySelectorAll('tbody tr').length).toBeGreaterThan(1);
    for (const row of host.querySelectorAll('tbody tr')) expect(row.children.length).toBe(heads().length);
    await draw([]);
    expect(host.querySelector('tbody td').colSpan).toBe(heads().length);
  });
});

describe('таблица лидов: меню «Ещё»', () => {
  const menuOf = async () => {
    await pointer(host.querySelector('tbody button[aria-label="Ещё"]'));
    return document.querySelector('[role="menu"]');
  };

  it('профиля в Telegram в меню нет; одинокое «Удалить» — без разделителя', async () => {
    await draw();
    const menu = await menuOf();
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(['Удалить']);
    expect(menu.querySelector('[role="separator"]')).toBeNull();
    expect(menu.querySelector('a')).toBeNull();
  });

  it('с «Написать с другого» разделитель перед «Удалить» остаётся', async () => {
    await draw([{ ...ROWS[0], first_contact_at: null, assigned_account_id: 7, assigned_account_username: 'sender' }]);
    const menu = await menuOf();
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBe(2);
    expect(menu.querySelector('[role="separator"]')).not.toBeNull();
  });
});
