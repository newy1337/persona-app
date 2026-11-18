// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, test } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
const { page } = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock('../../api/conversations', () => ({ getConversationPage: page, downloadChats: vi.fn() }));

import ConversationsTable from './ConversationsTable';
import { fakeConversationPage } from '../../test/fakeConversationPage';

/** Таблица со строками «на сервере»: отдаёт их поддельная страница. */
const Table = ({ rows, ...props }) => {
  page.mockImplementation(fakeConversationPage(rows));
  return <ConversationsTable {...props} />;
};

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
  sessionStorage.clear();
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
    await act(async () => root.render(<Table rows={[row({ deal_stage: 'archive', deal_note: 'не отвечает' })]} />));
    const cell = host.querySelector('[data-testid="deal-stage"]');
    expect(cell.textContent).toContain('Этап: Архив');
    expect(cell.textContent).toContain('не отвечает');
  });

  it('без этапа строки нет', async () => {
    await act(async () => root.render(<Table rows={[row({})]} />));
    expect(host.querySelector('[data-testid="deal-stage"]')).toBeNull();
  });
});

test('с обработчиком в строке появляется селект этапа, у пустого — подпись «Нужно указать этап»', async () => {
  const onDealStage = vi.fn();
  await act(async () => root.render(<Table rows={[row({})]} onDealStage={onDealStage} />));
  const select = host.querySelector('[data-testid="deal-stage"] select');
  expect(select.value).toBe('');
  expect(select.options[0].textContent).toBe('Нужно указать этап');
  await act(async () => {
    select.value = 'soglas';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(onDealStage).toHaveBeenCalledWith(1, 'soglas', expect.objectContaining({ chat_id: 1 }));
});

test('чипы этапов считают строки и фильтруют список', async () => {
  await act(async () => root.render(<Table rows={[
    row({ chat_id: 1, id: 1, name: 'Первый', deal_stage: 'soglas' }),
    row({ chat_id: 2, id: 2, name: 'Второй', deal_stage: 'vbros' }),
    row({ chat_id: 3, id: 3, name: 'Третий' }),
  ]} />));
  const chips = [...host.querySelectorAll('[data-testid="deal-stage-filters"] button')];
  expect(chips.map((b) => b.textContent)).toEqual(['Вброс · 1', 'Соглас · 1', 'Без этапа · 1']);
  await act(async () => chips[1].click());
  const names = [...host.querySelectorAll('tbody tr')].map((tr) => tr.textContent);
  expect(names.length).toBe(1);
  expect(names[0]).toContain('Первый');
  await act(async () => chips[2].click());
  expect([...host.querySelectorAll('tbody tr')].map((tr) => tr.textContent).join(' ')).toContain('Третий');
});

test('дата добавления номера — под ID чата, без даты — ничего', async () => {
  // 16.11.2026 10:00 МСК
  await act(async () => root.render(<Table rows={[row({ added_at: 1794812400 }), row({ chat_id: 2, id: 2 })]} />));
  const marks = host.querySelectorAll('[data-testid="added-at"]');
  expect(marks).toHaveLength(1);
  expect(marks[0].textContent).toBe(' · добавлен 16.11.26');
});
