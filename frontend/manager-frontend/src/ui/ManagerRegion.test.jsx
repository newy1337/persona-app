// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../api/client';
import { ManagersPage, CreateLeadForm, AccountsTable } from './ManagerRegion';
import { PanelUX } from './PanelUX';

vi.mock('../components/Header/Header', () => ({ default: () => null }));
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
  await act(async()=>[...host.querySelectorAll('[data-manager-id="2"] button')].find(b=>b.textContent==='Изменить').click());
  const field=host.querySelector('#manager-editor input'); await input(field,'0999');
  await act(async()=>host.querySelector('#manager-editor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(host.querySelector('#manager-editor input').value).toBe('0999');
  expect(host.querySelector('[role=alert]').textContent).toContain('Попробуйте ещё раз');
});
test('account assignment opens separately with searchable accounts', async () => {
  await render(<ManagersPage />); await click('Назначить');
  expect(host.querySelector('[role=dialog]')).not.toBeNull();
  await input(host.querySelector('[aria-label="Поиск аккаунтов"]'),'not_found');
  expect(host.textContent).toContain('Аккаунты не найдены');
  await input(host.querySelector('[aria-label="Поиск аккаунтов"]'),'sender_test');
  expect(host.querySelector('.mr-assignment-list input')?.checked, host.querySelector('.mr-assignment-list').textContent).toBe(true);
});
test('a selected Telegram sender is submitted with its persona; automatic remains available', async () => {
  const post=vi.spyOn(api,'post').mockResolvedValue({ok:true});
  const Select=({onChange})=><select onChange={e=>onChange(e.target.value)}><option value="">Любая</option></select>;
  await render(<CreateLeadForm personas={[{slug:'nastya',name:'Настя'}]} PersonaSelect={Select} onDone={()=>{}} onCancel={()=>{}} />);
  await input(host.querySelector('input'),'@test_contact');
  const sender=host.querySelector('.mr-lead-sender select');
  expect(sender.value).toBe('');
  await act(async()=>{sender.value='7';sender.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(post).toHaveBeenCalledWith('/api/leads',expect.objectContaining({preferred_account_id:7,persona_id:'nastya'}));
});
test('account overview shows manager/region and keeps secondary actions collapsed', async () => {
  await render(<AccountsTable rows={accounts} alive={{}} helpers={{Avatar:()=>null,statusLabel:()=> 'активен',statusClasses:{},date:()=> '—'}} />);
  expect(host.textContent).toContain('manager_test'); expect(host.textContent).toContain('0077');
  expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Удалить')).toBe(false);
  await click('Ещё');
  expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Удалить')).toBe(true);
});
test('failed lead deletion stays open and supports retry', async () => {
  const confirm=vi.fn().mockRejectedValueOnce({status:500}).mockResolvedValueOnce({ok:true});
  await render(<PanelUX.DeleteLeadModal lead={{id:1,username:'test'}} onCancel={()=>{}} onConfirm={confirm} />);
  await click('Удалить'); expect(host.querySelector('[role=dialog]')).not.toBeNull();
  expect(host.querySelector('[role=alert]').textContent).toContain('Попробуйте ещё раз');
  await click('Удалить'); expect(confirm).toHaveBeenCalledTimes(2);
});
