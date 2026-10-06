// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const { default: EditableValue } = await import('./EditableValue');

let host = null;
let root = null;

/* Значение лежит в обрезающей обёртке — как в строках карточки клиента. */
function render(props) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <span data-testid="clip" style={{ overflow: 'hidden' }}>
        <EditableValue label="Город" {...props} />
      </span>,
    ),
  );
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const input = () => host.querySelector('input');
const type = (value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
const press = (key) =>
  act(async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

describe('EditableValue', () => {
  it('кнопка названа подписью и значением; по нажатию появляется поле с тем же значением', () => {
    render({ value: 'Воронеж', onSave: vi.fn() });
    const button = host.querySelector('button');
    expect(button.getAttribute('aria-label')).toBe('Город: Воронеж');
    act(() => button.click());
    expect(input().value).toBe('Воронеж');
    expect(input().getAttribute('aria-label')).toBe('Город');
  });

  it('удачное сохранение: значение уходит обрезанным, поле закрывается', async () => {
    const onSave = vi.fn(async () => {});
    render({ value: '', onSave });
    act(() => host.querySelector('button').click());
    type('  Тула ');
    await press('Enter');
    expect(onSave).toHaveBeenCalledWith('Тула');
    expect(input()).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('сбой сохранения: ошибка видна и лежит вне обрезающей обёртки, поле остаётся открытым', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('сервер недоступен');
    });
    render({ value: '', onSave });
    act(() => host.querySelector('button').click());
    type('Тула');
    await press('Enter');
    const alert = document.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toBe('сервер недоступен');
    expect(host.querySelector('[data-testid="clip"]').contains(alert)).toBe(false);
    expect(input()).toBeTruthy();
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().value).toBe('Тула');
  });

  it('Escape после сбоя закрывает поле и убирает ошибку', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('сервер недоступен');
    });
    render({ value: 'Воронеж', onSave });
    act(() => host.querySelector('button').click());
    type('Тула');
    await press('Enter');
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
    await press('Escape');
    expect(input()).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('button').textContent).toContain('Воронеж');
  });
});
