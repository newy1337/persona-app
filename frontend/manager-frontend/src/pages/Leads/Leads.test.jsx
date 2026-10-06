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

// Сервер-заглушка: 60 лидов, id по убыванию; отдаёт страницу по limit / offset.
let total;
let rowExtra;
function serve({ limit = 200, offset = 0 } = {}) {
  const all = Array.from({ length: total }, (_, i) => lead(total - i, rowExtra(total - i)));
  return Promise.resolve({ items: all.slice(offset, offset + limit), total, counts: { ...COUNTS, total } });
}

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
const openMenu = async (row) => {
  await act(async () => byLabel('Ещё', row).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })));
  await flush();
  return document.querySelector('[role="menu"]');
};

beforeEach(() => {
  total = 60;
  rowExtra = () => ({});
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
  it('первая страница — limit 25, offset 0; переход по номеру просит следующую', async () => {
    await mount();
    expect(lastQuery()).toEqual({ status: '', q: '', limit: 25, offset: 0 });
    expect(rowIds()).toHaveLength(25);
    expect(rowIds()[0]).toBe(60);
    expect(pagerStatus()).toBe('Всего: 60 · 1–25');

    await click(byLabel('Страница 2', host));
    expect(lastQuery()).toMatchObject({ limit: 25, offset: 25 });
    expect(rowIds()[0]).toBe(35);
    expect(pagerStatus()).toBe('Всего: 60 · 26–50');
    expect(byLabel('Страница 2', host).getAttribute('aria-current')).toBe('page');
  });

  it('смена статуса, размера страницы и поиска возвращает на первую страницу', async () => {
    await mount();
    await click(byLabel('Страница 3', host));
    expect(lastQuery()).toMatchObject({ offset: 50 });

    await click(stage('В очереди'));
    expect(lastQuery()).toEqual({ status: 'queued', q: '', limit: 25, offset: 0 });
    expect(stage('В очереди').getAttribute('aria-pressed')).toBe('true');

    await click(byLabel('Страница 2', host));
    const size = byLabel('Строк на странице', host);
    await act(async () => { size.value = '50'; size.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    expect(lastQuery()).toEqual({ status: 'queued', q: '', limit: 50, offset: 0 });

    await click(byLabel('Страница 2', host));
    expect(lastQuery()).toMatchObject({ offset: 50 });
    vi.useFakeTimers();
    const search = byLabel('Поиск лидов', host);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'олег');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(lastQuery()).toEqual({ status: 'queued', q: 'олег', limit: 50, offset: 0 });
  });

  it('опрос раз в 10 секунд перезапрашивает текущую страницу и не убирает строки', async () => {
    vi.useFakeTimers();
    await mount();
    await click(byLabel('Страница 2', host));
    let release;
    leadsApi.getLeads.mockImplementationOnce((query) => new Promise((resolve) => { release = () => serve(query).then(resolve); }));
    const before = leadsApi.getLeads.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(leadsApi.getLeads.mock.calls.length).toBe(before + 1);
    expect(lastQuery()).toMatchObject({ limit: 25, offset: 25 });
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
    expect(lastQuery()).toMatchObject({ limit: 25, offset: 25 });
    expect(pagerStatus()).toBe('Всего: 30 · 26–30');
    expect(rowIds()).toHaveLength(5);
  });

  it('ответ прошлой страницы, пришедший позже, не затирает новую', async () => {
    await mount();
    let late;
    leadsApi.getLeads.mockImplementationOnce((query) => new Promise((resolve) => { late = () => serve(query).then(resolve); }));
    await click(byLabel('Страница 2', host));
    await click(byLabel('Страница 3', host));
    expect(rowIds()[0]).toBe(10);
    await act(async () => { await late(); });
    await flush();
    expect(rowIds()[0]).toBe(10);
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

  it('текст ошибки открывается в поповере, строка таблицы его не содержит', async () => {
    rowExtra = (id) => (id === 60 ? { status: 'dead', last_error: 'PEER_FLOOD: слишком много запросов' } : {});
    await mount();
    const row = host.querySelector('[data-lead-id="60"]');
    expect(row.textContent).not.toContain('PEER_FLOOD');
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
