// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Поповер и меню Radix ждут ResizeObserver, которого нет в jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  Link: ({ to, children }) => <a href={to}>{children}</a>,
  NavLink: () => null,
}));
vi.mock('../../api/leads', () => ({
  getLeads: vi.fn(),
  getOutreachStatus: vi.fn(),
  getLeadPersonas: vi.fn(),
  importLeads: vi.fn(),
  startOutreach: vi.fn(async () => ({})),
  stopOutreach: vi.fn(async () => ({})),
  updateLead: vi.fn(async () => ({})),
  writeFromAnother: vi.fn(async () => ({})),
  deleteLead: vi.fn(async () => ({})),
}));
vi.mock('../../api/accounts', () => ({ getAccounts: vi.fn(async () => []) }));

const leadsApi = await import('../../api/leads');
const { default: Leads } = await import('./Leads');

const COUNTS = { pending: 40, queued: 10, assigned: 0, contacted: 6, replied: 4, dead: 0, total: 60 };
const OUTREACH = {
  enabled: true,
  within_hours: true,
  hours_msk: [9, 21],
  daily_per_account: 10,
  min_gap_s: 300,
  accounts: [{ online: true, sent_today: 3 }, { online: true, sent_today: 0 }],
};
const lead = (id, extra = {}) => ({ id, first_name: `Лид ${id}`, phone_e164: `+7900000${String(id).padStart(4, '0')}`, status: 'pending', ...extra });

// Сервер-заглушка как бэкенд рабочей панели: 60 лидов, id по убыванию; один
// status и один deal_stage сужают выборку, отдаются первые limit строк без
// total; counts и stages — по всем лидам. Страницы листает сама панель.
let total;
let rowExtra;
const stageOfRow = (row) => row.deal_stage || 'none';
function serve({ limit = 200, status = '', deal_stage = '' } = {}) {
  const everyone = Array.from({ length: total }, (_, i) => lead(total - i, rowExtra(total - i)));
  const all = everyone
    .filter((row) => !status || row.status === status)
    .filter((row) => !deal_stage || stageOfRow(row) === deal_stage);
  const stages = {};
  for (const row of everyone) stages[stageOfRow(row)] = (stages[stageOfRow(row)] ?? 0) + 1;
  return Promise.resolve({ items: all.slice(0, limit), counts: { ...COUNTS, total }, stages });
}
const QUERY = { status: '', q: '', limit: 1000 };

let host;
let root;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
async function mount() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Leads />));
  await flush();
}
const click = async (el) => { await act(async () => el.click()); await flush(); };
const byLabel = (label, scope = document) => scope.querySelector(`[aria-label="${label}"]`);
const buttonByText = (text, scope = host) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const lastQuery = () => leadsApi.getLeads.mock.calls.at(-1)[0];
const rowIds = () => [...host.querySelectorAll('[data-lead-id]')].map((r) => Number(r.dataset.leadId));
const pagerStatus = () => [...host.querySelectorAll('[role="status"]')].map((n) => n.textContent).find((t) => t.startsWith('Всего: '));
const stage = (label) => [...byLabel('Статус', host).querySelectorAll('button')].find((b) => b.textContent.startsWith(label));
const filterButton = (label) => byLabel(`Фильтр: ${label}`, host);
const popover = () => document.querySelector('[data-slot="popover-content"]');
// Открывает фильтр колонки и переключает галочку у варианта с такой подписью.
const tick = async (column, option) => {
  if (!popover()) await click(filterButton(column));
  const row = [...popover().querySelectorAll('label')].find((l) => l.textContent.startsWith(option));
  await click(row.querySelector('[role="checkbox"]'));
};
// Повторный клик по значку открытого фильтра закрывает его поповер.
const closePopover = async () => {
  const open = host.querySelector('thead button[aria-label^="Фильтр: "][data-state="open"]');
  if (!open) return;
  await click(open);
  // Radix возвращает фокус на значок отложенно; ждём, чтобы он не закрыл следующий поповер.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const chips = () => host.querySelector('[aria-label="Заданные фильтры"]');
const pressed = () => [...byLabel('Статус', host).querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent.replace(/\d+$/, ''));
const openMenu = async (row) => {
  await act(async () => byLabel('Ещё', row).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })));
  await flush();
  return document.querySelector('[role="menu"]');
};

beforeEach(() => {
  total = 60;
  rowExtra = () => ({});
  window.sessionStorage.clear();
  vi.clearAllMocks();
  leadsApi.getLeads.mockReset().mockImplementation(serve);
  leadsApi.getOutreachStatus.mockResolvedValue(OUTREACH);
  leadsApi.getLeadPersonas.mockResolvedValue({ items: [{ slug: 'nastya', name: 'Настя', accounts_ready: 1 }] });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('лиды: постраничный список', () => {
  it('список приходит одним запросом, страницы листаются без нового запроса', async () => {
    await mount();
    expect(lastQuery()).toEqual(QUERY);
    expect(rowIds()).toHaveLength(25);
    expect(rowIds()[0]).toBe(60);
    expect(pagerStatus()).toBe('Всего: 60 · 1–25');

    const calls = leadsApi.getLeads.mock.calls.length;
    await click(byLabel('Страница 2', host));
    expect(leadsApi.getLeads.mock.calls.length).toBe(calls);
    expect(rowIds()[0]).toBe(35);
    expect(pagerStatus()).toBe('Всего: 60 · 26–50');
    expect(byLabel('Страница 2', host).getAttribute('aria-current')).toBe('page');
  });

  it('смена статуса, размера страницы и поиска возвращает на первую страницу', async () => {
    await mount();
    await click(byLabel('Страница 3', host));
    expect(pagerStatus()).toBe('Всего: 60 · 51–60');

    await click(stage('В очереди'));
    expect(lastQuery()).toEqual({ ...QUERY, status: 'queued' });
    expect(stage('В очереди').getAttribute('aria-pressed')).toBe('true');
    expect(byLabel('Страница 1', host).getAttribute('aria-current')).toBe('page');

    total = 120;
    rowExtra = () => ({ status: 'queued' });
    await click(stage('Все'));
    await click(stage('В очереди'));
    await click(byLabel('Страница 2', host));
    const size = byLabel('Строк на странице', host);
    await act(async () => { size.value = '50'; size.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    expect(pagerStatus()).toBe('Всего: 120 · 1–50');

    await click(byLabel('Страница 2', host));
    expect(pagerStatus()).toBe('Всего: 120 · 51–100');
    vi.useFakeTimers();
    const search = byLabel('Поиск лидов', host);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'олег');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(lastQuery()).toEqual({ ...QUERY, status: 'queued', q: 'олег' });
    expect(pagerStatus()).toBe('Всего: 120 · 1–50');
  });

  it('опрос раз в 10 секунд перезапрашивает список и оставляет текущую страницу', async () => {
    vi.useFakeTimers();
    await mount();
    await click(byLabel('Страница 2', host));
    let release;
    leadsApi.getLeads.mockImplementationOnce((query) => new Promise((resolve) => { release = () => serve(query).then(resolve); }));
    const before = leadsApi.getLeads.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(leadsApi.getLeads.mock.calls.length).toBe(before + 1);
    expect(lastQuery()).toEqual(QUERY);
    // Ответ ещё не пришёл — прежние строки на месте, скелета нет.
    expect(rowIds()).toHaveLength(25);
    expect(host.querySelector('[data-slot="skeleton"]')).toBeNull();
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    expect(rowIds()[0]).toBe(35);
  });

  it('старый бэкенд без total: считаем по пришедшим строкам, страница одна', async () => {
    leadsApi.getLeads.mockImplementation(async () => ({ items: [lead(2), lead(1)], counts: { ...COUNTS, total: 2 } }));
    await mount();
    expect(pagerStatus()).toBe('Всего: 2 · 1–2');
    expect(host.querySelectorAll('nav button[aria-label^="Страница "]')).toHaveLength(1);
    expect(byLabel('Предыдущая страница', host).disabled).toBe(true);
    expect(byLabel('Следующая страница', host).disabled).toBe(true);
  });

  it('список стал короче — страница поджимается к последней', async () => {
    await mount();
    await click(byLabel('Страница 3', host));
    expect(pagerStatus()).toBe('Всего: 60 · 51–60');
    total = 30;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    await flush();
    expect(lastQuery()).toEqual(QUERY);
    expect(pagerStatus()).toBe('Всего: 30 · 26–30');
    expect(rowIds()).toHaveLength(5);
  });

  it('ответ прошлого фильтра, пришедший позже, не затирает новый', async () => {
    rowExtra = (id) => (id % 2 ? { status: 'queued' } : {});
    await mount();
    let late;
    leadsApi.getLeads.mockImplementationOnce((query) => new Promise((resolve) => { late = () => serve(query).then(resolve); }));
    await click(stage('В очереди'));
    await click(stage('Все'));
    expect(rowIds()[0]).toBe(60);
    await act(async () => { await late(); });
    await flush();
    expect(rowIds()[0]).toBe(60);
    expect(pressed()).toEqual(['Все']);
  });
});

describe('лиды: фильтры колонок «Статус» и «Этап»', () => {
  // Каждый третий лид ответил, у каждого второго из них этап «Лид», у остальных диалог без этапа.
  const mixed = (id) => (id % 3 === 0
    ? { status: 'replied', telegram_user_id: 1000 + id, deal_stage: id % 2 === 0 ? 'lead' : null, deal_note: id % 2 === 0 ? 'ждёт звонка' : null }
    : id % 3 === 1 ? { status: 'contacted', telegram_user_id: 1000 + id, deal_stage: 'vbros' } : {});

  it('колонка «Этап»: подпись этапа, причина в подсказке, без этапа — прочерк', async () => {
    rowExtra = mixed;
    await mount();
    const cellOf = (id) => {
      const at = [...host.querySelectorAll('thead th')].findIndex((th) => th.textContent.trim() === 'Этап');
      return host.querySelector(`[data-lead-id="${id}"]`).children[at];
    };
    expect(cellOf(60).textContent).toBe('Лид');
    expect(cellOf(60).querySelector('[title]').title).toBe('Лид — ждёт звонка');
    expect(cellOf(58).textContent).toBe('Вброс');
    expect(cellOf(57).textContent).toBe('—');
    expect(cellOf(59).textContent).toBe('—');
  });

  it('у «Статуса» и «Этапа» есть значок фильтра; варианты — с числами из counts и stages', async () => {
    await mount();
    expect([...host.querySelectorAll('thead button[aria-label^="Фильтр: "]')].map((b) => b.getAttribute('aria-label'))).toEqual(['Фильтр: Тип', 'Фильтр: Статус', 'Фильтр: Этап', 'Фильтр: Следующий шаг']);
    await click(filterButton('Статус'));
    expect([...popover().querySelectorAll('label')].map((l) => l.textContent)).toEqual(['В базе40', 'В очереди10', 'Найден0', 'Написали6', 'Ответил4', 'Недоступен0']);
    await closePopover();
    await click(filterButton('Этап'));
    expect([...popover().querySelectorAll('label')].map((l) => l.textContent)).toEqual(['Вброс', 'Предлога', 'Соглас', 'Лид', 'Депозит', 'Архив', 'не указан60']);
  });

  it('фильтр по статусу уходит в запрос, возвращает на первую страницу и подсвечивает сегмент воронки', async () => {
    rowExtra = mixed;
    await mount();
    await click(byLabel('Страница 2', host));
    expect(pagerStatus()).toBe('Всего: 60 · 26–50');

    await tick('Статус', 'Ответил');
    expect(lastQuery()).toEqual({ ...QUERY, status: 'replied' });
    expect(pagerStatus()).toBe('Всего: 20 · 1–20');
    expect(pressed()).toEqual(['Ответил']);
    expect(filterButton('Статус').hasAttribute('data-active')).toBe(true);
    expect(chips().textContent).toContain('Статус: Ответил');
    expect(host.querySelector('[data-testid="leads-found"]').textContent).toBe('Найдено 20 из 60');
    expect(rowIds().every((id) => id % 3 === 0)).toBe(true);
  });

  it('несколько статусов: список через запятую, ни один сегмент воронки не выбран, «Все» тоже', async () => {
    rowExtra = mixed;
    await mount();
    await tick('Статус', 'Ответил');
    await tick('Статус', 'Написали');
    // несколько статусов бэкенд не фильтрует: запрос без статуса, отбор здесь
    expect(lastQuery()).toEqual(QUERY);
    expect(rowIds().every((id) => id % 3 !== 2)).toBe(true);
    expect(pressed()).toEqual([]);
    expect(stage('Все').getAttribute('aria-pressed')).toBe('false');
    expect(chips().textContent).toContain('Статус: Написали, Ответил');
    expect(pagerStatus()).toBe('Всего: 40 · 1–25');

    await tick('Статус', 'Ответил');
    expect(lastQuery()).toMatchObject({ status: 'contacted' });
    expect(pressed()).toEqual(['Написали']);
  });

  it('воронка и фильтр «Статус» — одно состояние: сегмент ставит ровно один статус, «Все» снимает', async () => {
    await mount();
    await tick('Статус', 'Ответил');
    await tick('Статус', 'Написали');
    await closePopover();

    await click(stage('В очереди'));
    expect(lastQuery()).toEqual({ ...QUERY, status: 'queued' });
    expect(pressed()).toEqual(['В очереди']);
    expect(chips().textContent).toContain('Статус: В очереди');
    await click(filterButton('Статус'));
    const checked = [...popover().querySelectorAll('label')].filter((l) => l.querySelector('[role="checkbox"]').getAttribute('aria-checked') === 'true');
    expect(checked.map((l) => l.textContent)).toEqual(['В очереди10']);
    await closePopover();

    await click(stage('Все'));
    expect(lastQuery()).toEqual(QUERY);
    expect(pressed()).toEqual(['Все']);
    expect(chips()).toBeNull();
    expect(filterButton('Статус').hasAttribute('data-active')).toBe(false);
    expect(host.querySelector('[data-testid="leads-found"]')).toBeNull();
  });

  it('фильтр по этапу: один этап — в запрос вместе со статусом, несколько — отбираются здесь', async () => {
    rowExtra = mixed;
    await mount();
    await click(stage('Ответил'));
    await click(byLabel('Страница 1', host));
    await tick('Этап', 'не указан');
    expect(lastQuery()).toEqual({ ...QUERY, status: 'replied', deal_stage: 'none' });
    expect(rowIds().every((id) => id % 6 === 3)).toBe(true);
    await tick('Этап', 'Лид');
    expect(lastQuery()).toEqual({ ...QUERY, status: 'replied' });
    expect(rowIds()).toHaveLength(20);
    expect(chips().textContent).toContain('Этап: Лид, не указан');
    // воронку фильтр по этапу не трогает
    expect(pressed()).toEqual(['Ответил']);
    expect(stage('Все').textContent).toBe('Все60');
  });

  it('плашки снимают фильтр по одному и все сразу', async () => {
    rowExtra = mixed;
    await mount();
    await click(stage('Ответил'));
    await tick('Этап', 'Лид');
    await closePopover();
    expect(host.querySelector('[data-testid="leads-found"]').textContent).toBe('Найдено 10 из 60');

    await click(byLabel('Убрать фильтр: Этап', host));
    expect(lastQuery()).toEqual({ ...QUERY, status: 'replied' });
    expect(chips().textContent).not.toContain('Этап');

    await tick('Этап', 'Лид');
    await closePopover();
    await click(buttonByText('Сбросить все'));
    expect(lastQuery()).toEqual(QUERY);
    expect(chips()).toBeNull();
    expect(pressed()).toEqual(['Все']);
    expect(rowIds()).toHaveLength(25);
  });

  it('строка с плашками держит высоту и без фильтров; поиск остаётся справа', async () => {
    await mount();
    const bar = byLabel('Поиск лидов', host).closest('.min-h-8');
    expect(bar).toBeTruthy();
    expect(chips()).toBeNull();
    await click(stage('Ответил'));
    expect(chips().closest('.min-h-8')).toBe(bar);
    // плашки — слева, перед поиском
    expect(chips().compareDocumentPosition(byLabel('Поиск лидов', host)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('опрос раз в 10 секунд и возврат на страницу сохраняют фильтры', async () => {
    vi.useFakeTimers();
    rowExtra = mixed;
    await mount();
    await click(stage('Ответил'));
    await tick('Этап', 'Лид');
    const before = leadsApi.getLeads.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(leadsApi.getLeads.mock.calls.length).toBe(before + 1);
    expect(lastQuery()).toEqual({ ...QUERY, status: 'replied', deal_stage: 'lead' });
    expect(chips().textContent).toContain('Этап: Лид');

    // Ушли в диалог и вернулись: страница смонтирована заново, фильтры из sessionStorage.
    act(() => root.unmount());
    host.remove();
    await mount();
    expect(leadsApi.getLeads.mock.calls.at(-1)[0]).toEqual({ ...QUERY, status: 'replied', deal_stage: 'lead' });
    expect(pressed()).toEqual(['Ответил']);
    expect(chips().textContent).toContain('Статус: Ответил');
  });

  it('мусор в сохранённых фильтрах в запрос не попадает', async () => {
    window.sessionStorage.setItem('panel_filters_leads', JSON.stringify({ status: ['bogus', 'queued'], stage: ['nope'], other: 'x' }));
    await mount();
    expect(lastQuery()).toEqual({ ...QUERY, status: 'queued' });
    expect(pressed()).toEqual(['В очереди']);
    expect(chips().textContent).not.toContain('Этап');
  });

  it('по фильтру ничего не нашлось — пустое состояние про условия, а не про пустую базу', async () => {
    await mount();
    await tick('Этап', 'Депозит');
    expect(rowIds()).toHaveLength(0);
    expect(host.textContent).toContain('По этим условиям лидов нет. Измените поиск или фильтр.');
    expect(host.querySelector('[data-testid="leads-found"]').textContent).toBe('Найдено 0 из 60');
  });

  it('старый бэкенд без deal_stage: колонка показывает прочерк, страница работает', async () => {
    leadsApi.getLeads.mockImplementation(async () => ({ items: [lead(2), lead(1)], counts: { ...COUNTS, total: 2 } }));
    await mount();
    const at = [...host.querySelectorAll('thead th')].findIndex((th) => th.textContent.trim() === 'Этап');
    expect([...host.querySelectorAll('[data-lead-id]')].map((tr) => tr.children[at].textContent)).toEqual(['—', '—']);
  });
});

describe('лиды: выделение и действия', () => {
  it('выделение переживает смену страницы; шапка выбирает только видимые строки', async () => {
    await mount();
    await click(byLabel('Выбрать лид: Лид 60', host));
    expect(host.textContent).toContain('Выбрано: 1');
    const all = () => byLabel('Выбрать лидов на странице', host);
    expect(all().getAttribute('data-state')).toBe('indeterminate');

    await click(byLabel('Страница 2', host));
    expect(host.textContent).toContain('Выбрано: 1');
    expect(all().getAttribute('data-state')).toBe('unchecked');
    await click(all());
    expect(host.textContent).toContain('Выбрано: 26');
    expect(all().getAttribute('data-state')).toBe('checked');

    await click(buttonByText('В очередь (26)'));
    const ids = leadsApi.startOutreach.mock.calls.at(-1)[0];
    expect(ids).toHaveLength(26);
    expect(ids).toContain(60);
    expect(ids).toContain(35);
    expect(ids).not.toContain(59);
  });

  it('снятие галочки в шапке убирает только строки этой страницы', async () => {
    await mount();
    await click(byLabel('Выбрать лидов на странице', host));
    await click(byLabel('Страница 2', host));
    await click(byLabel('Выбрать лидов на странице', host));
    expect(host.textContent).toContain('Выбрано: 50');
    await click(byLabel('Выбрать лидов на странице', host));
    expect(host.textContent).toContain('Выбрано: 25');
    await click(buttonByText('Снять выделение'));
    expect(host.textContent).not.toContain('Выбрано');
  });

  it('действия строки — иконки с подписью; редкие лежат в меню «Ещё»', async () => {
    rowExtra = (id) => (id === 60 ? { status: 'queued', assigned_account_id: 7, assigned_account_username: 'sender' } : id === 59 ? { status: 'dead' } : id === 58 ? { status: 'replied', telegram_user_id: 555, first_contact_at: 1790000000 } : {});
    await mount();
    const row = (id) => host.querySelector(`[data-lead-id="${id}"]`);

    await click(byLabel('Снять', row(60)));
    expect(leadsApi.stopOutreach).toHaveBeenCalledWith([60]);
    await click(byLabel('Ещё раз', row(59)));
    expect(leadsApi.startOutreach).toHaveBeenCalledWith([59]);
    await click(byLabel('В очередь', row(57)));
    expect(leadsApi.startOutreach).toHaveBeenCalledWith([57]);
    await click(byLabel('Открыть диалог: Лид 58', row(58)));
    expect(navigate).toHaveBeenCalledWith('/conversation/555');
    expect(byLabel('Открыть диалог: Лид 57', row(57))).toBeNull();

    let menu = await openMenu(row(60));
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Написать с другого');
    expect(items[0].textContent).toContain('@sender его больше не возьмёт');
    expect(items[1].textContent).toBe('Удалить');
    expect(items[1].getAttribute('data-variant')).toBe('destructive');
    expect(menu.querySelector('[role="separator"]')).toBeTruthy();
    await click(items[0]);
    expect(leadsApi.writeFromAnother).toHaveBeenCalledWith(60);

    menu = await openMenu(row(57));
    const only = [...menu.querySelectorAll('[role="menuitem"]')];
    expect(only.map((i) => i.textContent)).toEqual(['Удалить']);
    await click(only[0]);
    expect(host.textContent).toContain('Удалить лид +79000000057?');
  });

  it('лид с ошибкой — красная строка, ошибка под статусом; полный текст — в поповере', async () => {
    rowExtra = (id) => (id === 60 ? { status: 'dead', last_error: 'PEER_FLOOD: слишком много запросов' } : {});
    await mount();
    const row = host.querySelector('[data-lead-id="60"]');
    expect(row.dataset.problem).toBe('true');
    expect(row.querySelector('[data-testid="lead-problem"]').textContent).toBe('Ошибка: PEER_FLOOD: слишком много запросов');
    expect(host.querySelector('[data-lead-id="59"]').dataset.problem).toBeUndefined();
    expect(host.querySelector('[data-testid="lead-problems"]').textContent).toContain('1 лид с проблемами');
    // «Показать» включает фильтр, та же ссылка («Показать всех») его снимает.
    const link = () => host.querySelector('[data-testid="lead-problems"] button');
    await click(link());
    expect(link().textContent).toBe('Показать всех');
    expect(host.querySelector('[data-lead-id="59"]')).toBeNull();
    await click(link());
    expect(link().textContent).toBe('Показать');
    expect(host.querySelector('[data-lead-id="59"]')).not.toBeNull();
    expect(host.querySelector('details')).toBeNull();
    expect(byLabel('Подробнее об ошибке: Лид 59', host)).toBeNull();
    await click(byLabel('Подробнее об ошибке: Лид 60', row));
    expect(document.querySelector('[data-slot="popover-content"]').textContent).toContain('PEER_FLOOD: слишком много запросов');
  });
});

describe('лиды: шапка, воронка и окна', () => {
  it('«Запустить прозвон» показывает число лидов в базе и выключена при нуле', async () => {
    await mount();
    const start = [...host.querySelectorAll('button')].find((b) => b.textContent.startsWith('Запустить прозвон'));
    expect(start.textContent).toBe('Запустить прозвон (40)');
    expect(start.disabled).toBe(false);
    await click(start);
    expect(leadsApi.startOutreach).toHaveBeenCalledWith();
  });

  it('воронка: числа по статусам и доля ответивших в подсказке', async () => {
    await mount();
    expect(stage('Все').textContent).toBe('Все60');
    expect(stage('В базе').textContent).toBe('В базе40');
    expect(stage('Ответил').getAttribute('title')).toBe('40% от тех, кому написали');
    expect(stage('Написали').getAttribute('title')).toBeNull();
  });

  it('воронка: никому не писали — подсказки у «Ответил» нет', async () => {
    leadsApi.getLeads.mockImplementation(async () => ({ items: [], total: 0, counts: { ...COUNTS, contacted: 0, replied: 0, total: 0 } }));
    await mount();
    expect(stage('Ответил').getAttribute('title')).toBeNull();
    expect(host.textContent).toContain('Лидов пока нет. Добавьте контакт или импортируйте список.');
  });

  it('строка состояния прозвона: тон и ссылка на аккаунты', async () => {
    await mount();
    const line = () => host.querySelector('[data-testid="outreach-status"]');
    expect(line().dataset.tone).toBe('success');
    expect(line().textContent).toBe('Прозвон работает · 2 акк. онлайн · сегодня 3 из 20');
    expect(line().querySelector('[title]').title).toContain('Лимит 10 в день на аккаунт, пауза 5 мин');

    leadsApi.getOutreachStatus.mockResolvedValue({ ...OUTREACH, within_hours: false });
    await click(stage('В базе'));
    expect(line().dataset.tone).toBe('warning');
    expect(line().textContent).toContain('вне рабочих часов (9:00–21:00 МСК)');

    leadsApi.getOutreachStatus.mockResolvedValue({ ...OUTREACH, accounts: [{ online: false, sent_today: 0 }] });
    await click(stage('Все'));
    expect(line().dataset.tone).toBe('destructive');
    expect(line().querySelector('a').textContent).toBe('Открыть аккаунты →');

    leadsApi.getOutreachStatus.mockResolvedValue({ ...OUTREACH, enabled: false });
    await click(stage('В базе'));
    expect(line().dataset.tone).toBe('destructive');
    expect(line().textContent).toContain('Прозвон выключен');
    expect(line().querySelector('a')).toBeNull();
  });

  it('«Добавить номер» открывает окно «Новый лид» и не трогает страницу под ним', async () => {
    await mount();
    expect(host.querySelector('form[aria-label="Добавление лида"]')).toBeNull();
    await click(buttonByText('Добавить номер'));
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('Новый лид');
    expect(dialog.querySelector('form[aria-label="Добавление лида"]')).toBeTruthy();
    expect(dialog.querySelector('[data-testid="lead-sender"].mr-lead-sender')).toBeTruthy();
    // Окно — не часть потока страницы: внутри .container формы нет.
    expect(host.querySelector('.container form')).toBeNull();
    expect(buttonByText('Добавить', dialog).disabled).toBe(true);
    await click(buttonByText('Отмена', dialog));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('импорт: окно отправляет текст и показывает итог', async () => {
    leadsApi.importLeads.mockResolvedValue({ created: 2, duplicates: 1, errors: ['строка 3: нет контакта'] });
    await mount();
    await click(buttonByText('Импорт списка'));
    const dialog = host.querySelector('[role="dialog"]');
    const area = dialog.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, '+79001234567\n@some_name\n');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(buttonByText('Импортировать (2)', dialog)).toBeTruthy();
    await act(async () => dialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(leadsApi.importLeads).toHaveBeenCalledWith({ text: '+79001234567\n@some_name\n', queue: false, persona_id: '' });
    expect(dialog.textContent).toContain('Добавлено: 2, дублей: 1');
    expect(dialog.textContent).toContain('Пропущено строк: 1');
    await click(buttonByText('Готово', dialog));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
