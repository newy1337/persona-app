// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { PanelUX } from '../../ui/PanelUX';
import { SavedFilters, loadSaved } from './SavedFilters';

let host, root;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const pointer = (el) => act(async () => el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })));
const item = (text) => [...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.startsWith(text));

describe('сохранённые фильтры', () => {
  it('сохраняет текущие под именем и применяет набор одним кликом', async () => {
    vi.spyOn(PanelUX, 'prompt').mockResolvedValue('Мои срочные');
    const onApply = vi.fn();
    const state = { type: ['cold'] };
    await act(async () => root.render(<SavedFilters tableId="t" state={state} onApply={onApply} />));
    await pointer(host.querySelector('[data-testid="saved-filters"]'));
    await act(async () => item('Сохранить текущие').click());
    await act(async () => { await Promise.resolve(); });
    expect(loadSaved('t')).toEqual([{ name: 'Мои срочные', state }]);
    expect(host.querySelector('[data-testid="saved-filters"]').textContent).toContain('· 1');

    await pointer(host.querySelector('[data-testid="saved-filters"]'));
    await act(async () => item('Мои срочные').click());
    expect(onApply).toHaveBeenCalledWith(state);
  });

  it('без заданных фильтров сохранять нечего', async () => {
    await act(async () => root.render(<SavedFilters tableId="t" state={{}} onApply={vi.fn()} />));
    await pointer(host.querySelector('[data-testid="saved-filters"]'));
    expect(item('Сохранить текущие').getAttribute('data-disabled')).not.toBeNull();
  });
});
