// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const { default: AgentCard } = await import('./AgentCard');

function render(agent) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => createRoot(host).render(React.createElement(AgentCard, { agent, showAlert: true })));
  return host;
}

describe('AgentCard в очереди «Ждут менеджера»', () => {
  it('таймер manual-плеча идёт от waiting_since — у него нет hold_armed_at', () => {
    const nowS = Math.floor(Date.now() / 1000);
    const host = render({
      chat_id: 1,
      name: 'Андрей',
      queue_reason: 'manual_takeover',
      waiting_since: nowS - 2 * 3600,
      hold_armed_at: null,
      is_paused: true,
    });
    expect(host.textContent).toContain('Бот замолчал');
    expect(host.textContent).toContain('2 ч');
  });

  it('лид-плечо подписано «Передать аналитика», таймер — от взвода HOLD', () => {
    const nowS = Math.floor(Date.now() / 1000);
    const host = render({
      chat_id: 2,
      name: 'Пётр',
      queue_reason: 'hold_armed',
      waiting_since: nowS - 30 * 60,
      hold_armed_at: nowS - 30 * 60,
      is_paused: true,
    });
    expect(host.textContent).toContain('Передать аналитика');
    expect(host.textContent).toContain('30 мин');
  });

  it('созревший повод подписан «Пора вбрасывать»', () => {
    const host = render({
      chat_id: 4,
      name: 'Сергей',
      queue_reason: 'vbros_ready',
      waiting_since: Math.floor(Date.now() / 1000) - 45 * 60,
      is_paused: false,
    });
    expect(host.textContent).toContain('Пора вбрасывать');
    expect(host.textContent).toContain('45 мин');
  });

  it.each([
    ['before_vbros', 'Сейчас вброс'],
    ['before_predloga', 'Сейчас предлога'],
    ['before_soglas', 'Сейчас соглас'],
    ['qual_gap', 'Данные не собраны'],
  ])('плечо %s подписано «%s»', (reason, label) => {
    const host = render({
      chat_id: 9,
      name: 'Пётр',
      queue_reason: reason,
      waiting_since: Math.floor(Date.now() / 1000) - 45 * 60,
      is_paused: false,
    });
    expect(host.textContent).toContain(label);
  });

  it('вне очереди (showAlert=false) подписи причины нет', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() =>
      createRoot(host).render(
        React.createElement(AgentCard, {
          agent: { chat_id: 3, name: 'И', queue_reason: 'hold_armed', is_paused: false },
        }),
      ),
    );
    expect(host.textContent).not.toContain('Передать аналитика');
  });
});

describe('AgentCard: чат без данных', () => {
  it('без имени — номер чата; без возраста и города — почему пусто', () => {
    const nowS = Math.floor(Date.now() / 1000);
    const host = render({ chat_id: 8553341591, account_id: null, name: null, age: null, city: null, queue_reason: 'qual_gap', waiting_since: nowS - 86400 });
    expect(host.textContent).toContain('Чат 8553341591');
    expect(host.textContent).toContain('аккаунт удалён');
    expect(host.textContent).not.toContain('— · —');
  });

  it('есть аккаунт — его ник; вброса нет — без серого значка', () => {
    const host = render({ chat_id: 5, account_id: 2, account_username: 'nassstttsa', name: null, queue_reason: 'qual_gap', waiting_since: 1 });
    expect(host.textContent).toContain('@nassstttsa');
    expect(host.querySelector('[title="Вброса нет"]')).toBeNull();
  });
});
