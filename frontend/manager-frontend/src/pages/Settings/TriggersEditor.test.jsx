// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TriggersEditor } from './Settings';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;

const INITIAL = ['менеджер', 'оператор'];
const render = (props) => act(async () => root.render(<TriggersEditor initial={INITIAL} onSave={vi.fn()} {...props} />));
const phrases = () => [...host.querySelectorAll('input[aria-label^="Стоп-фраза"]')].map((el) => el.value);
const buttonByText = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('редактор стоп-фраз', () => {
  it('строка — поле и кнопка-иконка удаления со своими подписями', async () => {
    await render();
    expect(host.querySelector('form[aria-label="Стоп-фразы"]')).not.toBeNull();
    expect(phrases()).toEqual(INITIAL);
    expect(host.querySelector('input[aria-label="Стоп-фраза 2"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Удалить стоп-фразу 2"]')).not.toBeNull();
  });

  it('удаление убирает строку, последняя строка очищается, а не исчезает', async () => {
    await render();
    await act(async () => host.querySelector('button[aria-label="Удалить стоп-фразу 1"]').click());
    expect(phrases()).toEqual(['оператор']);
    await act(async () => host.querySelector('button[aria-label="Удалить стоп-фразу 1"]').click());
    expect(phrases()).toEqual(['']);
  });

  it('«Добавить фразу» дописывает пустую строку, сохранение отдаёт очищенный список', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await render({ onSave });
    expect(buttonByText('Сохранить').disabled).toBe(true);

    await act(async () => buttonByText('Добавить фразу').click());
    expect(phrases()).toEqual([...INITIAL, '']);
    expect(buttonByText('Сохранить').disabled).toBe(true);

    await act(async () => host.querySelector('button[aria-label="Удалить стоп-фразу 2"]').click());
    expect(buttonByText('Сохранить').disabled).toBe(false);
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onSave).toHaveBeenCalledWith(['менеджер']);
  });
});
