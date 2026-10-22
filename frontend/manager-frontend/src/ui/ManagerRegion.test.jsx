// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../api/client';
import { ManagersPage, CreateLeadForm, AccountsTable, LeadsTable } from './ManagerRegion';
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
  expect(post).toHaveBeenCalledWith('/api/managers',{username:'new_manager',role:'manager',region_code:'0123',voicer_id:null,lead_id:null});
  expect(host.textContent).toContain('Данные для входа: new_manager');
  expect(host.querySelector('input[type=password]').value).toBe('synthetic-test-only');
});
test('failed region saves retain the editor and typed value', async () => {
  vi.spyOn(api,'put').mockRejectedValue({status:500});
  await render(<ManagersPage />);
  await act(async()=>[...host.querySelectorAll('[data-manager-id="2"] button')].find(b=>b.textContent==='Изменить').click());
  const field=host.querySelector('#manager-editor input[inputmode=numeric]'); await input(field,'0999');
  await act(async()=>host.querySelector('#manager-editor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(host.querySelector('#manager-editor input[inputmode=numeric]').value).toBe('0999');
  expect(host.querySelector('[role=alert]').textContent).toContain('Попробуйте ещё раз');
});
test('admin renames a manager login from the editor; empty login blocks save', async () => {
  const put=vi.spyOn(api,'put').mockResolvedValue(users);
  await render(<ManagersPage />);
  await act(async()=>[...host.querySelectorAll('[data-manager-id="2"] button')].find(b=>b.textContent==='Изменить').click());
  const login=host.querySelector('#manager-editor input[aria-label="Логин"]');
  expect(login.value).toBe('manager_test');
  await input(login,'   ');
  expect(host.textContent).toContain('Логин не может быть пустым');
  await input(login,'manager_renamed');
  await act(async()=>host.querySelector('#manager-editor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(put).toHaveBeenCalledWith('/api/managers/2',expect.objectContaining({username:'manager_renamed',role:'manager',region_code:'0077'}));
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

test('ссылка на профиль лида: http(s) — ссылкой, javascript: — просто текстом', async () => {
  const row = (id, profile_url) => ({ id, status: 'pending', username: `u${id}`, profile_url, inbound_at: 1, source_type: 'api' });
  await render(<LeadsTable rows={[row(1, 'https://example.com/u/1'), row(2, 'javascript:alert(1)')]} selected={new Set()} personas={[]}
    onToggle={() => {}} onSelectVisible={() => {}} onClearSelection={() => {}} onChat={() => {}} onQueue={() => {}} onUnqueue={() => {}} onReassign={() => {}} onDelete={() => {}} onPersonaChange={() => {}}
    helpers={{ PersonaSelect: () => null, statusLabels: {}, statusClasses: {}, date: () => '' }} />);
  const links = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  expect(links).toContain('https://example.com/u/1');
  expect(links.some((href) => /^javascript:/i.test(href || ''))).toBe(false);
  expect(host.querySelector('[data-testid="profile-text"]').textContent).toBe('javascript:alert(1)');
});

test('галочка «Может менять образы» не растягивается: у строки свой класс, правило задаёт ей фиксированный размер', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const css = readFileSync(fileURLToPath(import.meta.url).replace(/ManagerRegion\.test\.jsx$/, 'manager-region.css'), 'utf8');
  expect(css).toMatch(/\.mr-manager-form label\.mr-check-row input\[type=checkbox\]\{[^}]*width:17px/);
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/api/managers' ? { ...users, items: [...users.items, { user_id: 9, username: 'boss', role: 'head', region_code: '0123', account_ids: [] }] } : path === '/api/tg-accounts' ? accounts : { user_id: 1, role: 'admin' });
  await render(<ManagersPage />);
  await act(async () => [...host.querySelectorAll('[data-manager-id="9"] button')].find(b => b.textContent === 'Изменить').click());
  const row = host.querySelector('#manager-editor label.mr-check-row');
  expect(row).not.toBeNull();
  expect(row.textContent).toContain('Может менять образы');
});

test('хед записывает лид на менеджера команды: аккаунты — только его, owner_user_id уходит в запрос', async () => {
  const owners = { items: [
    { user_id: 9, username: 'boss', role: 'head', region_code: '0077', account_ids: [], self: true },
    { user_id: 2, username: 'manager_test', role: 'manager', region_code: '0077', account_ids: [7] },
    { user_id: 3, username: 'empty_manager', role: 'manager', region_code: '0077', account_ids: [] },
  ] };
  api.get.mockImplementation(async path => path === '/api/leads/owners' ? owners : path === '/api/tg-accounts' ? accounts : {});
  const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true });
  const Select = ({ onChange }) => <select onChange={e => onChange(e.target.value)}><option value="">Любая</option></select>;
  await render(<CreateLeadForm personas={[{ slug: 'nastya', name: 'Настя' }]} PersonaSelect={Select} onDone={() => {}} onCancel={() => {}} />);
  const ownerSelect = host.querySelector('select[aria-label="Чей лид"]');
  expect([...ownerSelect.options].map(o => o.textContent)).toEqual(['Себе (boss)', 'manager_test · менеджер · регион 0077', 'empty_manager · менеджер · регион 0077']);
  const pick = async (el, value) => act(async () => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await pick(ownerSelect, '3');
  expect([...host.querySelectorAll('.mr-lead-sender option')].map(o => o.value)).toEqual(['']);
  expect(host.textContent).toContain('У empty_manager нет включённых аккаунтов');
  await pick(ownerSelect, '2');
  await pick(host.querySelector('.mr-lead-sender select'), '7');
  await input(host.querySelector('input'), '@test_contact');
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(post).toHaveBeenCalledWith('/api/leads', expect.objectContaining({ owner_user_id: 2, preferred_account_id: 7 }));
});

test('менеджеру выбор «Чей лид» не показывается, owner_user_id не уходит', async () => {
  api.get.mockImplementation(async path => path === '/api/leads/owners' ? { items: [{ user_id: 2, username: 'manager_test', role: 'manager', account_ids: [7], self: true }] } : path === '/api/tg-accounts' ? accounts : {});
  const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true });
  await render(<CreateLeadForm personas={[{ slug: 'nastya', name: 'Настя' }]} PersonaSelect={() => null} onDone={() => {}} onCancel={() => {}} />);
  expect(host.querySelector('select[aria-label="Чей лид"]')).toBeNull();
  await input(host.querySelector('input'), '@test_contact');
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(post.mock.calls[0][1].owner_user_id).toBeUndefined();
});
