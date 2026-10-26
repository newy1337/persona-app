// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import ConversationsTable from '../ConversationsTable/ConversationsTable';
import HotkeysHelp from './HotkeysHelp';
import { keyName, useHotkeys } from './hotkeys';

let host, root;
beforeEach(() => {
  navigate.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const press = (code, extra = {}, target = window) =>
  act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { code, key: extra.key ?? code, bubbles: true, ...extra })));

describe('горячие клавиши', () => {
  it('клавиша по физической кнопке: «о» в русской раскладке — это J', () => {
    expect(keyName({ code: 'KeyJ', key: 'о' })).toBe('j');
    expect(keyName({ code: 'Slash', key: '?', shiftKey: true })).toBe('?');
  });

  it('в поле ввода и с модификаторами не срабатывают', async () => {
    const fn = vi.fn();
    function Probe() {
      useHotkeys({ j: fn });
      return <input aria-label="поле" />;
    }
    await act(async () => root.render(<Probe />));
    await press('KeyJ', {}, host.querySelector('input'));
    await press('KeyJ', { ctrlKey: true });
    expect(fn).not.toHaveBeenCalled();
    await press('KeyJ');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('список диалогов: J/K двигают курсор по строкам, Enter открывает чат', async () => {
    const now = Math.floor(Date.now() / 1000);
    const rows = [1, 2, 3].map((id) => ({ chat_id: id, name: `Клиент ${id}`, last_message_ts: now - id, unread_count: 0, stage: { id: 'knock', title: 'Знакомство', index: 0 } }));
    await act(async () => root.render(<ConversationsTable rows={rows} />));
    const cursor = () => host.querySelector('tr[data-cursor]')?.dataset.chatId;
    expect(cursor()).toBeUndefined();
    await press('KeyJ');
    expect(cursor()).toBe('1');
    await press('KeyJ');
    await press('KeyJ');
    await press('KeyJ');
    expect(cursor()).toBe('3');
    await press('KeyK');
    expect(cursor()).toBe('2');
    await press('Enter', { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('/conversation/2');
  });

  it('«?» открывает шпаргалку', async () => {
    await act(async () => root.render(<HotkeysHelp />));
    await press('Slash', { key: '?', shiftKey: true });
    expect(document.querySelector('[data-testid="hotkeys-help"]').textContent).toContain('следующий / предыдущий чат');
  });
});
