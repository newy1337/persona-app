// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { DialogCards } from './DialogCards';

const helpers = {
  Avatar: ({ name }) => <span>{name}</span>,
  Stage: ({ stage }) => <span>{stage?.title}</span>,
  isNew: (row) => row.unread_count > 0,
  unreadLabel: (n) => `${n} новых`,
  nextAction: () => ({ text: 'ответит через 5 мин' }),
};
let host, root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('карточки диалогов на телефоне', () => {
  it('срочный — красный с причиной, без этапа — жёлтый, нажатие открывает чат', async () => {
    const onOpen = vi.fn();
    const rows = [
      { chat_id: 1, name: 'Ира', unread_count: 2, last_message_ts: 1790000000, deal_stage: 'vbros', stage: { title: 'Знакомство' } },
      { chat_id: 2, name: 'Оля', unread_count: 0, last_message_ts: 1790000000, stage: { title: 'Знакомство' } },
    ];
    await act(async () => root.render(<DialogCards rows={rows} urgent={new Map([['1', 'Просит фото']])} onOpen={onOpen} helpers={helpers} />));
    const card = (id) => host.querySelector(`button[data-chat-id="${id}"]`);
    expect(card(1).dataset.urgent).toBe('true');
    expect(card(1).textContent).toContain('Просит фото');
    expect(card(1).textContent).toContain('2 новых');
    expect(card(2).className).toContain('bg-warning');
    expect(card(2).textContent).toContain('ответит через 5 мин');
    await act(async () => card(2).click());
    expect(onOpen).toHaveBeenCalledWith(2);
  });
});
