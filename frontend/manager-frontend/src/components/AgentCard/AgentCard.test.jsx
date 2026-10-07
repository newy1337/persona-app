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

describe('AgentCard: одна строка вместо карточки', () => {
  const card = (host) => host.querySelector('[data-testid="agent-card"]');

  it('строка — ссылка высотой 40px с классом agentCard', () => {
    const host = render({ chat_id: 10, name: 'Олег', queue_reason: 'qual_gap', waiting_since: 1 });
    expect(card(host).getAttribute('role')).toBe('link');
    expect(card(host).className).toContain('agentCard');
    expect(card(host).className).toContain('h-10');
  });

  it('показывает стадию диалога; вместо «кто ведёт» — логин менеджера, слова «Менеджер» нет', () => {
    const host = render({
      chat_id: 11,
      name: 'Олег',
      age: 43,
      city: 'Питер',
      queue_reason: 'qual_gap',
      waiting_since: 1,
      is_paused: true,
      manager_username: 'anna',
      region_code: 'spb',
      stage: { id: 'warm', title: 'стало привычкой', index: 3, total: 5 },
    });
    expect(host.querySelector('[data-testid="agent-stage"]').textContent).toBe('стало привычкой');
    expect(host.querySelector('[data-testid="agent-lead"]').textContent).toBe('anna');
    expect(host.textContent).toContain('43 года · Питер');
    // Полная атрибуция и этап остаются в подсказке строки.
    expect(card(host).title).toContain('Менеджер: anna');
    expect(card(host).title).toContain('Регион: spb');
    expect(card(host).title).toContain('этап 3 из 5');
  });

  it('без менеджера и стадии — «не назначен» и прочерк; кто ведёт остаётся в подсказке', () => {
    const host = render({ chat_id: 12, name: 'Олег', queue_reason: 'qual_gap', waiting_since: 1, is_paused: false });
    expect(host.querySelector('[data-testid="agent-lead"]').textContent).toBe('не назначен');
    expect(card(host).title).toContain('Ведёт: Бот');
    expect(host.querySelector('[data-testid="agent-stage"]').textContent).toBe('—');
    expect(card(host).title).toContain('Менеджер: не назначен');
  });

  it('клиент в сети — зелёная точка у аватара; печатает — вместо возраста и города', () => {
    const host = render({
      chat_id: 13,
      name: 'Олег',
      age: 21,
      city: 'Казань',
      queue_reason: 'qual_gap',
      waiting_since: 1,
      client_presence: { kind: 'online' },
      typing: 'voice',
    });
    expect(host.querySelector('[data-testid="agent-online"]')).not.toBeNull();
    expect(host.textContent).toContain('записывает голосовое…');
    expect(host.textContent).not.toContain('21 год');
    expect(render({ chat_id: 14, name: 'Олег', waiting_since: 1 }).querySelector('[data-testid="agent-online"]')).toBeNull();
  });

  it('значок вброса остаётся с подсказкой', () => {
    const host = render({ chat_id: 15, name: 'Олег', queue_reason: 'before_vbros', vbros_phase: 'predloga', waiting_since: 1 });
    expect(host.querySelector('[title="Вброс: predloga"]')).not.toBeNull();
  });

  it('вне очереди: время от последнего сообщения и счётчик непрочитанных', () => {
    const nowS = Math.floor(Date.now() / 1000);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const agent = { chat_id: 16, name: 'Олег', last_message_ts: nowS - 5 * 60, waiting_since: nowS - 7200, unread_count: 4 };
    act(() => createRoot(host).render(React.createElement(AgentCard, { agent })));
    expect(host.textContent).toContain('5 мин');
    expect(host.textContent).not.toContain('2 ч');
    expect(host.querySelector('[data-testid="agent-unread"]').textContent).toBe('4');
  });

  it('вне очереди без непрочитанных счётчика нет', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => createRoot(host).render(React.createElement(AgentCard, { agent: { chat_id: 17, name: 'Олег', unread_count: 0 } })));
    expect(host.querySelector('[data-testid="agent-unread"]')).toBeNull();
  });
});
