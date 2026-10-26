// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import Personas from './Personas';

vi.mock('./PromptsEditor', () => ({ default: () => null }));
vi.mock('./RhythmEditor', () => ({ default: () => null }));
vi.mock('./VariablesEditor', () => ({ default: () => null }));
vi.mock('./SectionEditor', () => ({ default: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root, persona;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  persona = { id: 1, slug: 'nastya', name: 'Настя', enabled: true, is_default: true, traffic_type: null, accounts: 0, card_lines: 0, examples: 0, storylines: 0, edited_prompts: 0 };
  vi.spyOn(api, 'get').mockImplementation(async (path) =>
    path === '/api/personas' ? { items: [persona] } : path === '/api/personas/1' ? persona : path.includes('models') ? null : {});
  vi.spyOn(api, 'put').mockImplementation(async (_path, body) => { persona = { ...persona, ...body }; return persona; });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

test('тип трафика: админ выбирает Холодку или Hot, уходит в PUT, в списке видна метка', async () => {
  await act(async () => root.render(<Personas />));
  const select = host.querySelector('select[aria-label="Тип трафика"]');
  expect(select.value).toBe('');
  expect([...select.options].map((o) => o.textContent)).toEqual(['не указан', 'Холодка', 'Hot']);
  await act(async () => { select.value = 'cold'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(api.put).toHaveBeenCalledWith('/api/personas/1', { traffic_type: 'cold' });
  expect(host.querySelector('[data-testid="persona-traffic"]').textContent).toBe('Холодка');
  await act(async () => { select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(api.put).toHaveBeenLastCalledWith('/api/personas/1', { traffic_type: null });
  expect(host.querySelector('[data-testid="persona-traffic"]')).toBeNull();
});
