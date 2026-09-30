// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const { default: NeedManagerAssist } = await import('./NeedManagerAssist');

const agent = (chatId, queueReason) => ({
  chat_id: chatId,
  account_id: 1,
  name: `Чат ${chatId}`,
  queue_reason: queueReason,
  waiting_since: 1790600000,
  is_paused: true,
  stage: { id: 'warm', title: 'стало привычкой', index: 3, total: 5 },
});

const AGENTS = [agent(1, 'hold_armed'), agent(2, 'media_photo'), agent(3, 'manual_mode'), agent(4, 'manual_mode')];

function render(agents = AGENTS) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => createRoot(host).render(React.createElement(NeedManagerAssist, { agents })));
  return host;
}

const toggle = (host) => host.querySelector('[data-testid="queue-manual-toggle"]');
const cards = (host) => host.textContent;

describe('очередь «Ждут менеджера»', () => {
  beforeEach(() => window.localStorage.clear());

  it('по умолчанию ручной режим скрыт', () => {
    const host = render();
    expect(toggle(host).checked).toBe(false);
    expect(cards(host)).toContain('Передать аналитика');
    expect(cards(host)).not.toContain('Ручной режим:');
    expect(host.querySelectorAll('[class*="card"]').length).toBeGreaterThan(0);
  });

  it('галочка показывает, сколько таких диалогов ждёт', () => {
    const host = render();
    expect(toggle(host).parentElement.textContent).toContain('2');
  });

  it('включённая галочка добавляет их в список', () => {
    const host = render();
    const before = host.querySelectorAll('[data-testid^="agent-card"], article, [class*="card"]').length;
    act(() => {
      toggle(host).click();
    });
    const after = host.querySelectorAll('[data-testid^="agent-card"], article, [class*="card"]').length;
    expect(after).toBeGreaterThan(before);
  });

  it('выбор переживает перерисовку', () => {
    const first = render();
    act(() => {
      toggle(first).click();
    });
    expect(window.localStorage.getItem('nastya_queue_manual_mode')).toBe('1');

    const second = render();
    expect(toggle(second).checked).toBe(true);
  });

  it('без таких диалогов счётчик у галочки не рисуется', () => {
    const host = render([agent(1, 'hold_armed')]);
    expect(toggle(host).parentElement.textContent.trim()).toBe('Ручной режим');
  });
});
