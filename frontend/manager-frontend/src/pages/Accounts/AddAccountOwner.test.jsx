// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const api = vi.hoisted(() => ({ owners: null, added: [] }));
vi.mock('../../api/accounts', async (orig) => ({
  ...(await orig()),
  getAccountOwners: () => Promise.resolve(api.owners),
  addAccount: (body) => { api.added.push(body); return Promise.resolve({ id: 1 }); },
}));
const { AddForm } = await import('./Accounts');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); api.added = []; });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const personas = [{ slug: 'nastya', name: 'Настя', enabled: true }];
const typePhone = (value) => {
  const input = host.querySelector('input[placeholder="+79001234567"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const pick = (select, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

test('тимлиду менеджер обязателен: без выбора «Добавить» неактивна, выбранный уходит в manager_id', async () => {
  api.owners = { required: true, items: [{ id: 7, username: 'rg-man', region_code: '734' }] };
  await act(async () => root.render(<AddForm personas={personas} onDone={() => {}} onCancel={() => {}} />));
  await act(async () => typePhone('+79001230011'));
  const submit = host.querySelector('button[type=submit]');
  expect(submit.disabled).toBe(true);
  const select = host.querySelector('select[aria-label="Менеджер"]');
  expect(select.textContent).toContain('rg-man (734)');
  await act(async () => pick(select, '7'));
  expect(submit.disabled).toBe(false);
  await act(async () => submit.click());
  expect(api.added).toEqual([expect.objectContaining({ phone_e164: '+79001230011', manager_id: 7 })]);
});

test('менеджеру выбора нет — аккаунт его', async () => {
  api.owners = { required: false, items: [] };
  await act(async () => root.render(<AddForm personas={personas} onDone={() => {}} onCancel={() => {}} />));
  expect(host.querySelector('select[aria-label="Менеджер"]')).toBeNull();
  await act(async () => typePhone('+79001230012'));
  await act(async () => host.querySelector('button[type=submit]').click());
  expect(api.added[0]).not.toHaveProperty('manager_id');
});
