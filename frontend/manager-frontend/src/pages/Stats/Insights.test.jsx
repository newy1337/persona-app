// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { AccountsTab, ActivityTab, FunnelTab, duration } from './Insights';

const STEPS = [
  { id: 'written', label: 'Написали' },
  { id: 'replied', label: 'Ответили' },
  { id: 'soglas', label: 'Соглас' },
  { id: 'lead', label: 'Лид' },
  { id: 'deposit', label: 'Депозит' },
];
const row = (key, label, f, cost) => ({ key, label, ...f, cost_usd: cost });
const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
grid[0][9] = 4;
const DATA = {
  steps: STEPS,
  funnel: { written: 10, replied: 5, soglas: 2, lead: 1, deposit: 1 },
  cost: { total_usd: 2, per_step: { written: 0.2, replied: 0.4, soglas: 1, lead: 2, deposit: 2 } },
  by: {
    source: [row('donor:mamba', 'mamba', { written: 6, replied: 4, soglas: 2, lead: 1, deposit: 1 }, 1.5), row('manual', 'вручную', { written: 4, replied: 1, soglas: 0, lead: 0, deposit: 0 }, 0.5)],
    persona: [], manager: [], account: [],
    type: [row('cold', 'Холодка', { written: 3, replied: 1, soglas: 0, lead: 0, deposit: 0 }, 0.3)],
  },
  accounts: [
    { id: 1, label: '@nastya', channel: 'telegram', status: 'active', messages_out: 20, messages_in: 15, chats: 4, replied_chats: 3, reply_rate: 0.75, leads_written: 4, leads_replied: 2, deposits: 1 },
    { id: 2, label: '+7999', channel: 'vk', status: 'banned', messages_out: 0, messages_in: 0, chats: 0, replied_chats: 0, reply_rate: null, leads_written: 0, leads_replied: 0, deposits: 0 },
  ],
  heatmap: grid,
  speed: { bot: { median_s: 75, p90_s: 600, n: 12 }, manager: { median_s: null, p90_s: null, n: 0 }, first_reply: { median_s: 7200, p90_s: 90000, n: 3 } },
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

describe('вкладки срезов статистики', () => {
  it('воронка: шаги с процентами от предыдущего и от написанных, стоимость результата', async () => {
    await act(async () => root.render(<FunnelTab data={DATA} />));
    const step = (id) => host.querySelector(`[data-step="${id}"]`).textContent;
    expect(step('written')).toContain('10 лидов');
    expect(step('replied')).toContain('50% · 50%');
    expect(step('deposit')).toContain('100% · 10%');
    expect(host.querySelector('[data-testid="cost-tiles"]').textContent).toContain('За «депозит»$2.00');
  });

  it('разрезы: по умолчанию источник, переключение на холодку / хот', async () => {
    await act(async () => root.render(<FunnelTab data={DATA} />));
    const rows = () => [...host.querySelectorAll('[data-testid="slice-table"] tbody tr')].map((tr) => tr.dataset.key);
    expect(rows()).toEqual(['donor:mamba', 'manual']);
    expect(host.querySelector('tr[data-key="donor:mamba"]').textContent).toContain('$1.50');
    const typeBtn = [...host.querySelectorAll('[data-testid="slice-switch"] button')].find((b) => b.textContent === 'Холодка / хот');
    await act(async () => typeBtn.click());
    expect(rows()).toEqual(['cold']);
  });

  it('аккаунты: процент ответа; забаненный — красный', async () => {
    await act(async () => root.render(<AccountsTab data={DATA} />));
    expect(host.querySelector('tr[data-account-id="1"]').textContent).toContain('75%');
    expect(host.querySelector('tr[data-account-id="2"]').dataset.problem).toBe('true');
    expect(host.querySelector('tr[data-account-id="1"]').dataset.problem).toBeUndefined();
  });

  it('активность: скорость и тепловая карта с понедельника', async () => {
    await act(async () => root.render(<ActivityTab data={DATA} />));
    const speed = host.querySelector('[data-testid="speed"]').textContent;
    expect(speed).toContain('1 мин');
    expect(speed).toContain('менеджеры за период не отвечали');
    expect(speed).toContain('2 ч');
    expect(host.querySelector('[data-cell="0-9"]').getAttribute('title')).toBe('Пн, 9:00–10:00 — 4 сообщ.');
  });

  it('длительность словами', () => {
    expect([duration(45), duration(600), duration(8100), duration(3 * 86400), duration(null)]).toEqual(['45 с', '10 мин', '2 ч 15 мин', '3 дн', '—']);
  });
});
