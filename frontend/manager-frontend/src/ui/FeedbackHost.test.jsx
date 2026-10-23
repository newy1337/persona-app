// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { PanelUX } from './PanelUX';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

test('без всплывашек справа (админ) окно подтверждения всё равно показывается', async () => {
  await act(async () => root.render(<PanelUX.FeedbackHost notices={false} />));
  expect(host.querySelector('.ux-notices')).toBeNull();
  let answer;
  await act(async () => { answer = PanelUX.confirm({ title: 'Удалить?' }); });
  expect(host.querySelector('[role=dialog]')).not.toBeNull();
  await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Отмена').click());
  expect(await answer).toBe(false);
});

test('по умолчанию всплывашки есть', async () => {
  await act(async () => root.render(<PanelUX.FeedbackHost />));
  expect(host.querySelector('.ux-notices')).not.toBeNull();
});
