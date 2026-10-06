// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import { CreateLeadForm } from './CreateLeadForm';

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
const input = async (element, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', {bubbles:true}));
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
