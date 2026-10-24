// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import ActionMenu from './ActionMenu';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Меню Radix ждёт ResizeObserver, которого нет в jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

async function mount(items) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ActionMenu items={items} ariaLabel="Ещё: тест" />));
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

const open = (trigger) =>
  act(async () => trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })));
const menu = () => document.querySelector('[role=menu]');

describe('меню «Ещё»', () => {
  it('скрыто до клика, пункт вызывает действие и закрывает меню, ложные пункты пропускаются', async () => {
    const onDup = vi.fn();
    const { host, done } = await mount([{ label: 'Дублировать', onSelect: onDup }, false, null, { label: 'Удалить', danger: true, onSelect: () => {} }]);
    const trigger = host.querySelector('button[aria-haspopup="menu"]');
    expect(trigger.getAttribute('aria-label')).toBe('Ещё: тест');
    expect(menu()).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await open(trigger);
    const items = [...document.querySelectorAll('[role=menuitem]')];
    expect(items.map((b) => b.textContent)).toEqual(['Дублировать', 'Удалить']);
    expect(items[1].getAttribute('data-variant')).toBe('destructive');
    await act(async () => items[0].click());
    expect(onDup).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
    done();
  });

  it('Escape закрывает меню', async () => {
    const { host, done } = await mount([{ label: 'Один', onSelect: () => {} }]);
    const trigger = host.querySelector('button[aria-haspopup="menu"]');
    await open(trigger);
    expect(menu()).not.toBeNull();
    await act(async () => menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(menu()).toBeNull();
    done();
  });

  it('без пунктов не рисуется', async () => {
    const { host, done } = await mount([false, null]);
    expect(host.innerHTML).toBe('');
    done();
  });
});
