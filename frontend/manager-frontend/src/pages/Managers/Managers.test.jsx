// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import { ManagersPage } from './Managers';
import { PanelUX } from '../../ui/PanelUX';

vi.mock('../../components/Header/Header', () => ({ default: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const users = { roles: ['admin', 'manager'], items: [
  { user_id: 1, username: 'admin', role: 'admin', account_ids: [] },
  { user_id: 2, username: 'manager_test', role: 'manager', region_code: '0077', account_ids: [7] },
] };
const accounts = [{ id: 7, username: 'sender_test', phone_e164: '+70000000000', status: 'active', persona_id: 'nastya', manager_username: 'manager_test', region_code: '0077' }];
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/api/managers' ? users : path === '/api/tg-accounts' ? accounts : path.endsWith('/credentials') ? {user_id:3,username:'new_manager',region_code:'0123',password:'synthetic-test-only'} : { user_id: 1, role: 'admin' });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const render = async element => act(async () => root.render(element));
const click = async text => act(async () => [...host.querySelectorAll('button')].find(x => x.textContent === text).click());
const input = async (element, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', {bubbles:true}));
});
test('creates a manager with a leading-zero region and no manually entered password', async () => {
  const post = vi.spyOn(api,'post').mockResolvedValue({...users,created_user_id:3});
  await render(<ManagersPage />); await click('+ Создать учётку');
  const form=host.querySelector('form'); const fields=form.querySelectorAll('input');
  await input(fields[0],'new_manager'); await input(fields[1],'0123');
  await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(post).toHaveBeenCalledWith('/api/managers',{username:'new_manager',role:'manager',region_code:'0123',voicer_id:null});
  expect(host.textContent).toContain('Данные для входа: new_manager');
  expect(host.querySelector('input[type=password]').value).toBe('synthetic-test-only');
});
test('failed region saves retain the editor and typed value', async () => {
  vi.spyOn(api,'put').mockRejectedValue({status:500});
  await render(<ManagersPage />);
  await act(async()=>host.querySelector('[data-manager-id="2"] [aria-label="Изменить"]').click());
  const field=host.querySelector('#manager-editor input'); await input(field,'0999');
  await act(async()=>host.querySelector('#manager-editor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(host.querySelector('#manager-editor input').value).toBe('0999');
  expect(host.querySelector('[role=alert]').textContent).toContain('Попробуйте ещё раз');
});
test('account assignment opens separately with searchable accounts', async () => {
  await render(<ManagersPage />); await act(async()=>host.querySelector('[aria-label="Назначить аккаунты: manager_test"]').click());
  expect(host.querySelector('[role=dialog]')).not.toBeNull();
  await input(host.querySelector('[aria-label="Поиск аккаунтов"]'),'not_found');
  expect(host.textContent).toContain('Аккаунты не найдены');
  await input(host.querySelector('[aria-label="Поиск аккаунтов"]'),'sender_test');
  expect(host.querySelector('.mr-assignment-list input')?.checked, host.querySelector('.mr-assignment-list').textContent).toBe(true);
});

// Меню «Ещё» строки: Radix рисует его порталом в body и позиционирует через ResizeObserver, которого нет в jsdom.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
const openMenu = async id => act(async () => host.querySelector(`[data-manager-id="${id}"] [aria-label="Ещё"]`).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
const menuItem = text => [...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent === text);

test('the create form opens in a dialog instead of pushing the list down', async () => {
  await render(<ManagersPage />);
  expect(host.querySelector('form')).toBeNull();
  await click('+ Создать учётку');
  expect(host.querySelector('[role=dialog] form[aria-label="Создание учётки"]')).not.toBeNull();
  await click('Отмена');
  expect(host.querySelector('[role=dialog]')).toBeNull();
});
test('the row menu opens the credentials dialog', async () => {
  await render(<ManagersPage />); await openMenu(2);
  await act(async () => menuItem('Логин и пароль').click());
  expect(api.get).toHaveBeenCalledWith('/api/managers/2/credentials');
  expect(host.querySelector('[role=dialog]').textContent).toContain('Данные для входа: new_manager');
  await act(async () => host.querySelector('[aria-label="Показать пароль"]').click());
  expect(host.querySelector('[role=dialog] input[type=password]')).toBeNull();
  expect(host.querySelector('[aria-label="Скрыть пароль"]')).not.toBeNull();
});
test('the row menu deletes another account only after confirmation and never offers it for yourself', async () => {
  const remove = vi.spyOn(api, 'delete').mockResolvedValue({ ...users, items: [users.items[0]] });
  await render(<><ManagersPage /><PanelUX.FeedbackHost /></>);
  await openMenu(1);
  expect(menuItem('Логин и пароль')).toBeDefined(); expect(menuItem('Удалить')).toBeUndefined();
  await act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await openMenu(2);
  await act(async () => menuItem('Удалить').click());
  expect(remove).not.toHaveBeenCalled();
  expect(host.querySelector('[role=dialog]').textContent).toContain('Удалить manager_test?');
  await click('Удалить');
  expect(remove).toHaveBeenCalledWith('/api/managers/2');
  expect(host.querySelector('[data-manager-id="2"]')).toBeNull();
});
