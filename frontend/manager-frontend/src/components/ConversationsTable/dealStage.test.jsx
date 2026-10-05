// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import ConversationsTable from './ConversationsTable';

const now = Math.floor(Date.now() / 1000);
const row = (extra) => ({
  chat_id: 1,
  id: 1,
  name: 'Клиент',
  last_message_ts: now,
  pause_state: 'active',
  unread_count: 0,
  stage: { id: 'knock', title: 'Знакомство', index: 0 },
  ...extra,
});

let host;
let root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('этап сделки в таблице диалогов', () => {
  it('показывает этап и причину архива', async () => {
    await act(async () => root.render(<ConversationsTable rows={[row({ deal_stage: 'archive', deal_note: 'не отвечает' })]} />));
    const cell = host.querySelector('[data-testid="deal-stage"]');
    expect(cell.textContent).toContain('Этап: Архив');
    expect(cell.textContent).toContain('не отвечает');
  });

  it('без этапа строки нет', async () => {
    await act(async () => root.render(<ConversationsTable rows={[row({})]} />));
    expect(host.querySelector('[data-testid="deal-stage"]')).toBeNull();
  });
});
