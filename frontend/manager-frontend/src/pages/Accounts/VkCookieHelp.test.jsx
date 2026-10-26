// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { VkCookieFields } from './VkSessionDialog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

test('«i» у кук VK открывает инструкцию в три шага; Esc и клик мимо закрывают', async () => {
  await act(async () => root.render(<VkCookieFields cookies="" userAgent="" parsed={null} onCookies={() => {}} onUserAgent={() => {}} />));
  const toggle = host.querySelector('button[aria-label="Как получить куки VK"]');
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(host.querySelector('textarea').id).toBe(host.querySelector('label[for]').htmlFor);
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelectorAll('[role=dialog] li')).toHaveLength(3);
  expect(host.querySelector('[role=dialog]').textContent).toContain('Cookie-Editor');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(host.querySelector('[role=dialog]')).toBeNull();
  await act(async () => toggle.click());
  await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(host.querySelector('[role=dialog]')).toBeNull();
});
