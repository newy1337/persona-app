// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import ConversationsTable from './ConversationsTable';
import { COLUMNS, dialogFilterDefs } from './rowLayout';

const KEY = 'panel_columns_dialogs';
const now = Math.floor(Date.now() / 1000);
const row = (chat_id, extra = {}) => ({
  chat_id,
  name: `Клиент ${chat_id}`,
  last_message_ts: now - chat_id,
  unread_count: 0,
  stage: { id: 'knock', title: 'Знакомство', index: 0 },
  ...extra,
});
const ROWS = [
  row(1, { lead_type: 'cold', channel: 'telegram', persona_name: 'Настя', unread_count: 3, age: 34, city: 'Казань', client_presence: { kind: 'online' } }),
  row(2, { lead_type: 'hot', channel: 'vk', persona_name: 'Денис', age: 41, city: 'Москва', client_presence: { kind: 'recently' } }),
  row(3, { lead_type: 'inbound', channel: 'whatsapp' }),
];

let host, root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  localStorage.setItem(KEY, JSON.stringify({ unread: true, online: true, age: true, city: true, persona: true }));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

const cellsOf = (chatId) => host.querySelector(`tbody tr[data-chat-id="${chatId}"]`);

describe('новые колонки диалогов', () => {
  it('Соцсеть и Тип стоят сразу после Контакта и видны по умолчанию; остальные включаются вручную', () => {
    const keys = COLUMNS.map((c) => c.key);
    expect(keys.slice(1, 4)).toEqual(['contact', 'channel', 'type']);
    const byKey = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
    expect(byKey.channel.show).toBeUndefined();
    expect(byKey.type.show).toBeUndefined();
    expect([byKey.unread.show, byKey.online.show, byKey.age.show, byKey.city.show, byKey.persona.show]).toEqual([false, false, false, false, false]);
  });

  it('ячейки: соцсеть TG / VK / WA, тип Холодка / Хот / Входящий, непрочитанные, в сети, возраст, город, личность', async () => {
    await act(async () => root.render(<ConversationsTable rows={ROWS} />));
    const channel = (id) => cellsOf(id).querySelector('[data-testid="channel-cell"]').textContent;
    const type = (id) => cellsOf(id).querySelector('[data-testid="lead-type"]').textContent;
    expect([channel(1), channel(2), channel(3)]).toEqual(['TG', 'VK', 'WA']);
    expect([type(1), type(2), type(3)]).toEqual(['Холодка', 'Хот', 'Входящий']);
    expect(cellsOf(1).querySelector('[data-testid="unread-cell"]').textContent).toBe('3');
    expect(cellsOf(2).querySelector('[data-testid="unread-cell"]')).toBeNull();
    expect(cellsOf(1).textContent).toContain('в сети');
    expect(cellsOf(2).textContent).toContain('недавно');
    expect(cellsOf(1).textContent).toContain('Казань');
    expect(cellsOf(1).textContent).toContain('34');
    expect(cellsOf(2).textContent).toContain('Денис');
  });

  it('фильтры: по типу, по соцсети, по наличию непрочитанных', () => {
    const cols = COLUMNS.filter((c) => !c.adminOnly);
    const defs = dialogFilterDefs(ROWS, {}, cols);
    expect(defs.type.options.map((o) => [o.label, o.count])).toEqual([['Холодка', 1], ['Хот', 1], ['Входящий', 1]]);
    expect(ROWS.map(defs.type.get)).toEqual(['cold', 'hot', 'inbound']);
    expect(ROWS.map(defs.channel.get)).toEqual(['TG', 'VK', 'WA']);
    expect(ROWS.map(defs.unread.get)).toEqual(['yes', 'no', 'no']);
    expect(defs.persona.options.map((o) => o.label)).toEqual(expect.arrayContaining(['Настя', 'Денис']));
  });
});
