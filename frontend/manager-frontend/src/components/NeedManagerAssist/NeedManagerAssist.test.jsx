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

describe('очередь «Ждут менеджера»: компактная панель', () => {
  beforeEach(() => window.localStorage.clear());

  const list = (host) => host.querySelector('[data-testid="agent-list"]');
  const rows = (host) => host.querySelectorAll('[data-testid="agent-card"]');
  const expander = (host) => host.querySelector('button[aria-expanded]');
  const MANY = [1, 2, 3, 4, 5].map((id) => agent(id, 'hold_armed'));

  it('свёрнутая панель — ровно три строки высотой, остальное прокручивается внутри', () => {
    const host = render(MANY);
    expect(list(host).dataset.expanded).toBe('false');
    expect(list(host).className).toContain('h-[120px]');
    expect(list(host).className).toContain('overflow-y-auto');
    expect(expander(host).textContent).toBe('Все 5');
    expect(expander(host).getAttribute('aria-expanded')).toBe('false');
  });

  it('«Все N» раскрывает панель, «Свернуть» возвращает три строки', () => {
    const host = render(MANY);
    act(() => expander(host).click());
    expect(list(host).dataset.expanded).toBe('true');
    expect(list(host).className).toContain('max-h-[60vh]');
    expect(rows(host).length).toBe(5);
    expect(expander(host).textContent).toBe('Свернуть');
    expect(expander(host).getAttribute('aria-expanded')).toBe('true');
    act(() => expander(host).click());
    expect(list(host).dataset.expanded).toBe('false');
  });

  it('до трёх строк кнопка раскрытия невидима и недоступна, но место занимает', () => {
    const host = render([agent(1, 'hold_armed'), agent(2, 'media_photo')]);
    expect(expander(host).className).toContain('invisible');
    expect(expander(host).disabled).toBe(true);
    expect(list(host).className).toContain('h-[120px]');
  });

  it('галочка ручного режима по-прежнему фильтрует строки', () => {
    const host = render();
    expect(rows(host).length).toBe(2);
    act(() => toggle(host).click());
    expect(rows(host).length).toBe(4);
  });

  it('пустая очередь — «Никто не ждёт» в той же высоте', () => {
    const host = render([]);
    expect(list(host).textContent).toBe('Никто не ждёт');
    expect(list(host).className).toContain('h-[120px]');
  });

  it('с фильтром страницы пустой список просит сбросить фильтры', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => createRoot(host).render(React.createElement(NeedManagerAssist, { agents: AGENTS, query: 'нет такого' })));
    expect(list(host).textContent).toBe('Ничего не найдено — сбросьте фильтры и поиск');
  });

  it('в строке очереди есть стадия диалога и кто ведёт', () => {
    const host = render([agent(1, 'hold_armed')]);
    expect(host.querySelector('[data-testid="agent-stage"]').textContent).toBe('стало привычкой');
    expect(host.querySelector('[data-testid="agent-lead"]').textContent).toContain('Менеджер');
  });

  it('листания и выбора числа строк больше нет', () => {
    const host = render(MANY);
    expect(host.querySelector('select')).toBeNull();
    expect(host.querySelector('[aria-label="Следующая страница"]')).toBeNull();
  });

  it('пока идёт первая загрузка — три строки-заглушки вместо «Никто не ждёт»', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => createRoot(host).render(React.createElement(NeedManagerAssist, { agents: [], loading: true })));
    expect(list(host).textContent).toBe('');
    expect(list(host).querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
