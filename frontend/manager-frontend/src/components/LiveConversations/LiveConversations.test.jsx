// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const { default: LiveConversations } = await import('./LiveConversations');

const nowS = () => Math.floor(Date.now() / 1000);
const agent = (chatId, extra = {}) => ({
  chat_id: chatId,
  account_id: 1,
  name: `Клиент ${chatId}`,
  last_message_ts: nowS() - 10 * 60,
  is_paused: false,
  unread_count: 0,
  stage: { id: 'cold', title: 'знакомство', index: 1, total: 5 },
  ...extra,
});

function render(props) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => createRoot(host).render(React.createElement(LiveConversations, props)));
  return host;
}

const list = (host) => host.querySelector('[data-testid="agent-list"]');
const rows = (host) => host.querySelectorAll('[data-testid="agent-card"]');
const expander = (host) => host.querySelector('button[aria-expanded]');

describe('панель «Активные диалоги»', () => {
  it('свёрнута в три строки и раскрывается по «Все N»', () => {
    const host = render({ agents: [1, 2, 3, 4].map((id) => agent(id)) });
    expect(host.querySelector('h2').textContent).toBe('Активные диалоги');
    expect(list(host).dataset.expanded).toBe('false');
    expect(list(host).className).toContain('h-[120px]');
    act(() => expander(host).click());
    expect(list(host).dataset.expanded).toBe('true');
    expect(rows(host).length).toBe(4);
  });

  it('строка: стадия, кто ведёт, время от последнего сообщения, без причины очереди', () => {
    const host = render({ agents: [agent(1, { queue_reason: 'hold_armed', is_paused: true, manager_username: 'anna' })] });
    expect(host.querySelector('[data-testid="agent-stage"]').textContent).toBe('знакомство');
    expect(host.querySelector('[data-testid="agent-lead"]').textContent).toContain('Менеджер');
    expect(host.querySelector('[data-testid="agent-lead"]').textContent).toContain('anna');
    expect(host.textContent).toContain('10 мин');
    expect(host.textContent).not.toContain('Передать аналитика');
  });

  it('непрочитанные показаны счётчиком', () => {
    const host = render({ agents: [agent(1, { unread_count: 3 }), agent(2)] });
    const chips = host.querySelectorAll('[data-testid="agent-unread"]');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toBe('3');
  });

  it('пусто — «Сейчас никто не пишет»; с фильтром — просьба сбросить его', () => {
    expect(list(render({ agents: [] })).textContent).toBe('Сейчас никто не пишет');
    const filtered = render({ agents: [agent(1)], query: 'нет такого' });
    expect(list(filtered).textContent).toBe('Ничего не найдено — сбросьте фильтры и поиск');
    expect(filtered.textContent).toContain('0 из 1');
  });

  it('галочки ручного режима в этой панели нет', () => {
    expect(render({ agents: [agent(1)] }).querySelector('[data-testid="queue-manual-toggle"]')).toBeNull();
  });
});
