// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const calls = vi.hoisted(() => []);
vi.mock('../../api/regionStats', () => ({
  getRegionStats: vi.fn(async (q) => {
    calls.push(q);
    const stage0 = { vbros: 0, predloga: 0, soglas: 0, lead: 0, deposit: 0, archive: 0 };
    return {
      region: '737', regions: [],
      range: { from: '2026-10-01', to: '2026-10-31', days: [] },
      total: { cost_usd: 12.5, calls: 100, leads_uploaded: 40, leads_valid: 30, leads_replied: 9, active_chats: 7, messages_in: 50, messages_out: 60 },
      managers: [{ manager_id: 5, username: 'rs-man', cost_usd: 12.5, calls: 100, tokens: { input: 1, cache_read: 0, cache_write: 0, output: 0 }, leads_uploaded: 40, leads_valid: 30, leads_replied: 9, active_chats: 7, messages_in: 50, messages_out: 60, manual_share: 0, stages: { ...stage0, vbros: 3 }, days: [] }],
      stages: { stages: [{ id: 'vbros', label: 'Вброс' }], days: [], totals: { ...stage0, vbros: 3 }, reached: { ...stage0, vbros: 5 } },
      cold: { active_after: 3, totals: { received: 4, written: 3, invalid: 1, replied: 1, active: 0 }, by_manager: [] },
      sources: {
        statuses: ['contacted', 'replied'], stages: [{ id: 'vbros', label: 'Вброс' }],
        by_source: [{ source: 'base', label: 'Базовик', leads: 12, statuses: { contacted: 8, replied: 4 }, stages: { vbros: 2 } }],
      },
      traffic: [
        { type: 'cold', label: 'Холодка', leads_uploaded: 30, leads_replied: 6, cost_usd: 10 },
        { type: 'hot', label: 'Hot', leads_uploaded: 10, leads_replied: 3, cost_usd: 2.5 },
        { type: 'none', label: 'Тип не указан', leads_uploaded: 0, leads_replied: 0, cost_usd: 0 },
      ],
    };
  }),
}));
const { default: RegionStats } = await import('./RegionStats');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const tab = (id) => host.querySelector(`[data-testid="region-tab-${id}"]`);

test('хед видит свой регион: итог, менеджеры, этапы, холодка и трафик', async () => {
  await act(async () => root.render(<RegionStats />));
  expect(host.textContent).toContain('регион 737');
  expect(host.querySelector('select[aria-label="Регион"]')).toBeNull();
  const kpis = host.querySelector('[data-testid="region-kpis"]').textContent;
  expect(kpis).toContain('$12.50');
  expect(kpis).toContain('40');
  expect(host.textContent).toContain('rs-man');

  await act(async () => tab('stages').click());
  expect(host.querySelector('[data-testid="stages-table"]')).toBeTruthy();
  await act(async () => tab('cold').click());
  expect(host.querySelector('[data-testid="cold-kpis"]').textContent).toContain('4');
  await act(async () => tab('traffic').click());
  const rows = [...host.querySelectorAll('[data-testid="traffic-table"] tbody tr')].map((r) => r.textContent);
  expect(rows).toEqual(['Холодка306 · 20%$10.00', 'Hot103 · 30%$2.50']);
  expect(calls[0]).toMatchObject({ region: '' });
  await act(async () => tab('sources').click());
  const src = [...host.querySelectorAll('[data-testid="sources-table"] tbody tr')].map((r) => r.textContent);
  expect(src).toEqual(['Базовик12842']);
});
