// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../api/client';
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
test('failed lead deletion stays open and supports retry', async () => {
  const confirm=vi.fn().mockRejectedValueOnce({status:500}).mockResolvedValueOnce({ok:true});
  await render(<PanelUX.DeleteLeadModal lead={{id:1,username:'test'}} onCancel={()=>{}} onConfirm={confirm} />);
  await click('Удалить'); expect(host.querySelector('[role=dialog]')).not.toBeNull();
  expect(host.querySelector('[role=alert]').textContent).toContain('Попробуйте ещё раз');
  await click('Удалить'); expect(confirm).toHaveBeenCalledTimes(2);
});
