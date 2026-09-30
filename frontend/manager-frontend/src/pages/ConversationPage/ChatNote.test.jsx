// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

const { default: ChatNote } = await import('./ChatNote');

function render(props) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(React.createElement(ChatNote, props)));
  return {
    host,
    update: (next) => act(() => root.render(React.createElement(ChatNote, { ...props, ...next }))),
  };
}

const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const type = (el, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const box = (host) => host.querySelector('[data-testid="note-text"]');

describe('заметка о диалоге', () => {
  it('пустой диалог показывает только кнопку, поле появляется по нажатию', () => {
    const { host } = render({ note: null, noteBy: null, noteAt: null, onSave: vi.fn() });
    expect(box(host)).toBeNull();
    click(host.querySelector('[data-testid="note-add"]'));
    expect(box(host)).not.toBeNull();
  });

  it('существующая заметка открыта сразу и подписана автором', () => {
    const { host } = render({ note: 'Просил не писать до пятницы', noteBy: 'manager4', noteAt: 1790600000, onSave: vi.fn() });
    expect(box(host).value).toBe('Просил не писать до пятницы');
    expect(host.textContent).toContain('manager4');
  });

  it('кнопка сохранения ждёт правки и отдаёт текст', async () => {
    const onSave = vi.fn(async () => {});
    const { host } = render({ note: 'старое', noteBy: null, noteAt: null, onSave });
    const save = host.querySelector('[data-testid="note-save"]');
    expect(save.disabled).toBe(true);

    type(box(host), 'новое');
    expect(host.querySelector('[data-testid="note-save"]').disabled).toBe(false);
    await act(async () => {
      host.querySelector('[data-testid="note-save"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSave).toHaveBeenCalledWith('новое');
  });

  it('недописанное не затирается ответом опроса', () => {
    const { host, update } = render({ note: 'старое', noteBy: null, noteAt: null, onSave: vi.fn() });
    type(box(host), 'пишу прямо сейчас');
    update({ note: 'старое' });
    expect(box(host).value).toBe('пишу прямо сейчас');
  });

  it('чужая правка подхватывается', () => {
    const { host, update } = render({ note: 'старое', noteBy: null, noteAt: null, onSave: vi.fn() });
    update({ note: 'правка коллеги' });
    expect(box(host).value).toBe('правка коллеги');
  });

  it('очистка освобождает поле, но сохранить надо самому', () => {
    const onSave = vi.fn(async () => {});
    const { host } = render({ note: 'было', noteBy: null, noteAt: null, onSave });
    click(host.querySelector('[data-testid="note-clear"]'));
    expect(box(host).value).toBe('');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('ошибка сохранения показывается словами', async () => {
    const onSave = vi.fn(async () => {
      throw { detail: 'чат не ваш' };
    });
    const { host } = render({ note: 'было', noteBy: null, noteAt: null, onSave });
    type(box(host), 'стало');
    await act(async () => {
      host.querySelector('[data-testid="note-save"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(host.textContent).toContain('чат не ваш');
  });
});
