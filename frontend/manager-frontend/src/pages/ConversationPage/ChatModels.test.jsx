// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import ChatModels from './ChatModels';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const options = {
  generator: [{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }, { id: 'z-ai/glm-5.3', label: 'GLM 5.3' }],
  judge: [{ id: 'claude-opus-5', label: 'Claude Opus 5' }],
  effort: [{ id: 'off', label: 'Без рассуждений' }, { id: 'high', label: 'Высокое' }],
  defaults: {},
};
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(api, 'get').mockImplementation(async () => options);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

const pick = async (label, value) => act(async () => {
  const select = host.querySelector(`[aria-label="${label}"]`);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
});

test('модели диалога: выбор сохраняется, «как у личности» снимает его', async () => {
  const put = vi.spyOn(api, 'put').mockImplementation(async (_path, body) => ({
    generator_model: null, judge_model: null, generator_effort: null, judge_effort: null, ...body,
  }));
  await act(async () => root.render(<ChatModels chatId={42} value={{ generator_model: null }} />));
  expect(host.textContent).toContain('как у личности');

  await pick('Модель ответов', 'z-ai/glm-5.3');
  expect(put).toHaveBeenCalledWith('/api/conversations/42/models', { generator_model: 'z-ai/glm-5.3' });
  expect(host.querySelector('[aria-label="Модель ответов"]').value).toBe('z-ai/glm-5.3');
  expect(host.textContent).toContain('своих: 1');

  await pick('Модель ответов', '');
  expect(put).toHaveBeenLastCalledWith('/api/conversations/42/models', { generator_model: null });
  expect(host.textContent).not.toContain('своих');
});
