// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import ApiKeys from './ApiKeys';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const items = [
  { id: 1, name: 'Beboo', prefix: 'sk_abcd', created_at: 1792400000, last_used_at: null, revoked_at: null },
  { id: 2, name: 'Старый', prefix: 'sk_zzzz', created_at: 1792300000, last_used_at: 1792350000, revoked_at: 1792390000 },
];
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(api, 'get').mockResolvedValue({ items });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const render = async () => act(async () => root.render(<ApiKeys />));

test('список: действующий с кнопкой отзыва, отозванный без неё', async () => {
  await render();
  expect(host.querySelector('[data-key-id="1"] button')).not.toBeNull();
  expect(host.querySelector('[data-key-id="2"] button')).toBeNull();
  expect(host.querySelector('[data-key-id="2"]').textContent).toContain('отозван');
});

test('создание показывает ключ один раз', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ key: 'sk_newkey_value', item: { id: 3, name: 'Новый' } });
  await render();
  const input = host.querySelector('[aria-label="Название ключа"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Новый');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(post).toHaveBeenCalledWith('/api/api-keys', { name: 'Новый' });
  expect(host.querySelector('[data-testid="fresh-key"]').textContent).toContain('sk_newkey_value');
  await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Скрыть').click());
  expect(host.querySelector('[data-testid="fresh-key"]')).toBeNull();
});
