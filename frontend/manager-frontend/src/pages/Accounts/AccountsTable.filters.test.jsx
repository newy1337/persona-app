// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeContext } from '../../components/AppLayout/me';
import { AccountsTable, AccountsTableSkeleton } from './AccountsTable';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

const FILTERS = 'panel_filters_accounts';
const NOW = Date.parse('2026-10-07T12:00:00+03:00');
const at = (iso) => Date.parse(iso) / 1000;
const ROWS = [
  { id: 1, display_name: 'Настя Томск', username: 'nastya_tomsk', phone_e164: '+79001110001', status: 'active', persona_id: 'nastya', manager_username: 'olga', region_code: '0077', last_heartbeat_at: at('2026-10-07T11:00:00+03:00') },
  { id: 2, display_name: 'Оля', username: 'olya_work', phone_e164: '+79002220002', status: 'paused', persona_id: 'olya', manager_username: 'olga', region_code: '0078', needs_proxy_setup: true, last_heartbeat_at: at('2026-10-06T10:00:00+03:00') },
  { id: 3, username: 'spare_acc', phone_e164: '+79003330003', status: 'active', persona_id: '', manager_username: '', region_code: '', last_heartbeat_at: at('2026-09-20T10:00:00+03:00') },
  { id: 4, display_name: 'Новый', phone_e164: '+79004440004', status: 'active', persona_id: 'nastya', manager_username: 'ivan', region_code: '0077', last_heartbeat_at: 0 },
];
const helpers = { Avatar: () => null, statusLabel: (a) => (a.status === 'paused' ? 'пауза' : 'активен'), date: () => '—' };

let host;
let root;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const table = (rows = ROWS, alive = { 1: true }) => <AccountsTable rows={rows} alive={alive} helpers={helpers} />;
const draw = (rows, alive) => act(async () => root.render(table(rows, alive)));
const seed = (state) => window.sessionStorage.setItem(FILTERS, JSON.stringify(state));
const saved = () => JSON.parse(window.sessionStorage.getItem(FILTERS));
const ids = () => [...host.querySelectorAll('tr[data-account-id]')].map((tr) => Number(tr.dataset.accountId));
const funnel = (label) => host.querySelector(`thead button[aria-label="Фильтр: ${label}"]`);
const popover = () => [...document.querySelectorAll('[data-slot="popover-content"]')].at(-1);
const click = (el) => act(async () => el.click());
const open = (label) => click(funnel(label));
const check = (text) =>
  click([...popover().querySelectorAll('label')].find((el) => el.textContent.startsWith(text)).querySelector('[role="checkbox"]'));
const optionLabels = () => [...popover().querySelectorAll('label')].map((el) => el.querySelector('span[title]').textContent);
const count = () => host.querySelector('[data-testid="accounts-count"]').textContent;
const chips = () => host.querySelector('[aria-label="Заданные фильтры"]');
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);
const heads = () => [...host.querySelectorAll('thead th')].map((th) => th.textContent.trim());

describe('таблица аккаунтов: фильтры колонок', () => {
  it('воронка есть у колонок с фильтром и нет у раскрытия, «Диалогов» и действий', async () => {
    window.localStorage.setItem('panel_columns_accounts', JSON.stringify({ region: true, pulse: true }));
    await draw();
    for (const label of ['Аккаунт', 'Телефон', 'Личность', 'Менеджер', 'Регион', 'Прокси', 'Состояние', 'Пульс']) {
      expect(funnel(label), label).not.toBeNull();
    }
    for (const label of ['Подробнее', 'Диалоги', 'Действия']) expect(funnel(label)).toBeNull();
    expect(count()).toBe('Аккаунтов: 4');
    expect(chips()).toBeNull();
  });

  it('список «Личность»: варианты из всех строк, выбор сужает список и виден в плашке', async () => {
    await draw();
    await open('Личность');
    expect(optionLabels()).toEqual(['nastya', 'olya', 'Без личности']);
    await check('nastya');
    expect(ids()).toEqual([1, 4]);
    expect(count()).toBe('Найдено: 2 из 4');
    expect(chips().textContent).toContain('Личность: nastya');
    expect(saved()).toEqual({ persona: ['nastya'] });
    // Список вариантов не сжимается до отфильтрованных строк.
    expect(optionLabels()).toEqual(['nastya', 'olya', 'Без личности']);
    await check('Без личности');
    expect(ids()).toEqual([1, 3, 4]);
  });

  it('список «Состояние»: подписи бейджа и присутствие в сети в одном списке', async () => {
    await draw();
    await open('Состояние');
    expect(optionLabels()).toEqual(['активен', 'пауза', 'В сети', 'Не в сети']);
    await check('пауза');
    expect(ids()).toEqual([2]);
    await check('пауза');
    await check('В сети');
    expect(ids()).toEqual([1]);
    // Присутствие берётся из опроса: аккаунт вышел в сеть — строка появляется.
    await draw(ROWS, { 1: true, 3: true });
    expect(ids()).toEqual([1, 3]);
  });

  it('список «Прокси»: «задан» и «не задан»', async () => {
    seed({ proxy: ['unset'] });
    await draw();
    expect(ids()).toEqual([2]);
    expect(chips().textContent).toContain('Прокси: не задан');
  });

  it('текст: «Аккаунт» ищет по имени и нику, «Телефон» — по номеру', async () => {
    await draw();
    await open('Аккаунт');
    const input = popover().querySelector('input[aria-label="Аккаунт: содержит"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const type = (text) =>
      act(async () => {
        setter.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await type('томск');
    expect(ids()).toEqual([1]);
    await type('@spare');
    expect(ids()).toEqual([3]);
    expect(chips().textContent).toContain('Аккаунт: «@spare»');
    await type('');
    expect(ids()).toEqual([1, 2, 3, 4]);

    seed({ phone: '222' });
    act(() => root.unmount());
    root = createRoot(host);
    await draw();
    expect(ids()).toEqual([2]);
  });

  it('период «Пульс» считается от текущего времени по московским суткам', async () => {
    await draw();
    await open('Пульс');
    const period = (text) => click([...popover().querySelectorAll('button[aria-pressed]')].find((b) => b.textContent === text));
    await period('Сегодня');
    expect(ids()).toEqual([1]);
    await period('Вчера');
    expect(ids()).toEqual([2]);
    await period('За 7 дней');
    expect(ids()).toEqual([1, 2]);
    await period('За 30 дней');
    expect(ids()).toEqual([1, 2, 3]);
    expect(chips().textContent).toContain('Пульс: За 30 дней');
  });

  it('фильтры складываются; плашка снимает один, «Сбросить все» — все', async () => {
    seed({ persona: ['nastya'], manager: ['olga'], state: ['активен'] });
    await draw();
    expect(ids()).toEqual([1]);
    expect(count()).toBe('Найдено: 1 из 4');
    await click(host.querySelector('button[aria-label="Убрать фильтр: Менеджер"]'));
    expect(ids()).toEqual([1, 4]);
    expect(saved()).toEqual({ persona: ['nastya'], state: ['активен'] });
    await click(button('Сбросить все'));
    expect(ids()).toEqual([1, 2, 3, 4]);
    expect(chips()).toBeNull();
    expect(count()).toBe('Аккаунтов: 4');
  });

  it('фильтр скрытой колонки работает и виден в плашках; выбранное значение не пропадает из списка', async () => {
    window.localStorage.setItem('panel_columns_accounts', JSON.stringify({ persona: false }));
    seed({ persona: ['olya'], manager: ['gone'] });
    await draw();
    expect(heads()).not.toContain('Личность');
    expect(ids()).toEqual([]);
    expect(chips().textContent).toContain('Личность: olya');
    await open('Менеджер');
    expect(optionLabels()).toEqual(['ivan', 'olga', 'без менеджера', 'gone']);
  });

  it('два пустых текста: по фильтрам ничего нет — и аккаунтов нет вовсе', async () => {
    seed({ account: 'никого' });
    await draw();
    expect(host.querySelector('tbody td').textContent).toContain('По этим условиям аккаунтов нет');
    expect(host.textContent).not.toContain('Добавьте номер');
    expect(count()).toBe('Найдено: 0 из 4');
    await click(button('Сбросить фильтры'));
    expect(ids()).toEqual([1, 2, 3, 4]);
    expect(saved()).toEqual({});

    seed({ account: 'никого' });
    await draw([]);
    expect(host.querySelector('tbody td').textContent).toContain('Аккаунтов нет. Добавьте номер');
    expect(host.textContent).not.toContain('По этим условиям');
    expect(count()).toBe('Аккаунтов: 0');
  });

  it('раскрытая строка, скрытая фильтром, раскрыта снова, когда возвращается', async () => {
    await draw();
    await click(host.querySelector('tr[data-account-id="2"]'));
    expect(host.querySelectorAll('[role="region"]').length).toBe(1);
    await open('Личность');
    await check('nastya');
    expect(ids()).toEqual([1, 4]);
    expect(host.querySelectorAll('[role="region"]').length).toBe(0);
    // Опрос фильтры не сбрасывает.
    await draw(ROWS.map((r) => ({ ...r })));
    expect(ids()).toEqual([1, 4]);
    await click(host.querySelector('button[aria-label="Убрать фильтр: Личность"]'));
    expect(host.querySelector('[role="region"]').getAttribute('aria-label')).toBe('Подробности: Оля');
  });

  it('строка над таблицей есть и у заглушки: высота блока не меняется', async () => {
    await act(async () => root.render(<AccountsTableSkeleton rows={1} />));
    const bar = host.firstElementChild.firstElementChild;
    expect(bar.className).toContain('min-h-8');
    await draw();
    expect(host.firstElementChild.firstElementChild.className).toBe(bar.className);
  });
});

describe('таблица аккаунтов: колонки только для админа', () => {
  const as = (me, element) => act(async () => root.render(<MeContext.Provider value={me}>{element}</MeContext.Provider>));
  const manager = { id: 2, username: 'olga', role: 'manager' };

  it('менеджеру «Менеджер» и «Регион» не показываются нигде', async () => {
    window.localStorage.setItem('panel_columns_accounts', JSON.stringify({ region: true }));
    seed({ manager: ['ivan'], region: ['0078'] });
    await as(manager, table());
    // matchMedia в jsdom нет — экран считается широким, «Пульс» виден.
    expect(heads()).toEqual(['Подробнее', 'Аккаунт', 'Телефон', 'Личность', 'Диалоги', 'Прокси', 'Состояние', 'Пульс', 'Действия']);
    expect(host.querySelector('tbody tr').children.length).toBe(heads().length);
    expect(host.querySelector('[data-testid="account-owner"]')).toBeNull();
    // Сохранённые фильтры по этим колонкам не действуют и не видны.
    expect(ids()).toEqual([1, 2, 3, 4]);
    expect(chips()).toBeNull();
    expect(count()).toBe('Аккаунтов: 4');
    expect(funnel('Менеджер')).toBeNull();
    expect(host.querySelector('table').style.minWidth).toBe('1110px');

    await click(host.querySelector('tr[data-account-id="1"]'));
    const facts = [...host.querySelectorAll('[role="region"] dt')].map((dt) => dt.textContent);
    expect(facts).not.toContain('Менеджер');
    expect(facts).not.toContain('Регион');
    expect(host.textContent).not.toContain('0077');

    await act(async () =>
      host
        .querySelector('thead button[aria-label="Настроить поля"]')
        .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })),
    );
    expect([...document.querySelectorAll('[role="menuitemcheckbox"]')].map((item) => item.textContent)).toEqual(
      ['Телефон', 'Личность', 'Диалоги', 'Прокси', 'Состояние', 'Пульс'],
    );
  });

  it('заглушка менеджера собрана без этих колонок; админ видит обе', async () => {
    await as(manager, <AccountsTableSkeleton rows={1} />);
    expect(heads()).not.toContain('Менеджер');
    expect(host.querySelector('tbody tr').children.length).toBe(heads().length);
    await as({ id: 1, username: 'admin', role: 'admin' }, table());
    expect(heads()).toContain('Менеджер');
    expect(funnel('Менеджер')).not.toBeNull();
  });
});
