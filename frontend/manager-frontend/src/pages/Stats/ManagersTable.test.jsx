// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

const { default: ManagersTable } = await import('./ManagersTable');

function render(rows) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => createRoot(host).render(React.createElement(ManagersTable, { rows })));
  return host;
}

const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

const ROWS = [
  {
    manager_id: 6,
    username: 'manager4',
    cost_usd: 12.5,
    calls: 400,
    tokens: { input: 1000, output: 500, cache_read: 9000, cache_write: 0 },
    chats: 14,
    messages_in: 120,
    messages_out: 150,
    manual_share: 0.2,
    leads_uploaded: 40,
    leads_valid: 32,
    leads_replied: 24,
    active_chats: 9,
    active_dialogs: 4,
    days: [
      { day: '2026-09-27', cost_usd: 7.5, calls: 250, tokens: { input: 600, output: 300, cache_read: 5000, cache_write: 0 }, messages_in: 70, messages_out: 90, manual_share: 0.1, leads_uploaded: 20, leads_valid: 16, leads_replied: 12, active_chats: 5 },
      { day: '2026-09-28', cost_usd: 5, calls: 150, tokens: { input: 400, output: 200, cache_read: 4000, cache_write: 0 }, messages_in: 50, messages_out: 60, manual_share: 0, leads_uploaded: 20, leads_valid: 16, leads_replied: 12, active_chats: 4 },
    ],
  },
  {
    manager_id: null,
    username: 'Без менеджера',
    cost_usd: 2.5,
    calls: 50,
    tokens: { input: 100, output: 50, cache_read: 900, cache_write: 0 },
    chats: 3,
    messages_in: 10,
    messages_out: 8,
    manual_share: 0,
    leads_uploaded: 0,
    leads_valid: 0,
    leads_replied: 0,
    active_chats: 1,
    days: [],
  },
];

describe('таблица по менеджерам', () => {
  it('показывает итоги и долю расхода', () => {
    const host = render(ROWS);
    const row = host.querySelector('[data-testid="manager-row-6"]');
    expect(row.textContent).toContain('manager4');
    expect(row.textContent).toContain('$12.50');
    expect(row.textContent).toContain('83%');
    expect(row.textContent).toContain('150 ↑');
    expect(row.textContent).toContain('20%');
    // «Номеров» — валидные с долей от загруженных, сами загруженные — в подсказке.
    expect(row.textContent).toContain('32 · 80%');
    expect(row.querySelector('[title="из 40 загруженных"]')).not.toBeNull();
    expect(row.textContent).toContain('75%');
    expect(row.textContent).toContain('9');
  });

  it('дни показываются по клику и прячутся обратно', () => {
    const host = render(ROWS);
    expect(host.querySelector('[data-testid="manager-day-6-2026-09-27"]')).toBeNull();

    click(host.querySelector('[data-testid="manager-row-6"]'));
    const days = host.querySelector('[data-testid="manager-day-6-2026-09-27"]');
    expect(days.textContent).toContain('27.09');
    expect(days.textContent).toContain('$7.50');

    click(host.querySelector('[data-testid="manager-row-6"]'));
    expect(host.querySelector('[data-testid="manager-day-6-2026-09-27"]')).toBeNull();
  });

  it('строка без дней говорит об этом, а не показывает пустоту', () => {
    const host = render(ROWS);
    click(host.querySelector('[data-testid="manager-row-none"]'));
    expect(host.querySelector('[data-testid="manager-day-none-none"]').textContent).toContain('Дней с работой нет');
  });

  it('раскрытые строки не мешают друг другу', () => {
    const host = render(ROWS);
    click(host.querySelector('[data-testid="manager-row-6"]'));
    click(host.querySelector('[data-testid="manager-row-none"]'));
    expect(host.querySelector('[data-testid="manager-day-6-2026-09-27"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="manager-day-none-none"]')).not.toBeNull();
  });

  it('активные диалоги — отдельный столбец, в итоге складываются', () => {
    const host = render(ROWS);
    expect(host.querySelector('[data-testid="manager-row-6"] [data-testid="active-dialogs"]').textContent).toBe('4');
    const rows = [...host.querySelectorAll('tbody tr')];
    expect(rows[rows.length - 1].querySelector('[data-testid="active-dialogs"]').textContent).toBe('4');
  });

  it('за пустой период таблица не рисуется', () => {
    expect(render([]).textContent).toContain('За период работы не было');
  });
});

describe('итог и сортировка', () => {
  it('нижняя строка складывает всех менеджеров', () => {
    const host = render(ROWS);
    const rows = [...host.querySelectorAll('tbody tr')];
    const total = rows[rows.length - 1];
    expect(total.textContent).toContain('Итого');
    expect(total.textContent).toContain('$15.00');
    expect(total.textContent).toContain('158 ↑');
  });

  it('по расходу строки идут сверху вниз', () => {
    const host = render(ROWS);
    const first = host.querySelectorAll('tbody tr')[0];
    expect(first.textContent).toContain('manager4');
  });

  it('клик по заголовку меняет порядок строк', () => {
    const host = render(ROWS);
    const headers = [...host.querySelectorAll('th')];
    click(headers.find((h) => h.textContent.startsWith('Переписок')));
    const first = host.querySelectorAll('tbody tr')[0];
    expect(first.textContent).toContain('manager4');
  });

  it('день раскрывается теми же столбцами и показывает воронку', () => {
    const host = render(ROWS);
    click(host.querySelector('[data-testid="manager-row-6"]'));
    const day = host.querySelector('[data-testid="manager-day-6-2026-09-28"]');
    expect(day.textContent).toContain('28.09');
    expect(day.textContent).toContain('$5.00');
    expect(day.textContent).toContain('16 · 80%');
    // имя, расход, номеров, ответили, переписок, активных, сообщений и шесть этапов
    expect(day.querySelectorAll('td').length).toBe(13);
  });
});

describe('таблица по командам', () => {
  const TEAMS = [
    { ...ROWS[0], manager_id: 9, username: 'boss', role: 'head', region_code: '0101', members: 3, lead_id: null, direct: [10, 6] },
    { ...ROWS[0], manager_id: 10, username: 'lead', role: 'teamlead', region_code: '0101', members: 1, lead_id: 9, direct: [] },
  ];
  const renderTeams = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => createRoot(host).render(React.createElement(ManagersTable, { rows: ROWS, teams: TEAMS, title: 'По командам' })));
    return host;
  };

  it('показывает роль, регион и размер команды под названием', () => {
    const host = renderTeams();
    expect(host.querySelector('h3').textContent).toBe('По командам');
    expect(host.querySelector('th').textContent).toBe('Команда / менеджер');
    expect(host.querySelector('[data-testid="team-meta-9"]').textContent).toBe('хед · регион 0101 · команда: 3 чел.');
  });

  it('тимлид с хедом не дублируется наверху, а раскрывается внутри команды хеда', () => {
    const host = renderTeams();
    expect(host.querySelector('[data-testid="team-row-10"]')).toBeNull();
    expect(host.querySelector('[data-testid="manager-row-6"]')).toBeNull();
    click(host.querySelector('[data-testid="team-row-9"]'));
    expect(host.querySelector('[data-testid="team-row-10"]').textContent).toContain('lead');
    expect(host.querySelector('[data-testid="manager-row-6"]').textContent).toContain('manager4');
  });

  it('менеджеры вне команд собраны в группу «Без команды»', () => {
    const host = renderTeams();
    const loose = host.querySelector('[data-testid="team-row-loose"]');
    expect(loose.textContent).toContain('Без команды');
    expect(loose.textContent).toContain('$2.50');
    click(loose);
    expect(host.querySelector('[data-testid="manager-row-none"]').textContent).toContain('Без менеджера');
  });
});
