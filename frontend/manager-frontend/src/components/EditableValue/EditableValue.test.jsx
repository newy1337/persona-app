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

  it('видно, что значение правится: карандаш на месте всегда, под значением пунктир', () => {
    render({ value: 'Воронеж', onSave: vi.fn() });
    const button = host.querySelector('button');
    const pencil = button.querySelector('svg');
    expect(pencil).toBeTruthy();
    expect(pencil.getAttribute('aria-hidden')).toBe('true');
    // Никаких «покажись при наведении»: ни прозрачности, ни group-hover.
    const pencilClass = pencil.getAttribute('class');
    expect(pencilClass).not.toContain('opacity-0');
    expect(pencilClass).not.toContain('group-hover');
    expect(pencilClass.split(' ')).toEqual(expect.arrayContaining(['size-3', 'text-muted-foreground/70']));
    const text = button.querySelector('span');
    expect(text.textContent).toBe('Воронеж');
    expect(text.className.split(' ')).toEqual(expect.arrayContaining(['border-b', 'border-dashed', 'border-input']));
    expect(button.className.split(' ')).toEqual(expect.arrayContaining(['cursor-pointer', 'hover:bg-accent', 'h-7']));
    expect(button.getAttribute('title')).toBeTruthy();
  });

  it('пустое значение читается как «добавить», приглушённо; карандаш тоже на месте', () => {
    render({ value: '', onSave: vi.fn() });
    const button = host.querySelector('button');
    expect(button.textContent).toBe('добавить');
    expect(button.textContent).not.toContain('—');
    expect(button.getAttribute('aria-label')).toBe('Город: добавить');
    expect(button.hasAttribute('data-empty')).toBe(true);
    expect(button.querySelector('span').className.split(' ')).toContain('text-muted-foreground');
    expect(button.querySelector('svg')).toBeTruthy();
  });

  it('пустой display не прячет «добавить»; непустой показывается вместо значения', () => {
    render({ value: '', display: null, onSave: vi.fn() });
    expect(host.querySelector('button').textContent).toBe('добавить');
    act(() => root.render(<EditableValue label="Город" value="" display="Тула (из базы)" onSave={vi.fn()} />));
    const button = host.querySelector('button');
    expect(button.textContent).toBe('Тула (из базы)');
    expect(button.hasAttribute('data-empty')).toBe(false);
  });

  it('вход в правку не меняет высоту строки: и кнопка, и поле — h-7', () => {
    render({ value: 'Воронеж', onSave: vi.fn() });
    expect(host.querySelector('button').className.split(' ')).toContain('h-7');
    act(() => host.querySelector('button').click());
    expect(input().className.split(' ')).toContain('h-7');
    expect(input().parentElement.className.split(' ')).toContain('h-7');
  });
});
