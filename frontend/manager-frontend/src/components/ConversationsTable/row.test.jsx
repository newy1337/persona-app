// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import ConversationsTable from './ConversationsTable';

const now = Math.floor(Date.now() / 1000);
const row = (id, extra = {}) => ({
  chat_id: id,
  id,
  name: `Клиент ${id}`,
  last_message_ts: now - id,
  unread_count: 0,
  stage: { id: 'knock', title: 'Знакомство', index: 1, total: 5 },
  ...extra,
});

const LIST = [
  row(1, { age: 27, city: 'Томск', client_username: 'tomsk_user', phone: '+79160000001' }),
  row(2, { is_paused: true, unread_count: 2, stage: { id: 'warm', title: 'Разговорились', index: 2, total: 5 } }),
  row(3, { stage: { id: 'warm', title: 'Разговорились', index: 2, total: 5 }, blocked_by_client_at: now }),
];

let host;
let root;

beforeEach(() => {
  navigate.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const draw = async (props = {}) =>
  act(async () => root.render(<ConversationsTable rows={LIST} {...props} />));

const dataRows = () => [...host.querySelectorAll('tbody tr')];
const tabs = () => [...host.querySelectorAll('[role="group"][aria-label="Стадии диалогов"] button')];
const tab = (label) => tabs().find((b) => b.textContent.startsWith(label));

describe('строка диалога', () => {
  it('клик по строке и кнопка «Открыть» ведут в диалог', async () => {
    await draw();
    await act(async () => dataRows()[0].click());
    expect(navigate).toHaveBeenLastCalledWith('/conversation/1');
    await act(async () => dataRows()[1].querySelector('button[aria-label="Открыть"]').click());
    expect(navigate).toHaveBeenLastCalledWith('/conversation/2');
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('«В архив» — иконка со своим обработчиком, строку не открывает', async () => {
    const onHide = vi.fn();
    await draw({ onHide });
    await act(async () => dataRows()[0].querySelector('button[aria-label="В архив"]').click());
    expect(onHide).toHaveBeenCalledWith(1, true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('в архиве действие называется «Вернуть из архива»', async () => {
    const onHide = vi.fn();
    await act(async () => root.render(<ConversationsTable rows={[row(7, { hidden: true })]} showHidden onHide={onHide} />));
    await act(async () => host.querySelector('button[aria-label="Вернуть из архива"]').click());
    expect(onHide).toHaveBeenCalledWith(7, false);
  });

  it('без обработчика архива в строке только «Открыть»', async () => {
    await draw();
    expect(dataRows()[0].querySelectorAll('td:last-child button').length).toBe(1);
  });

  const cellOf = (rowIndex, label) => {
    const index = [...host.querySelectorAll('thead th')].findIndex((th) => th.textContent.trim() === label);
    return dataRows()[rowIndex].querySelectorAll('td')[index];
  };

  it('под именем — возраст и город, контакт в своей колонке, остальное — в подсказке', async () => {
    await draw();
    expect(cellOf(0, 'Собеседник').textContent).toContain('27 лет · Томск');
    const contact = cellOf(0, 'Контакт');
    expect(contact.textContent).toBe('@tomsk_user');
    expect(contact.querySelector('a').getAttribute('href')).toBe('https://t.me/tomsk_user');
    const hint = contact.querySelector('[title]').getAttribute('title');
    expect(hint).toContain('+79160000001');
    expect(hint).toContain('ID 1');
  });

  it('без ника в контакте номер чата, блокировка видна под именем', async () => {
    await draw();
    expect(cellOf(2, 'Собеседник').textContent).toContain('Заблокировал(а) нас');
    expect(cellOf(2, 'Контакт').textContent).toBe('ID 3');
  });

  it('ручной режим с новыми сообщениями: метка, «Менеджер» и «клиент ждёт ответа»', async () => {
    await draw();
    expect(dataRows()[1].querySelector('[data-testid="new-badge"]').textContent).toBe('2 новых');
    expect(cellOf(1, 'Ведёт').textContent).toBe('Менеджер');
    expect(cellOf(1, 'Что дальше').textContent).toBe('клиент ждёт ответа');
    expect(cellOf(0, 'Ведёт').textContent).toBe('Бот');
  });

  it('менеджер, регион и аккаунт — отдельные колонки', async () => {
    await act(async () =>
      root.render(
        <ConversationsTable
          rows={[row(9, { manager_username: 'olga', region_code: '0077', account_username: 'sender_9' })]}
        />,
      ),
    );
    expect(cellOf(0, 'Менеджер').textContent).toBe('olga');
    expect(cellOf(0, 'Регион').textContent).toBe('0077');
    expect(cellOf(0, 'Аккаунт').textContent).toBe('@sender_9');
  });

  it('клик по селекту этапа сделки не открывает диалог', async () => {
    await draw({ onDealStage: vi.fn() });
    await act(async () => dataRows()[0].querySelector('[data-testid="deal-stage"] select').click());
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('воронка стадий над таблицей', () => {
  it('первым идёт «Все», дальше стадии со своими числами', async () => {
    await draw();
    expect(tabs().map((b) => b.textContent)).toEqual(['Все3', 'Знакомство1', 'Разговорились2']);
    expect(tab('Все').getAttribute('aria-pressed')).toBe('true');
  });

  it('сегмент фильтрует строки, счётчик пишет «НАЙДЕНО», повторный клик снимает фильтр', async () => {
    await draw();
    await act(async () => tab('Разговорились').click());
    expect(dataRows().length).toBe(2);
    expect(host.textContent).toContain('НАЙДЕНО: 2 из 3');
    expect(tab('Разговорились').getAttribute('aria-pressed')).toBe('true');
    await act(async () => tab('Разговорились').click());
    expect(dataRows().length).toBe(3);
    expect(host.textContent).toContain('ВСЕГО: 3');
  });

  it('счётчик в шапке сбрасывает фильтр по стадии и выключен без него', async () => {
    await draw();
    const counter = () => [...host.querySelectorAll('button')].find((b) => /ВСЕГО|НАЙДЕНО/.test(b.textContent));
    expect(counter().disabled).toBe(true);
    await act(async () => tab('Знакомство').click());
    expect(counter().disabled).toBe(false);
    await act(async () => counter().click());
    expect(dataRows().length).toBe(3);
    expect(tab('Все').getAttribute('aria-pressed')).toBe('true');
  });

  it('«Все» снимает фильтр', async () => {
    await draw();
    await act(async () => tab('Знакомство').click());
    expect(dataRows().length).toBe(1);
    await act(async () => tab('Все').click());
    expect(dataRows().length).toBe(3);
  });
});

describe('внешние условия отбора', () => {
  it('onlyNew оставляет только чаты на ручном режиме с новыми сообщениями', async () => {
    await draw({ onlyNew: true });
    expect(dataRows().length).toBe(1);
    expect(dataRows()[0].getAttribute('data-chat-id')).toBe('2');
  });

  it('headerExtra встаёт в шапку таблицы', async () => {
    await draw({ headerExtra: <span data-testid="extra">подсказка</span> });
    expect(host.querySelector('h2').parentElement.querySelector('[data-testid="extra"]')).not.toBeNull();
  });
});

describe('сортировка по заголовкам колонок', () => {
  it('клик по «Собеседник» сортирует по имени, второй — в обратную сторону', async () => {
    await draw();
    const head = () => [...host.querySelectorAll('thead button')].find((b) => b.textContent.includes('Собеседник'));
    await act(async () => head().click());
    expect(head().closest('th').getAttribute('aria-sort')).toBe('ascending');
    expect(dataRows().map((r) => r.getAttribute('data-chat-id'))).toEqual(['1', '2', '3']);
    await act(async () => head().click());
    expect(head().closest('th').getAttribute('aria-sort')).toBe('descending');
    expect(dataRows().map((r) => r.getAttribute('data-chat-id'))).toEqual(['3', '2', '1']);
  });
});
