// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import { AccountsTable } from './AccountsTable';

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
test('account overview shows manager/region and keeps secondary actions collapsed', async () => {
  await render(<AccountsTable rows={accounts} alive={{}} helpers={{Avatar:()=>null,statusLabel:()=> 'активен',statusClasses:{},date:()=> '—'}} />);
  expect(host.textContent).toContain('manager_test'); expect(host.textContent).toContain('0077');
  expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Удалить')).toBe(false);
  await click('Ещё');
  expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Удалить')).toBe(true);
});
