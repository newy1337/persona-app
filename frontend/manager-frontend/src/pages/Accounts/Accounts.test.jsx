// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import Accounts from './Accounts';
import { addAccount, addVkAccount, getAccounts } from '../../api/accounts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../api/accounts', () => ({
  addAccount: vi.fn(async () => ({ id: 9 })),
  addVkAccount: vi.fn(async () => ({ id: 10, login: 'vk@mail.ru' })),
  setVkSession: vi.fn(),
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
vi.mock('../../api/photoSets', () => ({ setAccountPhotoAutoSend: vi.fn() }));

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

const radio = (name) => [...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent.startsWith(name));

test('фильтр канала: счётчики и строки по каналу; «Войти» у VK открывает вход по кукам', async () => {
  getAccounts.mockResolvedValue([
    account,
    { id: 11, channel: 'vk', login: 'vk@mail.ru', status: 'unauthorized', persona_id: 'nastya' },
  ]);
  await act(async () => root.render(<Accounts />));
  expect(host.querySelector('[aria-label="Фильтр канала"]')).not.toBeNull();
  expect(radio('Все').textContent).toBe('Все (2)');
  expect(radio('ВКонтакте').textContent).toBe('ВКонтакте (1)');
  await act(async () => radio('ВКонтакте').click());
  expect(host.querySelector('tr[data-account-id="7"]')).toBeNull();
  expect(host.querySelector('tr[data-account-id="11"]')).not.toBeNull();
  await act(async () => host.querySelector('tr[data-account-id="11"] button[aria-label="Войти"]').click());
  expect(host.textContent).toContain('Вход VK');
});

test('добавление VK: логин, куки и обязательный прокси уходят в addVkAccount', async () => {
  getAccounts.mockResolvedValue([]);
  await act(async () => root.render(<Accounts />));
  await act(async () => button('Добавить аккаунт').click());
  await act(async () => radio('ВКонтакте').click());
  const submit = () => button('Добавить и подключить');
  expect(submit().disabled).toBe(true);
  const field = (label) => [...host.querySelectorAll('label')].find((l) => l.textContent.startsWith(label)).querySelector('input, textarea');
  await type(field('Логин VK'), 'vk@mail.ru');
  await act(async () => {
    const area = field('Куки vk.ru');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, 'remixsid=abc; remixlang=0');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(submit().disabled).toBe(true);
  await type(field('Хост'), '1.2.3.4');
  await type(field('Порт'), '8080');
  expect(submit().disabled).toBe(false);
  await act(async () => submit().click());
  expect(addVkAccount).toHaveBeenCalledWith(expect.objectContaining({
    login: 'vk@mail.ru',
    persona_id: 'nastya',
    proxy_config: expect.objectContaining({ type: 'http', host: '1.2.3.4', port: 8080 }),
  }));
});
