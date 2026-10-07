// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import { ManagersPage } from './Managers';
import { PanelUX } from '../../ui/PanelUX';

vi.mock('../../components/Header/Header', () => ({ default: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root, failEditor;
const users = { roles: ['admin', 'manager'], items: [
  { user_id: 1, username: 'admin', role: 'admin', account_ids: [] },
  { user_id: 2, username: 'manager_test', role: 'manager', region_code: '0077', account_ids: [7] },
  { user_id: 4, username: 'other_manager', role: 'manager', region_code: '0078', account_ids: [8] },
] };
const accounts = [
  { id: 7, username: 'sender_test', phone_e164: '+70000000000', status: 'active', persona_id: 'nastya', manager_username: 'manager_test', region_code: '0077' },
  { id: 8, username: 'taken_test', phone_e164: '+70000000008', status: 'active', persona_id: 'nastya', manager_username: 'other_manager', region_code: '0078' },
];
// GET /api/managers/:id — всё, что нужно окну учётки, одним ответом.
const editors = {
  1: { user_id: 1, username: 'admin', role: 'admin', region_code: null, voicer_id: null, account_ids: [], password: null },
  2: { user_id: 2, username: 'manager_test', role: 'manager', region_code: '0077', voicer_id: null, account_ids: [7], password: 'stored-test-only' },
  3: { user_id: 3, username: 'new_manager', role: 'manager', region_code: '0123', voicer_id: null, account_ids: [], password: 'synthetic-test-only' },
};
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); failEditor = false;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/api/managers') return users;
    if (path === '/api/tg-accounts') return accounts;
    const id = /^\/api\/managers\/(\d+)$/.exec(path)?.[1];
    if (!id) return { user_id: 1, role: 'admin' };
    if (failEditor) throw { status: 500 };
    return editors[id];
  });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const render = async element => act(async () => root.render(element));
const click = async text => act(async () => [...host.querySelectorAll('button')].find(x => x.textContent === text).click());
const input = async (element, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', {bubbles:true}));
});
const choose = async (element, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('change', { bubbles: true }));
});
const openEditor = async id => act(async () => host.querySelector(`[data-manager-id="${id}"] [aria-label="Изменить"]`).click());
const field = name => host.querySelector(`#manager-editor [name="${name}"]`);
// Поле сохранённого пароля (в окне учётки и в окне «Данные для входа») и кнопка-глаз рядом с ним.
const shown = () => host.querySelector('[role=dialog] [name="current-password"]');
const reveal = async () => act(async () => host.querySelector('[aria-label="Показать пароль"]').click());
const alertLine = () => host.querySelector('[role=dialog] [role=alert]');
const submit = async () => act(async () => host.querySelector('#manager-editor').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const button = text => [...host.querySelectorAll('button')].find(x => x.textContent === text);
// Подтверждение рисуется вторым окном поверх окна учётки: его кнопки ищем в последнем диалоге.
const question = () => [...host.querySelectorAll('[role=dialog]')].at(-1);
const answer = async text => act(async () => [...question().querySelectorAll('button')].find(x => x.textContent === text).click());
const page = <><ManagersPage /><PanelUX.FeedbackHost /></>;

test('creates a manager with a leading-zero region and no manually entered password', async () => {
  const post = vi.spyOn(api,'post').mockResolvedValue({...users,created_user_id:3});
  await render(<ManagersPage />); await click('+ Создать учётку');
  const form=host.querySelector('form'); const fields=form.querySelectorAll('input');
  await input(fields[0],'new_manager'); await input(fields[1],'0123');
  await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(post).toHaveBeenCalledWith('/api/managers',{username:'new_manager',role:'manager',region_code:'0123',voicer_id:null});
  expect(api.get).toHaveBeenCalledWith('/api/managers/3');
  expect(host.textContent).toContain('Данные для входа: new_manager');
  // Пароль лежит в обычном текстовом поле и скрыт точками, пока не нажмут «Показать пароль».
  expect(host.querySelector('input[type=password]')).toBeNull();
  expect(shown().value).not.toContain('synthetic');
  await act(async () => host.querySelector('[aria-label="Показать пароль"]').click());
  expect(shown().value).toBe('synthetic-test-only');
});
test('failed region saves retain the editor and typed value', async () => {
  vi.spyOn(api,'put').mockRejectedValue({status:500});
  await render(<ManagersPage />);
  await openEditor(2);
  await input(field('region'),'0999');
  await submit();
  expect(api.put).toHaveBeenCalledWith('/api/managers/2',{region_code:'0999'});
  expect(field('region').value).toBe('0999');
  expect(host.querySelector('[role=alert]').textContent).toContain('Попробуйте ещё раз');
});
test('the editor holds the searchable account assignment', async () => {
  await render(<ManagersPage />);
  expect(host.querySelector('[aria-label^="Назначить аккаунты"]')).toBeNull();
  await openEditor(2);
  expect(host.querySelector('[role=dialog]')).not.toBeNull();
  await input(host.querySelector('[aria-label="Поиск аккаунтов"]'),'not_found');
  expect(host.textContent).toContain('Аккаунты не найдены');
  await input(host.querySelector('[aria-label="Поиск аккаунтов"]'),'sender_test');
  expect(host.querySelector('.mr-assignment-list input')?.checked, host.querySelector('.mr-assignment-list').textContent).toBe(true);
  expect(host.querySelector('.mr-assignment-list').textContent).toContain('У этого менеджера');
  // Enter в поиске не отправляет форму учётки.
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => host.querySelector('[aria-label="Поиск аккаунтов"]').dispatchEvent(enter));
  expect(enter.defaultPrevented).toBe(true);
});

test('the create form opens in a dialog instead of pushing the list down', async () => {
  await render(<ManagersPage />);
  expect(host.querySelector('form')).toBeNull();
  await click('+ Создать учётку');
  expect(host.querySelector('[role=dialog] form[aria-label="Создание учётки"]')).not.toBeNull();
  await click('Отмена');
  expect(host.querySelector('[role=dialog]')).toBeNull();
});
test('the editor shows the stored password and loads everything with a single request', async () => {
  await render(<ManagersPage />);
  expect(host.querySelector('[aria-label="Ещё"]')).toBeNull();
  const before = api.get.mock.calls.length;
  await openEditor(2);
  expect(api.get.mock.calls.slice(before)).toEqual([['/api/managers/2']]);
  expect(host.querySelector('[role=dialog]').textContent).toContain('Учётка: manager_test');
  expect(field('username').value).toBe('manager_test');
  // Скрытый пароль — точки в обычном текстовом поле: полей type=password в окне нет вовсе.
  expect(host.querySelector('[role=dialog] input[type=password]')).toBeNull();
  expect(field('current-password').type).toBe('text');
  expect(field('current-password').hasAttribute('data-masked')).toBe(true);
  expect(field('current-password').value).not.toContain('stored');
  expect(host.querySelector('[role=dialog]').innerHTML).not.toContain('stored-test-only');
  expect(button('Сохранить').disabled).toBe(true);
  await reveal();
  expect(field('current-password').value).toBe('stored-test-only');
  expect(field('current-password').hasAttribute('data-masked')).toBe(false);
  expect(host.querySelector('[role=dialog] input[type=password]')).toBeNull();
  expect(host.querySelector('[aria-label="Скрыть пароль"]')).not.toBeNull();
  await act(async () => host.querySelector('[aria-label="Скрыть пароль"]').click());
  expect(field('current-password').value).not.toContain('stored');
});
test('the editor does not look like a credential form to a password manager', async () => {
  await render(<ManagersPage />);
  await openEditor(2);
  expect(field('username').getAttribute('autocomplete')).toBe('off');
  expect(field('current-password').getAttribute('autocomplete')).toBe('off');
  expect(field('current-password').readOnly).toBe(true);
  expect(field('password').getAttribute('autocomplete')).toBe('new-password');
  expect(host.querySelector('[role=dialog] input[type=password]')).toBeNull();
});
test('the stored password hint has its line from the start, so the answer moves nothing', async () => {
  let release;
  api.get.mockImplementation(path => path === '/api/managers/1' ? new Promise(done => { release = done; }) : Promise.resolve(path === '/api/managers' ? users : path === '/api/tg-accounts' ? accounts : { user_id: 1, role: 'admin' }));
  await render(<ManagersPage />);
  await openEditor(1);
  const messages = () => [...host.querySelectorAll('#manager-editor [data-slot=field-message]')].length;
  const hint = () => field('current-password').closest('[data-slot=field]').querySelector('[data-slot=field-message]');
  const before = messages();
  expect(field('current-password').placeholder).toBe('Загружаем…');
  expect(hint().textContent).toBe('');
  await act(async () => release(editors[1]));
  expect(field('current-password').placeholder).toBe('Не сохранён');
  expect(hint().textContent).toContain('Не сохранён для просмотра');
  expect(hint().firstElementChild.className).toContain('truncate');
  expect(messages()).toBe(before);
  // Пустой логин объясняет, почему «Сохранить» выключена, в строке, которая уже занята.
  await input(field('username'), ' ');
  expect(host.querySelector('#manager-editor').textContent).toContain('Укажите логин');
  expect(messages()).toBe(before);
});
test('a row deletes another account only after confirmation and never offers it for yourself', async () => {
  const remove = vi.spyOn(api, 'delete').mockResolvedValue({ ...users, items: [users.items[0]] });
  await render(page);
  expect(host.querySelector('[data-manager-id="1"] [aria-label="Изменить"]')).not.toBeNull();
  expect(host.querySelector('[data-manager-id="1"] [aria-label="Удалить"]')).toBeNull();
  await act(async () => host.querySelector('[data-manager-id="2"] [aria-label="Удалить"]').click());
  expect(remove).not.toHaveBeenCalled();
  expect(host.querySelector('[role=dialog]').textContent).toContain('Удалить manager_test?');
  await click('Удалить');
  expect(remove).toHaveBeenCalledWith('/api/managers/2');
  expect(host.querySelector('[data-manager-id="2"]')).toBeNull();
});

test('the editor renames the login and sends only what changed', async () => {
  const renamed = { ...users, items: users.items.map(item => item.user_id === 2 ? { ...item, username: 'renamed_manager' } : item) };
  const put = vi.spyOn(api, 'put').mockResolvedValue({ ...renamed, editor: { ...editors[2], username: 'renamed_manager' } });
  await render(<ManagersPage />);
  await openEditor(2);
  await input(field('username'), '   ');
  expect(button('Сохранить').disabled).toBe(true);
  await submit();
  expect(put).not.toHaveBeenCalled();
  await input(field('username'), ' renamed_manager ');
  expect(button('Сохранить').disabled).toBe(false);
  await submit();
  expect(put).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledWith('/api/managers/2', { username: 'renamed_manager' });
  expect(host.querySelector('#manager-editor')).toBeNull();
  expect(host.querySelector('[data-manager-id="2"]').textContent).toContain('renamed_manager');
});
test('the editor sets an explicit password only when it is long enough', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({ ...users, editor: editors[2] });
  await render(<ManagersPage />);
  await openEditor(2);
  await input(field('password'), 'short');
  expect(host.querySelector('#manager-editor').textContent).toContain('Не короче 8 символов');
  expect(button('Сохранить').disabled).toBe(true);
  await submit();
  expect(put).not.toHaveBeenCalled();
  await input(field('password'), 'long-enough-pass');
  await submit();
  expect(put).toHaveBeenCalledWith('/api/managers/2', { password: 'long-enough-pass' });
});
test('the editor creates a new password after confirmation and shows it in place', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({ ...users, editor: { ...editors[2], password: 'regenerated-test-only' } });
  await render(page);
  await openEditor(2);
  await input(field('region'), '0999');
  await click('Создать новый пароль');
  expect(question().textContent).toContain('Прежний пароль перестанет действовать');
  expect(put).not.toHaveBeenCalled();
  await answer('Создать пароль');
  expect(put).toHaveBeenCalledWith('/api/managers/2', { regenerate_password: true });
  // Окно осталось открытым, пароль виден, несохранённая правка региона на месте, второго запроса нет.
  expect(field('current-password').value).toBe('regenerated-test-only');
  expect(field('current-password').hasAttribute('data-masked')).toBe(false);
  expect(field('region').value).toBe('0999');
  expect(button('Сохранить').disabled).toBe(false);
  expect(api.get.mock.calls.filter(([path]) => path === '/api/managers/2')).toHaveLength(1);
});
test('while a new password is being created only that button shows progress', async () => {
  let finish;
  vi.spyOn(api, 'put').mockImplementation(() => new Promise(done => { finish = done; }));
  await render(page);
  await openEditor(2);
  await input(field('region'), '0999');
  await click('Создать новый пароль');
  await answer('Создать пароль');
  expect(button('Создаём…')).toBeDefined();
  expect(button('Создать новый пароль')).toBeUndefined();
  expect(button('Сохранить').disabled).toBe(true);
  expect(button('Сохраняем…')).toBeUndefined();
  await act(async () => finish({ ...users, editor: { ...editors[2], password: 'regenerated-test-only' } }));
  expect(button('Создать новый пароль').disabled).toBe(false);
  expect(button('Сохранить').disabled).toBe(false);
  expect(field('current-password').value).toBe('regenerated-test-only');
});
test('errors sit in one line above the buttons and a successful copy keeps a save error', async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  vi.spyOn(api, 'put').mockRejectedValue({ status: 500 });
  await render(<ManagersPage />);
  await openEditor(2);
  // Ошибка копирования показывается и уходит после удачной попытки.
  await click('Копировать логин + пароль');
  expect(alertLine().textContent).toContain('Не удалось скопировать');
  await click('Копировать логин + пароль');
  expect(writeText).toHaveBeenLastCalledWith('Логин: manager_test\nПароль: stored-test-only\nРегион: 0077');
  expect(alertLine()).toBeNull();
  // Ошибка сохранения: одна строка примитива окна в подвале над кнопками, полный текст — в title.
  await input(field('region'), '0999');
  await submit();
  const line = alertLine();
  expect(line.textContent).toContain('Попробуйте ещё раз');
  expect(line.getAttribute('data-slot')).toBe('dialog-error');
  expect(line.title).toBe(line.textContent);
  expect(line.className).toContain('truncate');
  const footer = host.querySelector('[data-slot=dialog-footer]');
  expect(line.parentElement).toBe(footer);
  expect(footer.firstElementChild).toBe(line);
  expect(host.querySelectorAll('[role=dialog] [data-slot=dialog-error]')).toHaveLength(1);
  // Удачное копирование её не стирает.
  await click('Скопировано');
  expect(writeText).toHaveBeenCalledTimes(3);
  expect(button('Скопировано')).toBeDefined();
  expect(alertLine().textContent).toContain('Попробуйте ещё раз');
  delete navigator.clipboard;
});
test('accounts are saved together with the other fields and a taken account asks first', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({ ...users, editor: editors[2] });
  await render(page);
  await openEditor(2);
  expect(host.querySelector('.mr-assignment-list').textContent).toContain('other_manager');
  await input(field('region'), '0999');
  await act(async () => [...host.querySelectorAll('.mr-assignment-list input')].find(x => x.getAttribute('aria-label') === 'Аккаунт +70000000008').click());
  expect(host.textContent).toContain('Выбрано: 2');
  expect(host.textContent).toContain('Будут переназначены от других менеджеров: 1');
  await submit();
  expect(question().textContent).toContain('Переназначить аккаунты?');
  expect(question().textContent).toContain('@taken_test — от other_manager');
  expect(put).not.toHaveBeenCalled();
  await answer('Переназначить');
  expect(put).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledWith('/api/managers/2', { region_code: '0999', account_ids: [7, 8] });
  expect(host.querySelector('#manager-editor')).toBeNull();
});
test('a role change warns about released accounts and your own role stays locked', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({ ...users, editor: { ...editors[2], role: 'admin', account_ids: [] } });
  await render(page);
  await openEditor(1);
  expect(field('role').disabled).toBe(true);
  expect(field('username').disabled).toBe(false);
  expect(host.querySelector('.mr-assignment-list')).toBeNull();
  expect(host.querySelector('#manager-editor').textContent).toContain('Не сохранён для просмотра');
  expect(host.querySelector('[aria-label="Показать пароль"]').disabled).toBe(true);
  await click('Отмена');
  await openEditor(2);
  await choose(field('role'), 'admin');
  expect(host.querySelector('.mr-assignment-list')).toBeNull();
  await submit();
  expect(question().textContent).toContain('будут освобождены аккаунты: 1');
  await answer('Отмена');
  expect(put).not.toHaveBeenCalled();
  expect(host.querySelector('#manager-editor')).not.toBeNull();
  await submit();
  await answer('Изменить роль');
  expect(put).toHaveBeenCalledWith('/api/managers/2', { role: 'admin', account_ids: [] });
});
test('a manager cannot be saved without a region', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({ ...users, editor: editors[2] });
  await render(<ManagersPage />);
  await openEditor(2);
  await input(field('region'), '');
  expect(host.querySelector('#manager-editor').textContent).toContain('Укажите код региона');
  expect(button('Сохранить').disabled).toBe(true);
  await submit();
  expect(put).not.toHaveBeenCalled();
});
test('a failed load keeps the window in place and offers a retry', async () => {
  failEditor = true;
  await render(<ManagersPage />);
  await openEditor(2);
  expect(host.querySelector('[role=dialog] [role=alert]').textContent).toContain('Попробуйте ещё раз');
  expect(button('Сохранить')).toBeUndefined();
  expect(field('region').disabled).toBe(true);
  // Про пароль ничего не известно: прочерк, без «не сохранён» и без подсказки.
  expect(field('current-password').value).toBe('');
  expect(field('current-password').placeholder).toBe('—');
  expect(host.querySelector('#manager-editor').textContent).not.toMatch(/не сохранён/i);
  expect(field('current-password').closest('[data-slot=field]').querySelector('[data-slot=field-message]').textContent).toBe('');
  expect(host.querySelector('[aria-label="Показать пароль"]').disabled).toBe(true);
  failEditor = false;
  await click('Повторить');
  expect(host.querySelector('[role=dialog] [role=alert]')).toBeNull();
  expect(field('region').disabled).toBe(false);
  await reveal();
  expect(field('current-password').value).toBe('stored-test-only');
  expect(button('Сохранить')).toBeDefined();
});
