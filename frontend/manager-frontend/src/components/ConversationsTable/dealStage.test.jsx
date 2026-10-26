// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, test } from 'vitest';
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

test('с обработчиком в строке появляется селект этапа, у пустого — подпись «Нужно указать этап»', async () => {
  const onDealStage = vi.fn();
  await act(async () => root.render(<ConversationsTable rows={[row({})]} onDealStage={onDealStage} />));
  const select = host.querySelector('[data-testid="deal-stage"] select');
  expect(select.value).toBe('');
  expect(select.options[0].textContent).toBe('Нужно указать этап');
  await act(async () => {
    select.value = 'soglas';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(onDealStage).toHaveBeenCalledWith(1, 'soglas', expect.objectContaining({ chat_id: 1 }));
});

test('фильтр колонки «Этап» отбирает по этапу и «не указан», считает строки', async () => {
  const rows = [
    row({ chat_id: 1, id: 1, name: 'Первый', deal_stage: 'soglas' }),
    row({ chat_id: 2, id: 2, name: 'Второй', deal_stage: 'vbros' }),
    row({ chat_id: 3, id: 3, name: 'Третий' }),
  ];
  const names = () => [...host.querySelectorAll('tbody tr')].map((tr) => tr.textContent).join(' ');
  const draw = async (deal) => {
    let state = { deal };
    const filters = [state, (key, value) => { state = { ...state, [key]: value }; }, () => {}];
    await act(async () => root.render(<ConversationsTable rows={rows} filters={filters} />));
  };
  await draw(['soglas']);
  expect(host.querySelectorAll('tbody tr').length).toBe(1);
  expect(names()).toContain('Первый');
  await draw(['']);
  expect(names()).toContain('Третий');
  expect(names()).not.toContain('Первый');
  await draw(['soglas', 'vbros']);
  expect(host.querySelectorAll('tbody tr').length).toBe(2);
});

test('фильтр канала появляется, когда в списке и Telegram, и VK', async () => {
  const rows = [
    row({ chat_id: 1, id: 1, name: 'Тг' }),
    row({ chat_id: 2, id: 2, name: 'Вк', channel: 'vk' }),
  ];
  await act(async () => root.render(<ConversationsTable rows={rows} />));
  const chips = [...host.querySelectorAll('[data-testid="channel-filters"] button')];
  expect(chips.map((b) => b.textContent)).toEqual(['Все · 2', 'Telegram · 1', 'ВКонтакте · 1']);
  await act(async () => chips[2].click());
  const text = [...host.querySelectorAll('tbody tr')].map((tr) => tr.textContent).join(' ');
  expect(text).toContain('Вк');
  expect(text).not.toContain('Тг');
  // Канал теперь в своей колонке «Соцсеть»; метка у контакта — только когда колонка скрыта.
  expect(host.querySelector('tbody tr[data-chat-id="2"] [data-testid="channel-cell"]').textContent).toBe('VK');
});

test('в списке только Telegram — фильтра канала нет', async () => {
  await act(async () => root.render(<ConversationsTable rows={[row({})]} />));
  expect(host.querySelector('[data-testid="channel-filters"]')).toBeNull();
});
