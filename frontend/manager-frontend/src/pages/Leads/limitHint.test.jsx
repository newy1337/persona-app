import { expect, test } from 'vitest';
import { limitHint } from './Leads';

const outreach = { daily_per_account: 10, accounts: [{ account_id: 7, sent_today: 4 }] };

test('лимит аккаунта: все сегодня или остальные ждут сброса', () => {
  expect(limitHint(5, outreach, 7)).toBe('Лимит аккаунта 10 в день, сегодня осталось 6 — напишет всем 5 сегодня.');
  expect(limitHint(30, outreach, 7)).toBe(
    'Лимит аккаунта 10 в день, сегодня осталось 6. Остальные 24 ждут в очереди сброса лимита (00:00 МСК) — ещё 3 дн. Другие аккаунты им не пишут.',
  );
  expect(limitHint(3, outreach, 99)).toContain('сегодня осталось 10');
  expect(limitHint(0, outreach, 7)).toBeNull();
  expect(limitHint(5, null, 7)).toBeNull();
});
