// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), Link: () => null, NavLink: () => null }));
const { DeleteLeadDialog } = await import('./Leads');

function render(props) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => createRoot(host).render(React.createElement(DeleteLeadDialog, props)));
  return host;
}

describe('удаление лида', () => {
  const lead = { id: 5, username: 'oleg', telegram_user_id: 123 };

  it('галочка «удалить переписку в Telegram» по умолчанию снята; без неё — обычное удаление', async () => {
    const onConfirm = vi.fn(async () => undefined);
    const host = render({ lead, onCancel: vi.fn(), onConfirm });
    const box = host.querySelector('input[type="checkbox"]');
    expect(box.checked).toBe(false);
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Удалить');
    await act(async () => button.click());
    expect(onConfirm).toHaveBeenCalledWith({ telegram: false });
  });

  it('отметили — предупреждение, кнопка «Удалить с перепиской» и флаг telegram', async () => {
    const onConfirm = vi.fn(async () => undefined);
    const host = render({ lead, onCancel: vi.fn(), onConfirm });
    await act(async () => host.querySelector('input[type="checkbox"]').click());
    expect(host.textContent).toContain('Отменить это нельзя');
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Удалить с перепиской');
    await act(async () => button.click());
    expect(onConfirm).toHaveBeenCalledWith({ telegram: true });
  });

  it('лиду не писали — галочки нет', () => {
    const host = render({ lead: { id: 6, phone_e164: '+79000000000', telegram_user_id: null }, onCancel: vi.fn(), onConfirm: vi.fn() });
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
