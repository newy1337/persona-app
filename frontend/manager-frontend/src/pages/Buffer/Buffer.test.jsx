// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import Buffer from './Buffer';
import { ReassignSwitch } from '../../ui/ReassignSwitch';

import { MeContext } from '../../components/AppLayout/me';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
// Роль страница берёт из общего контекста (раньше — своим запросом /auth/me).
const render = async (el, me = { role: 'head' }) => act(async () => root.render(<MeContext.Provider value={me}>{el}</MeContext.Provider>));
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const items = [
  { id: 1, username: 'alpha', first_name: 'Альфа', age: 25, city: 'Казань', region_code: '001', donor: 'camp', source: 'beboo', person: 'nastya', account: null, external_id: 'e1', profile_url: 'javascript:alert(1)', last_messages: 'привет', reassigned: true, buffered_at: 1792400000, declined_before: null },
  { id: 2, username: 'beta', first_name: null, region_code: '001', donor: 'camp', source: 'api', reassigned: false, buffered_at: 1792400100, declined_before: { count: 2, last_at: 1792300000, last_reason: 'спам' } },
];

test('буфер: строки, пометки «перезабив» и «уже отклоняли», опасная ссылка не рисуется', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (p) => (p.startsWith('/api/buffer') ? { items, total: 2 } : { role: 'head' }));
  await render(<Buffer />);
  await flush();
  expect(host.textContent).toContain('в буфере: 2');
  const rows = host.querySelectorAll('[data-buffer-id]');
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain('перезабив');
  expect([...host.querySelectorAll('a')].some((a) => /^javascript:/i.test(a.getAttribute('href') || ''))).toBe(false);
  expect(rows[1].querySelector('[data-testid="declined-before"]').textContent).toContain('Уже отклоняли 2 раза');
  expect(host.querySelector('[aria-label="Регион"]')).toBeNull();
});

test('взять в работу и отклонить с причиной', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (p) => (p.startsWith('/api/buffer') ? { items, total: 2 } : { role: 'admin' }));
  const post = vi.spyOn(api, 'post').mockImplementation(async (p) => ({ items: items.filter((x) => !p.includes(`/${x.id}/`)), total: 1 }));
  await render(<Buffer />, { role: 'admin' });
  await flush();
  expect(host.querySelector('[aria-label="Регион"]')).not.toBeNull();
  await act(async () => [...host.querySelectorAll('[data-buffer-id="1"] button')].find((b) => b.textContent === 'Взять в работу').click());
  expect(post).toHaveBeenCalledWith('/api/buffer/1/take', {});
  await act(async () => [...host.querySelectorAll('[data-buffer-id="2"] button')].find((b) => b.textContent === 'Отклонить').click());
  const dialog = host.querySelector('[role=dialog]');
  const input = dialog.querySelector('[aria-label="Причина отклонения"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'дубль');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Отклонить').click());
  expect(post).toHaveBeenCalledWith('/api/buffer/2/decline', { reason: 'дубль' });
  expect(host.querySelector('[role=dialog]')).toBeNull();
});

test('переключатель перезабива спрашивает и сохраняет', async () => {
  vi.spyOn(PanelUX, 'confirm').mockResolvedValue(true);
  const put = vi.spyOn(api, 'put').mockResolvedValue({ region_code: '001', accept_reassigned: true });
  const onChange = vi.fn();
  await render(<ReassignSwitch region="001" value={false} onChange={onChange} />);
  const btn = host.querySelector('[data-testid="reassign-001"]');
  expect(btn.textContent).toBe('Получать перезабив');
  await act(async () => btn.click());
  expect(put).toHaveBeenCalledWith('/api/region-settings/001', { accept_reassigned: true });
  expect(onChange).toHaveBeenCalledWith({ region_code: '001', accept_reassigned: true });
});
