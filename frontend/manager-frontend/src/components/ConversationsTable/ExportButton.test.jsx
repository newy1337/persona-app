// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../../api/conversations', () => ({ downloadChats: vi.fn(async () => 'dialogs.zip') }));
const { downloadChats } = await import('../../api/conversations');
const { default: ExportButton } = await import('./ExportButton');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });
const render = async (ids) => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ExportButton chatIds={ids} />));
};
const click = async (el) => act(async () => el.click());
const item = (text) => [...host.querySelectorAll('[role=menuitem]')].find((b) => b.textContent.startsWith(text));

test('выгружает отобранные диалоги текстом или архивом с медиа', async () => {
  await render([1, 2, 3]);
  const btn = host.querySelector('[data-testid="export-dialogs"]');
  expect(btn.textContent).toBe('Выгрузить 3 диалога');
  await click(btn);
  await click(item('HTML'));
  expect(downloadChats).toHaveBeenCalledWith([1, 2, 3], 'html_zip');
  await click(btn);
  await click(item('Текстом'));
  expect(downloadChats).toHaveBeenLastCalledWith([1, 2, 3], 'txt');
});

test('все диалоги (3337) — архивом HTML можно, текстом сверх 1000 — нет', async () => {
  await render(Array.from({ length: 3337 }, (_, i) => i + 1));
  await click(host.querySelector('[data-testid="export-dialogs"]'));
  expect(item('HTML').disabled).toBe(false);
  expect(item('Текстом').disabled).toBe(true);
  await click(item('HTML'));
  expect(downloadChats).toHaveBeenCalledWith(expect.arrayContaining([1, 3337]), 'html_zip');
});

test('без диалогов кнопки нет', async () => {
  await render([]);
  expect(host.querySelector('[data-testid="export-dialogs"]')).toBeNull();
});
