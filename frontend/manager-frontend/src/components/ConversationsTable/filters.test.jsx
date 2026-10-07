// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import ConversationsTable from './ConversationsTable';
import { COLUMNS, dialogFilterDefs } from './rowLayout';

const FILTERS_KEY = 'panel_filters_dialogs';
const COLUMNS_KEY = 'panel_columns_dialogs';
// Полдень 07.10.2026 по Москве.
const NOW = Date.parse('2026-10-07T12:00:00+03:00');
const at = (iso) => Date.parse(iso) / 1000;

const KNOCK = { id: 'knock', title: 'Знакомство', index: 1, total: 5 };
const WARM = { id: 'warm', title: 'Разговорились', index: 2, total: 5 };
const row = (id, extra = {}) => ({
  chat_id: id,
  id,
  name: `Клиент ${id}`,
  last_message_ts: at('2026-10-07T00:10:00+03:00'),
  unread_count: 0,
  stage: KNOCK,
  ...extra,
});

const LIST = [
  row(1, {
    name: 'Настя',
    age: 27,
    city: 'Томск',
    client_username: 'tomsk_user',
    phone: '+79160000001',
    deal_stage: 'soglas',
    manager_username: 'olga',
    region_code: '0077',
    account_username: 'sender_1',
    next_bot_action: { kind: 'composing' },
  }),
  row(2, {
    name: 'Оля',
    city: 'Туапсе',
    stage: WARM,
    is_paused: true,
    unread_count: 2,
    account_id: 5,
    last_message_ts: at('2026-10-06T23:50:00+03:00'),
  }),
  row(3, {
    name: 'Василий',
    stage: WARM,
    is_paused: true,
    manager_username: 'olga',
    last_message_ts: at('2026-09-20T12:00:00+03:00'),
  }),
];

let host;
let root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  window.localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const draw = (props = {}) => act(async () => root.render(<ConversationsTable rows={LIST} {...props} />));
const ids = () => [...host.querySelectorAll('tbody tr[data-chat-id]')].map((tr) => tr.getAttribute('data-chat-id'));
const heads = () => [...host.querySelectorAll('thead th')].map((th) => th.textContent.trim());
const funnel = (label) => host.querySelector(`thead button[aria-label="Фильтр: ${label}"]`);
const popover = () => document.querySelector('[data-slot="popover-content"]');
const open = (label) => act(async () => funnel(label).click());
// Закрытый поповер возвращает фокус на свою воронку через setTimeout(0) — ждём,
// иначе этот фокус закроет следующий поповер как «фокус снаружи».
const close = async (label) => {
  await act(async () => funnel(label).click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const options = () =>
  [...popover().querySelectorAll('label')].map((el) => ({ text: el.textContent, box: el.querySelector('[role="checkbox"]') }));
const pick = (text) => act(async () => options().find((o) => o.text.startsWith(text)).box.click());
const type = (label, text) => {
  const input = popover().querySelector(`input[aria-label="${label}: содержит"]`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  return act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const counter = () => [...host.querySelectorAll('button')].find((b) => /ВСЕГО|НАЙДЕНО/.test(b.textContent));
const chips = () => host.querySelector('[aria-label="Заданные фильтры"]');
const saved = () => JSON.parse(window.sessionStorage.getItem(FILTERS_KEY) || '{}');

describe('фильтры колонок списка диалогов', () => {
  it('полосы стадий над таблицей нет, воронка — у каждой колонки, кроме действий', async () => {
    await draw();
    expect(host.querySelector('[aria-label="Стадии диалогов"]')).toBeNull();
    const labels = [...host.querySelectorAll('thead button[aria-label^="Фильтр: "]')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(
      ['Собеседник', 'Контакт', 'Стадия', 'Этап', 'Ведёт', 'Что дальше', 'Менеджер', 'Регион', 'Аккаунт', 'Последнее'].map(
        (label) => `Фильтр: ${label}`,
      ),
    );
    expect(host.querySelector('thead th:last-child button[aria-label^="Фильтр"]')).toBeNull();
  });

  it('«Стадия»: стадии из строк по порядку воронки, с числом и цветной точкой; галочка отбирает строки', async () => {
    await draw();
    await open('Стадия');
    expect(options().map((o) => o.text)).toEqual(['Знакомство1', 'Разговорились2']);
    expect(popover().querySelectorAll('label [aria-hidden="true"][style]').length).toBe(2);
    await pick('Разговорились');
    expect(ids()).toEqual(['2', '3']);
    expect(funnel('Стадия').hasAttribute('data-active')).toBe(true);
    await pick('Знакомство');
    expect(ids()).toEqual(['1', '2', '3']);
    expect(saved()).toEqual({ stage: ['warm', 'knock'] });
  });

  it('«Этап»: этапы сделки по порядку и «не указан»', async () => {
    await draw();
    await open('Этап');
    expect(options().map((o) => o.text)).toEqual(['Вброс0', 'Предлога0', 'Соглас1', 'Лид0', 'Депозит0', 'Архив0', 'не указан2']);
    await pick('не указан');
    expect(ids()).toEqual(['2', '3']);
    await pick('Соглас');
    expect(ids()).toEqual(['1', '2', '3']);
  });

  it('«Ведёт»: строка, где клиент ждёт ответа, подходит и под «Менеджер», и под «Клиент ждёт ответа»', async () => {
    await draw();
    await open('Ведёт');
    expect(options().map((o) => o.text)).toEqual(['Бот1', 'Менеджер2', 'Клиент ждёт ответа1']);
    await pick('Клиент ждёт ответа');
    expect(ids()).toEqual(['2']);
    await pick('Клиент ждёт ответа');
    await pick('Менеджер');
    expect(ids()).toEqual(['2', '3']);
    await pick('Менеджер');
    await pick('Бот');
    expect(ids()).toEqual(['1']);
  });

  it('текстовые фильтры: имя, город и возраст; ник, телефон и номер чата; текст «Что дальше»', async () => {
    await draw();
    await open('Собеседник');
    await type('Собеседник', 'туа');
    expect(ids()).toEqual(['2']);
    await type('Собеседник', '27');
    expect(ids()).toEqual(['1']);
    await type('Собеседник', '');
    expect(ids()).toEqual(['1', '2', '3']);
    await close('Собеседник');

    await open('Контакт');
    await type('Контакт', '@TOMSK');
    expect(ids()).toEqual(['1']);
    await type('Контакт', '0000001');
    expect(ids()).toEqual(['1']);
    await type('Контакт', 'ID 3');
    expect(ids()).toEqual(['3']);
    await type('Контакт', '');
    await close('Контакт');

    await open('Что дальше');
    await type('Что дальше', 'ждёт ответа');
    expect(ids()).toEqual(['2']);
    await type('Что дальше', 'пишет');
    expect(ids()).toEqual(['1']);
  });

  it('«Менеджер», «Регион» и «Аккаунт»: значения из строк и подпись для пустого', async () => {
    await draw();
    await open('Менеджер');
    expect(options().map((o) => o.text)).toEqual(['olga2', 'не назначен1']);
    await pick('не назначен');
    expect(ids()).toEqual(['2']);
    await pick('не назначен');
    await close('Менеджер');

    await open('Аккаунт');
    expect(options().map((o) => o.text)).toEqual(['@sender_11', 'Аккаунт #51', 'Аккаунт удалён1']);
    await pick('Аккаунт удалён');
    expect(ids()).toEqual(['3']);

    const defs = dialogFilterDefs(LIST, {}, COLUMNS);
    expect(defs.region.options.map((o) => `${o.label}:${o.count}`)).toEqual(['0077:1', 'не задан:2']);
    expect(defs.actions).toBeUndefined();
  });

  it('«Последнее»: период считается от текущего времени по московским суткам', async () => {
    await draw();
    await open('Последнее');
    const period = (text) => [...popover().querySelectorAll('button[aria-pressed]')].find((b) => b.textContent === text);
    await act(async () => period('Сегодня').click());
    expect(ids()).toEqual(['1']);
    await act(async () => period('Вчера').click());
    expect(ids()).toEqual(['2']);
    await act(async () => period('За 7 дней').click());
    expect(ids()).toEqual(['1', '2']);
    await act(async () => period('За 30 дней').click());
    expect(ids()).toEqual(['1', '2', '3']);
    expect(counter().textContent).toBe('НАЙДЕНО: 3 из 3');
  });

  it('два фильтра складываются через «и»; варианты строятся по всему списку и не пропадают при отборе', async () => {
    await draw();
    await open('Стадия');
    await pick('Разговорились');
    await close('Стадия');
    await open('Ведёт');
    expect(options().map((o) => o.text)).toEqual(['Бот1', 'Менеджер2', 'Клиент ждёт ответа1']);
    await pick('Клиент ждёт ответа');
    expect(ids()).toEqual(['2']);
    expect(counter().textContent).toBe('НАЙДЕНО: 1 из 3');
    await close('Ведёт');
    await open('Стадия');
    expect(options().map((o) => o.text)).toEqual(['Знакомство1', 'Разговорились2']);
  });

  it('выбранная стадия остаётся в списке и с названием, когда её строки ушли', async () => {
    await draw();
    await open('Стадия');
    await pick('Разговорились');
    await draw({ rows: [LIST[0]] });
    expect(ids()).toEqual([]);
    expect(options().map((o) => o.text)).toEqual(['Знакомство1', 'Разговорились0']);
    expect(chips().textContent).toContain('Стадия: Разговорились');
    expect(host.textContent).toContain('Ничего не найдено — сбросьте фильтры');
  });
});

describe('шапка списка: счётчик и плашки фильтров', () => {
  it('без фильтров — «ВСЕГО», кнопка выключена, плашек нет; строка шапки держит высоту', async () => {
    await draw();
    expect(counter().textContent).toBe('ВСЕГО: 3');
    expect(counter().disabled).toBe(true);
    expect(chips()).toBeNull();
    expect(host.querySelector('h2').parentElement.className).toContain('h-8');
    expect(host.querySelector('h2').parentElement.className).not.toContain('flex-wrap');
  });

  it('с фильтром — «НАЙДЕНО: N из M» и плашка между счётчиком и напоминанием', async () => {
    window.sessionStorage.setItem(FILTERS_KEY, JSON.stringify({ stage: ['warm'] }));
    await draw({ headerExtra: <span data-testid="extra">подсказка</span> });
    expect(counter().textContent).toBe('НАЙДЕНО: 2 из 3');
    const order = [...host.querySelector('h2').parentElement.children];
    expect(order[0].tagName).toBe('H2');
    expect(order[1]).toBe(counter());
    expect(order[2]).toBe(chips());
    expect(order[3].querySelector('[data-testid="extra"]')).not.toBeNull();
    expect(chips().textContent).toContain('Стадия: Разговорились');
  });

  it('счётчик сбрасывает все фильтры колонок', async () => {
    window.sessionStorage.setItem(FILTERS_KEY, JSON.stringify({ stage: ['warm'], lead: ['waits'], who: 'оля' }));
    await draw();
    expect(ids()).toEqual(['2']);
    expect(counter().disabled).toBe(false);
    await act(async () => counter().click());
    expect(ids()).toEqual(['1', '2', '3']);
    expect(counter().textContent).toBe('ВСЕГО: 3');
    expect(counter().disabled).toBe(true);
    expect(chips()).toBeNull();
    expect(saved()).toEqual({});
  });

  it('крестик на плашке снимает один фильтр, «Сбросить все» — все', async () => {
    window.sessionStorage.setItem(FILTERS_KEY, JSON.stringify({ stage: ['warm'], lead: ['waits'] }));
    await draw();
    expect(chips().textContent).toContain('Ведёт: Клиент ждёт ответа');
    await act(async () => host.querySelector('button[aria-label="Убрать фильтр: Ведёт"]').click());
    expect(ids()).toEqual(['2', '3']);
    expect(saved()).toEqual({ stage: ['warm'] });
    await act(async () => host.querySelector('button[aria-label="Убрать фильтр: Стадия"]').click());
    expect(ids()).toEqual(['1', '2', '3']);

    await open('Стадия');
    await pick('Знакомство');
    await close('Стадия');
    await open('Ведёт');
    await pick('Бот');
    const all = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Сбросить все');
    await act(async () => all.click());
    expect(ids()).toEqual(['1', '2', '3']);
    expect(chips()).toBeNull();
  });

  it('фильтры восстанавливаются из sessionStorage и переживают обновление списка', async () => {
    window.sessionStorage.setItem(FILTERS_KEY, JSON.stringify({ who: 'настя', last: 'today' }));
    await draw();
    expect(ids()).toEqual(['1']);
    expect(funnel('Собеседник').hasAttribute('data-active')).toBe(true);
    expect(funnel('Последнее').hasAttribute('data-active')).toBe(true);
    expect(chips().textContent).toContain('Собеседник: «настя»');
    expect(chips().textContent).toContain('Последнее: Сегодня');
    await draw({ rows: LIST.map((r) => ({ ...r })) });
    expect(ids()).toEqual(['1']);
  });

  it('фильтр скрытой колонки продолжает работать и виден в плашках', async () => {
    window.localStorage.setItem(COLUMNS_KEY, JSON.stringify({ stage: false }));
    window.sessionStorage.setItem(FILTERS_KEY, JSON.stringify({ stage: ['warm'] }));
    await draw();
    expect(heads()).not.toContain('Стадия');
    expect(ids()).toEqual(['2', '3']);
    expect(chips().textContent).toContain('Стадия: Разговорились');
    expect(counter().textContent).toBe('НАЙДЕНО: 2 из 3');
  });
});

describe('фильтры, страницы и сортировка', () => {
  const many = () =>
    Array.from({ length: 80 }, (_, i) => row(100 + i, { name: `Клиент ${String(i).padStart(2, '0')}`, stage: i < 60 ? KNOCK : WARM }));
  const pager = () => host.querySelector('nav[aria-label="Страницы диалогов"]');
  const current = () => pager().querySelector('[aria-current="page"]').textContent;

  it('смена фильтра возвращает на первую страницу, обновление списка — нет', async () => {
    const list = many();
    await draw({ rows: list });
    await act(async () => pager().querySelector('button[aria-label="Страница 3"]').click());
    expect(current()).toBe('3');
    await open('Стадия');
    await pick('Знакомство');
    expect(current()).toBe('1');
    expect(host.textContent).toContain('Всего: 60 · 1–25');

    await act(async () => pager().querySelector('button[aria-label="Страница 2"]').click());
    await draw({ rows: list.map((r) => ({ ...r })) });
    expect(current()).toBe('2');
    expect(host.textContent).toContain('Всего: 60 · 26–50');
  });

  it('воронка и сортировка — две разные кнопки в одном заголовке', async () => {
    await draw();
    const th = () => funnel('Собеседник').closest('th');
    const sortButton = () => [...th().querySelectorAll('button')].find((b) => b.textContent.includes('Собеседник'));
    expect(th().querySelectorAll('button').length).toBe(2);
    await open('Собеседник');
    expect(th().getAttribute('aria-sort')).toBe('none');
    await type('Собеседник', 'я');
    expect(ids()).toEqual(['1', '2']);
    await act(async () => sortButton().click());
    await act(async () => sortButton().click());
    expect(th().getAttribute('aria-sort')).toBe('descending');
    expect(ids()).toEqual(['2', '1']);
    expect(funnel('Собеседник').hasAttribute('data-active')).toBe(true);
  });
});
