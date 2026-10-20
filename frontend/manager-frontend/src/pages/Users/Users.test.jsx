// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import Users, { groupByRegion, sortUsers, summary } from './Users';

vi.mock('../../components/Header/Header', () => ({ default: () => null }));
vi.mock('../../components/DateRangePicker/DateRangePicker', async (orig) => ({ ...(await orig()), default: ({ from, to }) => <span data-testid="range">{from}–{to}</span> }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const users = { items: [
  { user_id: 1, username: 'admin', role: 'admin', region_code: null, account_ids: [] },
  { user_id: 6, username: 'boss', role: 'head', region_code: '001', online: true, lead_quota: null, leads_today: 0, leads_count: 0, lead_sources: [], donor_ids: [], donors: [], account_ids: [] },
  { user_id: 2, username: 'm_two', role: 'manager', region_code: '002', online: false, lead_quota: null, leads_today: 0, leads_count: 0, lead_sources: [], donor_ids: [], donors: [], account_ids: [] },
  { user_id: 3, username: 'm_one', role: 'manager', region_code: '001', online: true, lead_quota: 5, leads_today: 3, leads_count: 3, lead_sources: ['beboo'], lead_personas: ['nastya'], donor_ids: [10], donors: ['Camp A'], account_ids: [] },
  { user_id: 5, username: 'm_zero', role: 'manager', region_code: '001', online: false, lead_quota: 0, leads_today: 1, leads_count: 1, lead_sources: [], donor_ids: [], donors: [], account_ids: [] },
  { user_id: 4, username: 'voicer', role: 'voice', region_code: null, account_ids: [] },
] };
const donors = { items: [{ id: 10, name: 'Camp A', managers: 1 }, { id: 11, name: 'Camp B', managers: 0 }] };
const sources = { items: [{ id: 5, name: 'beboo', managers: 1 }, { id: 6, name: 'vk', managers: 0 }] };
const personas = { items: [{ id: 1, slug: 'nastya', name: 'Настя' }, { id: 2, slug: 'olga', name: 'Ольга' }] };
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(api, 'get').mockImplementation(async (path) => path.startsWith('/api/managers') ? JSON.parse(JSON.stringify(users)) : path === '/api/donors' ? donors : path === '/api/sources' ? sources : path === '/api/personas' ? personas : {});
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const render = async (el) => act(async () => root.render(el));
const type = async (input, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

test('summary и groupByRegion', () => {
  expect(summary([])).toBe('любые');
  expect(summary(['a', 'b', 'c', 'd'])).toBe('a, b · ещё 2');
  const g = groupByRegion([{ region_code: null }, { region_code: '002' }, { region_code: '001' }]);
  expect(g.map((x) => x.region)).toEqual(['001', '002', '']);
});

test('группирует по регионам, скрывает войсеров, показывает сводку менеджера', async () => {
  await render(<Users />);
  const regions = [...host.querySelectorAll('.us-region-title')].map((h) => h.textContent);
  expect(regions[0]).toContain('Регион 001');
  expect(regions[2]).toContain('Без региона');
  expect(host.textContent).not.toContain('voicer');
  const row = host.querySelector('[data-user-id="3"]');
  expect(row.getAttribute('data-online')).toBe('1');
  expect(row.querySelector('input[aria-label="Лимит клиентов в сутки: m_one"]').value).toBe('5');
  expect(row.querySelector('[aria-label="Источники: m_one"]').textContent).toContain('beboo');
  expect(row.querySelector('[aria-label="Доноры: m_one"]').textContent).toContain('Camp A');
  expect(host.textContent).toContain('Онлайн: 2');
  expect(host.querySelector('[data-user-id="6"] [role=switch]')).not.toBeNull();
  expect(host.querySelector('[data-user-id="1"] [role=switch]')).toBeNull();
});

test('онлайн и лимит сохраняются сразу; ± шагают, минус с нуля снимает лимит', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue(users);
  await render(<Users />);
  const row = host.querySelector('[data-user-id="2"]');
  await act(async () => row.querySelector('[role=switch]').click());
  expect(put).toHaveBeenCalledWith('/api/managers/2', { online: true });
  const quota = row.querySelector('input[aria-label="Лимит клиентов в сутки: m_two"]');
  expect(quota.placeholder).toBe('∞');
  await type(quota, '7');
  await act(async () => quota.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(put).toHaveBeenLastCalledWith('/api/managers/2', { lead_quota: 7 });
  await act(async () => row.querySelector('[aria-label="Больше: m_two"]').click());
  expect(put).toHaveBeenLastCalledWith('/api/managers/2', { lead_quota: 8 });
  const zero = host.querySelector('[data-user-id="5"]');
  expect(zero.querySelector('input').value).toBe('0');
  await act(async () => zero.querySelector('[aria-label="Меньше: m_zero"]').click());
  expect(put).toHaveBeenLastCalledWith('/api/managers/5', { lead_quota: null });
  expect(host.querySelector('[data-testid="leads-count-3"]').textContent).toBe('3');
});

test('сортировка по онлайн и по полученным сегодня', async () => {
  const rows = [
    { username: 'b', role: 'manager', online: false, leads_count: 5 },
    { username: 'a', role: 'manager', online: true, leads_count: 0 },
    { username: 'h', role: 'head' },
  ];
  expect(sortUsers(rows, { col: 'online', dir: 'desc' }).map((u) => u.username)).toEqual(['a', 'b', 'h']);
  expect(sortUsers(rows, { col: 'leads_count', dir: 'desc' }).map((u) => u.username)).toEqual(['b', 'a', 'h']);
  expect(sortUsers(rows, { col: 'leads_count', dir: 'asc' }).map((u) => u.username)).toEqual(['a', 'h', 'b']);
  await render(<Users />);
  const th = [...host.querySelectorAll('th')].find((x) => x.textContent.includes('Получено сегодня'));
  await act(async () => th.querySelector('button').click());
  expect(th.getAttribute('aria-sort')).toBe('descending');
  const names = [...host.querySelectorAll('tbody[aria-label="Регион 001"] tr.us-row')].map((tr) => tr.querySelector('strong').textContent);
  expect(names).toEqual(['m_one', 'm_zero', 'boss']);
});

test('доноры выбираются в попапе с поиском', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue(users);
  await render(<Users />);
  await act(async () => host.querySelector('[aria-label="Доноры: m_one"]').click());
  const dialog = host.querySelector('[role=dialog]');
  expect(dialog.textContent).toContain('Доноры: m_one');
  const boxes = dialog.querySelectorAll('input[type=checkbox]');
  expect(boxes.length).toBe(2);
  expect(boxes[0].checked).toBe(true);
  await act(async () => boxes[1].click());
  await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Сохранить').click());
  expect(put).toHaveBeenCalledWith('/api/managers/3', { donor_ids: [10, 11] });
  expect(host.querySelector('[role=dialog]')).toBeNull();
});

test('источники выбираются из справочника и уходят именами', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue(users);
  await render(<Users />);
  await act(async () => host.querySelector('[aria-label="Источники: m_two"]').click());
  const dialog = host.querySelector('[role=dialog]');
  await type(dialog.querySelector('input[type=search]'), 'vk');
  const boxes = dialog.querySelectorAll('input[type=checkbox]');
  expect(boxes.length).toBe(1);
  await act(async () => boxes[0].click());
  await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Сохранить').click());
  expect(put).toHaveBeenCalledWith('/api/managers/2', { lead_sources: ['vk'] });
});

test('фильтр по региону и запрос с периодом', async () => {
  await render(<Users />);
  expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/managers\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/));
  const select = host.querySelector('[aria-label="Регион"]');
  expect([...select.options].map((o) => o.value)).toEqual(['', '001', '002', 'none']);
  await act(async () => {
    select.value = '002';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect([...host.querySelectorAll('.us-region-title')].map((h) => h.textContent)).toHaveLength(1);
  expect(host.textContent).toContain('m_two');
  expect(host.textContent).not.toContain('m_one');
});

test('личности: имя в строке, выбор в попапе уходит slug-ами', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue(users);
  await render(<Users />);
  expect(host.querySelector('[aria-label="Личности: m_one"]').textContent).toBe('Настя');
  expect(host.querySelector('[aria-label="Личности: m_two"]').textContent).toBe('любые');
  await act(async () => host.querySelector('[aria-label="Личности: m_two"]').click());
  const dialog = host.querySelector('[role=dialog]');
  expect(dialog.textContent).toContain('Ольга');
  const boxes = dialog.querySelectorAll('input[type=checkbox]');
  await act(async () => boxes[1].click());
  await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Сохранить').click());
  expect(put).toHaveBeenCalledWith('/api/managers/2', { lead_personas: ['olga'] });
});

test('кнопки ± не отбирают фокус у поля лимита, чтобы набранное число не сохранялось раньше клика', async () => {
  await render(<Users />);
  const row = host.querySelector('[data-user-id="3"]');
  for (const label of ['Больше: m_one', 'Меньше: m_one']) {
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    row.querySelector(`[aria-label="${label}"]`).dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  }
});

test('сохранение в другой строке не стирает лимит, который печатают', async () => {
  vi.spyOn(api, 'put').mockResolvedValue(users);
  await render(<Users />);
  const quota = host.querySelector('input[aria-label="Лимит клиентов в сутки: m_two"]');
  await type(quota, '12');
  await act(async () => host.querySelector('[data-user-id="3"] [role=switch]').click());
  expect(host.querySelector('input[aria-label="Лимит клиентов в сутки: m_two"]').value).toBe('12');
});

test('источник, которого нет в справочнике, виден в попапе и не пропадает при сохранении', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue(users);
  const manager = users.items.find((u) => u.user_id === 3);
  manager.lead_sources = ['beboo', 'legacy-x'];
  try {
    await render(<Users />);
    await act(async () => host.querySelector('[aria-label="Источники: m_one"]').click());
    const dialog = host.querySelector('[role=dialog]');
    expect(dialog.textContent).toContain('legacy-x');
    expect(dialog.textContent).toContain('нет в справочнике');
    const boxes = [...dialog.querySelectorAll('input[type=checkbox]')];
    expect(boxes.map((b) => b.checked)).toEqual([true, false, true]);
    await act(async () => boxes[1].click());
    await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Сохранить').click());
    expect(put).toHaveBeenCalledWith('/api/managers/3', { lead_sources: ['beboo', 'vk', 'legacy-x'] });
  } finally {
    manager.lead_sources = ['beboo'];
  }
});
