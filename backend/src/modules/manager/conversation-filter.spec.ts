import { type FilterableRow, matches, pageOf } from './conversation-filter';

const row = (
  id: number,
  extra: Partial<FilterableRow> = {},
): FilterableRow => ({
  chat_id: id,
  channel: 'telegram',
  account_id: 1,
  name: `Клиент ${id}`,
  city: null,
  phone: null,
  client_username: null,
  contact: null,
  manager_username: 'mgr',
  region_code: '0101',
  deal_stage: null,
  stage: null,
  is_paused: false,
  unread_count: 0,
  last_message_ts: 1000 + id,
  hidden: false,
  ...extra,
});

describe('список диалогов: отбор на сервере как в панели', () => {
  it('поиск: телефон по цифрам, ник с @ и без, имя и id', () => {
    const r = row(5, {
      phone: '+7 (900) 111-22-33',
      client_username: 'ivan_k',
      name: 'Иван',
    });
    expect(matches(r, { q: '9001112233' })).toBe(true);
    expect(matches(r, { q: '@ivan' })).toBe(true);
    expect(matches(r, { q: 'ivan_k' })).toBe(true);
    expect(matches(r, { q: 'иван' })).toBe(true);
    expect(matches(r, { q: '5' })).toBe(true);
    expect(matches(r, { q: 'петя' })).toBe(false);
  });

  it('канал, этап сделки (и «без этапа»), этап бота, кто ведёт, аккаунт', () => {
    const vk = row(1, {
      channel: 'vk',
      deal_stage: 'lead',
      is_paused: true,
      account_id: 7,
    });
    expect(matches(vk, { channel: 'vk' })).toBe(true);
    expect(matches(vk, { channel: 'tg' })).toBe(false);
    expect(matches(vk, { deal: 'lead' })).toBe(true);
    expect(matches(vk, { deal: 'none' })).toBe(false);
    expect(matches(row(2), { deal: 'none' })).toBe(true);
    expect(matches(vk, { lead: 'manager' })).toBe(true);
    expect(matches(vk, { lead: 'bot' })).toBe(false);
    expect(matches(vk, { account: '7' })).toBe(true);
    expect(matches(vk, { account: '8' })).toBe(false);
    const st = row(3, {
      stage: { id: 'knock', title: 'Знакомство', index: 1 },
    });
    expect(matches(st, { stage: 'knock' })).toBe(true);
    expect(matches(st, { stage: 'warm' })).toBe(false);
  });

  it('«новые на ручном» и период по последнему сообщению', () => {
    expect(
      matches(row(1, { is_paused: true, unread_count: 2 }), { only_new: true }),
    ).toBe(true);
    expect(
      matches(row(1, { is_paused: false, unread_count: 2 }), {
        only_new: true,
      }),
    ).toBe(false);
    expect(
      matches(row(1, { last_message_ts: 500 }), { since: 400, until: 600 }),
    ).toBe(true);
    expect(
      matches(row(1, { last_message_ts: 600 }), { since: 400, until: 600 }),
    ).toBe(false);
  });

  it('страница, общий итог и счётчики — по всем чатам, а не по странице', () => {
    const rows = Array.from({ length: 130 }, (_, i) =>
      row(i + 1, {
        channel: i % 3 === 0 ? 'vk' : 'telegram',
        deal_stage: i < 10 ? 'deposit' : null,
        is_paused: i < 4,
        unread_count: i < 2 ? 1 : 0,
      }),
    );
    const p = pageOf(rows, { channel: 'vk' }, 2, 20);
    expect(p.total).toBe(44);
    expect(p.all).toBe(130);
    expect(p.pages).toBe(3);
    expect(p.items).toHaveLength(20);
    expect(p.items.every((r) => r.channel === 'vk')).toBe(true);
    expect(p.facets.channel).toEqual({ all: 130, tg: 86, vk: 44 });
    expect(p.facets.deal.deposit).toBe(10);
    expect(p.facets.deal.none).toBe(120);
    expect(p.facets.new).toBe(2);
    expect(p.facets.no_deal.count).toBe(120);
    expect(p.facets.no_deal.signature).toMatch(/^[0-9a-f]{40}$/);
    expect(p.order).toHaveLength(44);
  });

  it('по умолчанию свежие сверху; сортировка по имени и обратно', () => {
    const rows = [
      row(1, { name: 'Борис' }),
      row(2, { name: 'Анна' }),
      row(3, { name: 'Вера' }),
    ];
    expect(pageOf(rows, {}, 1, 10).items.map((r) => r.chat_id)).toEqual([
      3, 2, 1,
    ]);
    expect(
      pageOf(rows, { sort: 'name' }, 1, 10).items.map((r) => r.name),
    ).toEqual(['Анна', 'Борис', 'Вера']);
    expect(
      pageOf(rows, { sort: 'name', dir: 'desc' }, 1, 10).items.map(
        (r) => r.name,
      ),
    ).toEqual(['Вера', 'Борис', 'Анна']);
  });

  it('номер страницы за пределами — последняя существующая', () => {
    const p = pageOf([row(1), row(2)], {}, 9, 1);
    expect(p.page).toBe(2);
    expect(p.items.map((r) => r.chat_id)).toEqual([1]);
  });
});
