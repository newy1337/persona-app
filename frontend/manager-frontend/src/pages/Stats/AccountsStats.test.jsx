// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import AccountsStats from './AccountsStats';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

test('добавлено и слетело по командам и менеджерам, TG и VK отдельно', async () => {
  const data = {
    total: { tg_added: 5, vk_added: 2, tg_lost: 1, vk_lost: 1, lost_chats: 14 },
    teams: [{ manager_id: 3, username: 'ae-lead', role: 'teamlead', region_code: '0808', members: 2, tg_added: 5, vk_added: 2, tg_lost: 1, vk_lost: 1, lost_chats: 14 }],
    managers: [{ manager_id: 5, username: 'ae-man', region_code: '0808', tg_added: 5, vk_added: 2, tg_lost: 1, vk_lost: 1, lost_chats: 14 }],
  };
  await act(async () => root.render(<AccountsStats data={data} />));
  const kpis = host.querySelector('[data-testid="accounts-kpis"]').textContent;
  expect(kpis).toContain('Добавлено7TG 5 · VK 2');
  expect(kpis).toContain('Слетело2TG 1 · VK 1');
  expect(host.querySelector('[data-testid="accounts-teams"] tbody tr').textContent).toBe('ae-lead · Тимлид, 2 в команде0808521114');
  expect(host.querySelector('[data-testid="accounts-managers"] tbody tr').textContent).toBe('ae-man0808521114');
});
