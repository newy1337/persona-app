import { describe, expect, it } from 'vitest';
import { REMINDER_KEY, rememberReminder, shouldRemind } from './stageReminder';

const store = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

describe('напоминание про этап', () => {
  it('считает диалоги без этапа, архив не считает', () => {
    const r = shouldRemind([{ chat_id: 1 }, { chat_id: 2, deal_stage: 'lead' }, { chat_id: 3, hidden: true }], '2026-10-05', store());
    expect(r).toMatchObject({ show: true, count: 1 });
  });

  it('после «Понятно» в тот же день с тем же списком не показывается, с новым списком — показывается', () => {
    const s = store();
    const rows = [{ chat_id: 1 }, { chat_id: 2 }];
    const first = shouldRemind(rows, '2026-10-05', s);
    rememberReminder(first.signature, '2026-10-05', s);
    expect(shouldRemind(rows, '2026-10-05', s).show).toBe(false);
    expect(shouldRemind([...rows, { chat_id: 3 }], '2026-10-05', s).show).toBe(true);
    expect(shouldRemind(rows, '2026-10-06', s).show).toBe(true);
    expect(JSON.parse(s.getItem(REMINDER_KEY)).day).toBe('2026-10-05');
  });

  it('без диалогов без этапа — молчит', () => {
    expect(shouldRemind([{ chat_id: 1, deal_stage: 'soglas' }], '2026-10-05', store()).show).toBe(false);
  });
});
