// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Меню Radix ждёт ResizeObserver, которого нет в jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import ConversationsTable from './ConversationsTable';
import TableSkeleton from '../TableSkeleton/TableSkeleton';
import { MeContext } from '../AppLayout/me';

const KEY = 'panel_columns_dialogs';
// 06.10.2026 22:15 по Москве.
const TS = Date.UTC(2026, 9, 6, 19, 15) / 1000;
const ROWS = [
  {
    chat_id: 1,
    id: 1,
    name: 'Анна',
    last_message_ts: TS,
    unread_count: 0,
    stage: { id: 'knock', title: 'Знакомство', index: 1, total: 5 },
    client_username: 'anna_t',
    manager_username: 'olga',
    region_code: '0077',
    account_username: 'sender_1',
  },
];

let host;
let root;
const realMatchMedia = window.matchMedia;
const setWide = (matches) => {
  window.matchMedia = () => ({ matches, addEventListener() {}, removeEventListener() {} });
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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

const draw = (props = {}) => act(async () => root.render(<ConversationsTable rows={ROWS} {...props} />));
const heads = () => [...host.querySelectorAll('thead th')].map((th) => th.textContent.trim());
const cells = () => [...host.querySelectorAll('tbody tr:first-child td')];
const cellOf = (label) => cells()[heads().indexOf(label)];
const openPicker = () =>
  act(async () =>
    host
      .querySelector('thead button[aria-label="Настроить поля"]')
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })),
  );
const boxes = () => [...document.querySelectorAll('[role="menuitemcheckbox"]')];
const box = (label) => boxes().find((item) => item.textContent === label);
const click = (el) => act(async () => el.click());

describe('таблица диалогов: время и действия', () => {
  it('«Последнее» — одна линия «день.месяц, время» по Москве, полная дата в подсказке', async () => {
    await draw();
    const cell = cellOf('Последнее');
    expect(cell.textContent).toBe('06.10, 22:15');
    expect(cell.querySelectorAll('div').length).toBe(1);
    expect(cell.querySelector('[title]').getAttribute('title')).toBe('06.10.2026, 22:15');
  });

  it('без времени — прочерк', async () => {
    await draw({ rows: [{ ...ROWS[0], last_message_ts: null }] });
    expect(cellOf('Последнее').textContent).toBe('—');
  });

  it('колонка действий вмещает две кнопки по 32px с полями по 12px', async () => {
    await draw({ onHide: vi.fn() });
    const last = host.querySelector('thead th:last-child');
    expect(last.style.width).toBe('88px');
    expect(cells().at(-1).querySelectorAll('button').length).toBe(2);
    expect(cells().at(-1).className).toContain('px-3');
  });
});

describe('таблица диалогов: настройка полей', () => {
  it('по умолчанию на узком экране «Региона» нет, минимальная ширина — по видимым колонкам', async () => {
    await draw();
    expect(heads()).toEqual(['Собеседник', 'Контакт', 'Соцсеть', 'Тип', 'Стадия', 'Этап', 'Ведёт', 'Что дальше', 'Менеджер', 'Аккаунт', 'Последнее', 'Действия']);
    expect(cells().length).toBe(heads().length);
    expect(host.querySelector('table').style.minWidth).toBe('1512px');
  });

  it('на широком экране «Регион» виден и минимальную ширину не увеличивает', async () => {
    setWide(true);
    await draw();
    expect(heads()).toContain('Регион');
    expect(heads()).not.toContain('В сети');
    expect(host.querySelector('table').style.minWidth).toBe('1512px');
  });

  it('в меню нет обязательных колонок: собеседника и действия скрыть нельзя', async () => {
    localStorage.setItem(KEY, JSON.stringify({ who: false, actions: false }));
    await draw();
    await openPicker();
    expect(boxes().map((item) => item.textContent)).toEqual([
      'Контакт', 'Соцсеть', 'Тип', 'Стадия', 'Этап', 'Ведёт', 'Что дальше', 'Непрочитанные', 'В сети', 'Возраст', 'Город', 'Личность',
      'Менеджер', 'Регион', 'Аккаунт', 'Последнее',
    ]);
    expect(heads()).toContain('Собеседник');
    expect(heads()).toContain('Действия');
  });

  it('скрытая колонка пропадает из заголовка и строк, её значение остаётся в подсказке собеседника', async () => {
    await draw();
    await openPicker();
    await click(box('Контакт'));
    expect(heads()).not.toContain('Контакт');
    expect(cells().length).toBe(heads().length);
    expect(host.textContent).not.toContain('@anna_t');
    expect(cellOf('Собеседник').querySelector('[title]').getAttribute('title')).toContain('@anna_t');
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ contact: false });
    expect(host.querySelector('table').style.minWidth).toBe('1372px');
  });

  it('явное включение показывает «Регион» и на узком экране', async () => {
    await draw();
    await openPicker();
    expect(box('Регион').getAttribute('aria-checked')).toBe('false');
    await click(box('Регион'));
    expect(cellOf('Регион').textContent).toBe('0077');
    expect(host.querySelector('table').style.minWidth).toBe('1604px');
  });

  it('без гибкой «Что дальше» минимальная ширина — сумма оставшихся колонок', async () => {
    localStorage.setItem(KEY, JSON.stringify({ next: false }));
    await draw();
    expect(heads()).not.toContain('Что дальше');
    expect(host.querySelector('table').style.minWidth).toBe('1400px');
  });

  it('пустое состояние занимает все видимые колонки', async () => {
    localStorage.setItem(KEY, JSON.stringify({ contact: false, deal: false }));
    await draw({ rows: [] });
    expect(host.querySelector('tbody td').colSpan).toBe(heads().length);
  });
});

describe('заглушка списка диалогов', () => {
  const lines = () => [...host.querySelectorAll('[role="status"] > div')];

  it('в строке столько же ячеек, сколько в заголовке, и это видимые колонки', async () => {
    localStorage.setItem(KEY, JSON.stringify({ contact: false, region: true }));
    await act(async () => root.render(<TableSkeleton rows={3} />));
    const [head, ...rows] = lines();
    expect(rows.length).toBe(3);
    expect([...head.children].map((el) => el.textContent)).toEqual(['Собеседник', 'Соцсеть', 'Тип', 'Стадия', 'Этап', 'Ведёт', 'Что дальше', 'Менеджер', 'Регион', 'Аккаунт', 'Последнее', '']);
    for (const row of rows) expect(row.children.length).toBe(head.children.length);
    expect(head.style.minWidth).toBe('1464px');
  });

  it('те же колонки, что у таблицы после загрузки', async () => {
    localStorage.setItem(KEY, JSON.stringify({ stage: false, account: false }));
    await draw({ ready: false, rows: [] });
    const count = lines()[0].children.length;
    await draw({ ready: true });
    expect(heads().length).toBe(count);
  });
});

describe('«Менеджер» и «Регион» — только у админа', () => {
  const MANAGER = { id: 7, username: 'olga', role: 'manager' };
  const as = (me, node) => act(async () => root.render(<MeContext.Provider value={me}>{node}</MeContext.Provider>));

  it('менеджеру колонок нет: ни в заголовке, ни в строках, ни в настройке полей, ни в фильтрах', async () => {
    setWide(true);
    localStorage.setItem(KEY, JSON.stringify({ region: true }));
    await as(MANAGER, <ConversationsTable rows={ROWS} />);
    expect(heads()).toEqual(['Собеседник', 'Контакт', 'Соцсеть', 'Тип', 'Стадия', 'Этап', 'Ведёт', 'Что дальше', 'Аккаунт', 'Последнее', 'Действия']);
    expect(cells().length).toBe(heads().length);
    expect(host.textContent).not.toContain('olga');
    expect(host.textContent).not.toContain('0077');
    expect(host.querySelector('button[aria-label="Фильтр: Менеджер"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Фильтр: Регион"]')).toBeNull();
    expect(host.querySelector('table').style.minWidth).toBe('1404px');
    await openPicker();
    expect(boxes().map((item) => item.textContent)).toEqual([
      'Контакт', 'Соцсеть', 'Тип', 'Стадия', 'Этап', 'Ведёт', 'Что дальше', 'Непрочитанные', 'В сети', 'Возраст', 'Город', 'Личность', 'Аккаунт', 'Последнее',
    ]);
  });

  it('менеджеру их нет и в подсказке собеседника, а оставшийся фильтр по ним не действует и не виден', async () => {
    sessionStorage.setItem('panel_filters_dialogs', JSON.stringify({ manager: ['someone'], region: ['0001'] }));
    await as(MANAGER, <ConversationsTable rows={ROWS} />);
    expect(cells().length).toBe(heads().length);
    const hint = cellOf('Собеседник').querySelector('[title]').getAttribute('title');
    expect(hint).not.toContain('Менеджер');
    expect(hint).not.toContain('Регион');
    expect(host.textContent).toContain('ВСЕГО: 1');
    expect(host.querySelector('[aria-label="Заданные фильтры"]')).toBeNull();
  });

  it('заглушка менеджера — без этих колонок', async () => {
    setWide(true);
    await as(MANAGER, <TableSkeleton rows={2} />);
    const [head, ...rows] = [...host.querySelectorAll('[role="status"] > div')];
    expect([...head.children].map((el) => el.textContent)).toEqual(['Собеседник', 'Контакт', 'Соцсеть', 'Тип', 'Стадия', 'Этап', 'Ведёт', 'Что дальше', 'Аккаунт', 'Последнее', '']);
    for (const row of rows) expect(row.children.length).toBe(head.children.length);
    expect(head.style.minWidth).toBe('1404px');
  });

  it('админу и таблице вне каркаса колонки видны', async () => {
    setWide(true);
    await as({ id: 1, username: 'root', role: 'admin' }, <ConversationsTable rows={ROWS} />);
    expect(heads()).toEqual(expect.arrayContaining(['Менеджер', 'Регион']));
    expect(cellOf('Менеджер').textContent).toBe('olga');
    await draw();
    expect(heads()).toEqual(expect.arrayContaining(['Менеджер', 'Регион']));
  });
});
