import { ACTIVE_AFTER, coldFunnel, type ColdLeadRow } from './cold-funnel';

const lead = (
  owner: number | null,
  written: boolean,
  user_msgs = 0,
): ColdLeadRow => ({ owner_user_id: owner, written, user_msgs });

const users = new Map([
  [1, { username: 'anna', role: 'manager', region_code: '001' }],
  [2, { username: 'boris', role: 'teamlead', region_code: '002' }],
]);

describe('воронка холодки', () => {
  it('получено → написали → ответили → активные, всего и по менеджерам', () => {
    const r = coldFunnel(
      [
        lead(1, false),
        lead(1, true),
        lead(1, true, 2),
        lead(1, true, ACTIVE_AFTER + 1),
        lead(2, true, 1),
      ],
      users,
    );
    expect(r.totals).toEqual({
      received: 5,
      written: 4,
      replied: 3,
      active: 1,
    });
    expect(r.by_manager).toEqual([
      {
        user_id: 1,
        username: 'anna',
        role: 'manager',
        region_code: '001',
        received: 4,
        written: 3,
        replied: 2,
        active: 1,
      },
      {
        user_id: 2,
        username: 'boris',
        role: 'teamlead',
        region_code: '002',
        received: 1,
        written: 1,
        replied: 1,
        active: 0,
      },
    ]);
  });

  it('активный — строго больше пяти сообщений лида', () => {
    const r = coldFunnel(
      [lead(1, true, ACTIVE_AFTER), lead(1, true, ACTIVE_AFTER + 1)],
      users,
    );
    expect(r.totals.active).toBe(1);
  });

  it('без нашего первого сообщения ответ не считается', () => {
    const r = coldFunnel([lead(1, false, 9)], users);
    expect(r.totals).toEqual({
      received: 1,
      written: 0,
      replied: 0,
      active: 0,
    });
  });

  it('удалённый сотрудник и лид без владельца — отдельными строками', () => {
    const r = coldFunnel([lead(7, true), lead(null, false)], users);
    expect(r.by_manager.map((m) => m.username).sort()).toEqual(['#7', '—']);
  });

  it('пустой период — нули и пустая таблица', () => {
    expect(coldFunnel([], users)).toEqual({
      totals: { received: 0, written: 0, replied: 0, active: 0 },
      by_manager: [],
    });
  });
});
