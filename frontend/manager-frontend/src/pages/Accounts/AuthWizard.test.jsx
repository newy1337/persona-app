// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import AuthWizard from './AuthWizard';
import { authFlow } from '../../api/accounts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../api/accounts', () => ({
  authFlow: {
    start: vi.fn(),
    status: vi.fn(),
    code: vi.fn(),
    password: vi.fn(),
    cancel: vi.fn(async () => ({})),
  },
}));

const account = { id: 7, phone_e164: '+79001234567' };
let container;
let root;

const render = async () => {
  await act(async () => {
    root.render(<AuthWizard account={account} onClose={() => {}} />);
  });
};

const click = async (text) => {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === text,
  );
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('вход в аккаунт: код или QR', () => {
  it('по умолчанию запрашивает вход по коду', async () => {
    authFlow.start.mockResolvedValue({ job_id: 'j1', method: 'phone', status: 'pending' });
    authFlow.status.mockResolvedValue({ job_id: 'j1', method: 'phone', status: 'need_code' });
    await render();
    expect(authFlow.start).toHaveBeenCalledWith(7, 'phone');
  });

  it('переключение на QR бросает прежнее задание и просит новое', async () => {
    authFlow.start.mockResolvedValue({ job_id: 'j1', method: 'phone', status: 'pending' });
    authFlow.status.mockResolvedValue({ job_id: 'j1', method: 'phone', status: 'pending' });
    await render();
    await click('По QR-коду');
    expect(authFlow.cancel).toHaveBeenCalledWith('j1');
    expect(authFlow.start).toHaveBeenLastCalledWith(7, 'qr');
  });

  it('картинку кода показываем как есть, с сервера', async () => {
    authFlow.start.mockResolvedValue({
      job_id: 'j2',
      method: 'qr',
      status: 'need_qr',
      qr_svg: '<svg data-x="1"><rect /></svg>',
    });
    authFlow.status.mockResolvedValue({
      job_id: 'j2',
      method: 'qr',
      status: 'need_qr',
      qr_svg: '<svg data-x="1"><rect /></svg>',
    });
    await render();
    await click('По QR-коду');
    expect(container.querySelector('[data-testid="login-qr"] svg')).toBeTruthy();
  });

  it('на шаге сканирования кнопки «Далее» нет — вводить нечего', async () => {
    authFlow.start.mockResolvedValue({ job_id: 'j3', method: 'qr', status: 'need_qr', qr_svg: '<svg></svg>' });
    authFlow.status.mockResolvedValue({ job_id: 'j3', method: 'qr', status: 'need_qr', qr_svg: '<svg></svg>' });
    await render();
    await click('По QR-коду');
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent.trim());
    expect(labels).not.toContain('Далее');
  });

  it('после сканирования с облачным паролем просит 2FA', async () => {
    authFlow.start.mockResolvedValue({ job_id: 'j4', method: 'qr', status: 'need_2fa' });
    authFlow.status.mockResolvedValue({ job_id: 'j4', method: 'qr', status: 'need_2fa' });
    await render();
    await click('По QR-коду');
    expect(container.querySelector('input[type="password"]')).toBeTruthy();
  });
});
