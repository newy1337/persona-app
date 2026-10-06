// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import Accounts from './Accounts';
import { addAccount, getAccounts } from '../../api/accounts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../api/accounts', () => ({
  addAccount: vi.fn(async () => ({ id: 9 })),
  deleteAccount: vi.fn(),
  getAccounts: vi.fn(),
  clearAccountFlood: vi.fn(),
  getLiveState: vi.fn(async () => ({ tg_accounts: [{ id: 7, alive: true }] })),
  setAccountStatus: vi.fn(),
  setAccountProxy: vi.fn(),
  authFlow: {},
}));
vi.mock('../../api/personas', () => ({
  getPersonas: vi.fn(async () => ({ items: [{ slug: 'nastya', name: 'Настя', enabled: true }] })),
}));
vi.mock('../../api/leads', () => ({ getLeadPersonas: vi.fn(async () => ({ items: [] })) }));

const account = { id: 7, display_name: 'Настя', username: 'sender_test', phone_e164: '+70000000000', status: 'active', persona_id: 'nastya' };
let host;
let root;

const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const type = async (input, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test('первая загрузка: заглушка, затем таблица в том же блоке', async () => {
  let resolve;
  getAccounts.mockReturnValue(new Promise((r) => { resolve = r; }));
  await act(async () => root.render(<Accounts />));
  expect(host.querySelector('h1').textContent).toBe('Аккаунты');
  expect(host.querySelector('[aria-label="Загрузка аккаунтов"]')).toBeTruthy();

  await act(async () => resolve([account]));
  expect(host.querySelector('[aria-label="Загрузка аккаунтов"]')).toBeNull();
  expect(host.querySelector('tr[data-account-id="7"] [role="img"]').getAttribute('aria-label')).toBe('В сети');
});

test('«Добавить аккаунт» открывает окно; форма отправляет те же данные и закрывается', async () => {
  getAccounts.mockResolvedValue([account]);
  await act(async () => root.render(<Accounts />));
  expect(host.querySelector('[role="dialog"]')).toBeNull();

  await act(async () => button('Добавить аккаунт').click());
  const dialog = host.querySelector('[role="dialog"]');
  expect(dialog.textContent).toContain('Новый аккаунт');
  const submit = button('Добавить');
  expect(submit.disabled).toBe(true);

  await type(dialog.querySelector('input[placeholder="+79001234567"]'), '+79001234567');
  expect(submit.disabled).toBe(false);
  await act(async () => submit.click());
  expect(addAccount).toHaveBeenCalledWith({
    phone_e164: '+79001234567',
    persona_id: 'nastya',
    purpose: 'prod',
    daily_msg_quota: null,
    proxy_config: null,
  });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(getAccounts).toHaveBeenCalledTimes(2);
});

test('«Отмена» закрывает окно добавления без запроса', async () => {
  getAccounts.mockResolvedValue([]);
  await act(async () => root.render(<Accounts />));
  expect(host.textContent).toContain('Аккаунтов нет');
  await act(async () => button('Добавить аккаунт').click());
  await act(async () => button('Отмена').click());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(addAccount).not.toHaveBeenCalled();
});
