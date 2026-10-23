// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import ActionMenu from './ActionMenu';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mount(items) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ActionMenu items={items} ariaLabel="Ещё: тест" />));
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

describe('меню «Ещё»', () => {
  it('скрыто до клика, пункт вызывает действие и закрывает меню, ложные пункты пропускаются', async () => {
    const onDup = vi.fn();
    const { host, done } = await mount([{ label: 'Дублировать', onSelect: onDup }, false, null, { label: 'Удалить', danger: true, onSelect: () => {} }]);
    const trigger = host.querySelector('button[aria-haspopup="menu"]');
    expect(host.querySelector('[role=menu]')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await act(async () => trigger.click());
    expect([...host.querySelectorAll('[role=menuitem]')].map((b) => b.textContent)).toEqual(['Дублировать', 'Удалить']);
    await act(async () => host.querySelector('[role=menuitem]').click());
    expect(onDup).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role=menu]')).toBeNull();
    done();
  });

  it('Escape и клик мимо закрывают меню', async () => {
    const { host, done } = await mount([{ label: 'Один', onSelect: () => {} }]);
    const trigger = host.querySelector('button[aria-haspopup="menu"]');
    await act(async () => trigger.click());
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(host.querySelector('[role=menu]')).toBeNull();
    await act(async () => trigger.click());
    await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(host.querySelector('[role=menu]')).toBeNull();
    done();
  });

  it('без пунктов не рисуется', async () => {
    const { host, done } = await mount([false, null]);
    expect(host.innerHTML).toBe('');
    done();
  });
});
