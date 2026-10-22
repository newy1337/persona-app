// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import Catalogs from './Catalogs';

vi.mock('../../components/Header/Header', () => ({ default: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(api, 'get').mockImplementation(async (path) => path === '/api/donors'
    ? { items: [{ id: 1, name: 'Camp A', managers: 2 }] }
    : { items: [{ id: 5, name: 'beboo', managers: 0 }] });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

test('показывает оба справочника и добавляет источник', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ items: [{ id: 5, name: 'beboo', managers: 0 }, { id: 6, name: 'vk', managers: 0 }] });
  await act(async () => root.render(<Catalogs />));
  expect(host.querySelector('[aria-label="Доноры"]').textContent).toContain('Camp A');
  expect(host.querySelector('[aria-label="Источники"]').textContent).toContain('beboo');
  const input = host.querySelector('[aria-label="Новый: Источники"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'vk');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(post).toHaveBeenCalledWith('/api/sources', { name: 'vk' });
  expect(host.querySelector('[aria-label="Источники"]').textContent).toContain('vk');
});
