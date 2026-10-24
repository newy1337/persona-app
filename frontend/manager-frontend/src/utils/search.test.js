import { describe, it, expect } from 'vitest';
import { matchesQuery, matchesHeadFilters, matchesDateFilter } from './search';
import { moscowDay, moscowMidnight } from './panelTime';

const ROW = {
  chat_id: 2055107445,
  name: 'Сергей',
  city: 'Москва',
  phone: '+79161112233',
  account_id: 7,
  is_paused: false,
};

describe('matchesQuery — поиск по клиенту', () => {
  it('пустой запрос пропускает всё', () => {
    expect(matchesQuery(ROW, '')).toBe(true);
    expect(matchesQuery(ROW, '   ')).toBe(true);
  });

  it('находит по имени и городу без учёта регистра', () => {
    expect(matchesQuery(ROW, 'серг')).toBe(true);
    expect(matchesQuery(ROW, 'МОСКВА')).toBe(true);
    expect(matchesQuery(ROW, 'Питер')).toBe(false);
  });

  it('находит по номеру, набранному БЕЗ +7 — сравниваются только цифры', () => {
    expect(matchesQuery(ROW, '9161112233')).toBe(true);
    expect(matchesQuery(ROW, '1112233')).toBe(true);
    expect(matchesQuery(ROW, '+7 (916) 111-22-33')).toBe(true);
    expect(matchesQuery(ROW, '9990000000')).toBe(false);
  });

  it('находит по chat_id и аккаунту', () => {
    expect(matchesQuery(ROW, '2055107')).toBe(true);
    expect(matchesQuery(ROW, '7')).toBe(true);
  });

  it('не падает на строке без телефона и имени', () => {
    expect(matchesQuery({ chat_id: 1 }, 'сергей')).toBe(false);
    expect(matchesQuery({ chat_id: 1 }, '1')).toBe(true);
  });
});

describe('matchesHeadFilters — фильтры шапки', () => {
  it('пустые фильтры пропускают всё', () => {
    expect(matchesHeadFilters(ROW, { lead: '', account: '' })).toBe(true);
    expect(matchesHeadFilters(ROW, undefined)).toBe(true);
  });

  it('«ведёт» различает бота и менеджера по is_paused', () => {
    expect(matchesHeadFilters(ROW, { lead: 'bot' })).toBe(true);
    expect(matchesHeadFilters(ROW, { lead: 'manager' })).toBe(false);
    const paused = { ...ROW, is_paused: true };
    expect(matchesHeadFilters(paused, { lead: 'manager' })).toBe(true);
    expect(matchesHeadFilters(paused, { lead: 'bot' })).toBe(false);
  });

  it('аккаунт сравнивается строкой (значение приходит из <option value>)', () => {
    expect(matchesHeadFilters(ROW, { account: '7' })).toBe(true);
    expect(matchesHeadFilters(ROW, { account: '8' })).toBe(false);
  });
});

describe('matchesDateFilter — «SELECT DATE»', () => {
  const DAY = 24 * 3600;
  const NOW = Math.floor(Date.now() / 1000);
  const rowAt = (ts) => ({ ...ROW, last_message_ts: ts });
  // Сутки у фильтра московские, а не по часам машины: на сервере в UTC между
  // 21:00 и полуночью местная полночь попадает уже во вчера по Москве.
  const startToday = moscowMidnight(moscowDay(new Date()));

  it('пустой фильтр пропускает всё, даже без last_message_ts', () => {
    expect(matchesDateFilter({ ...ROW, last_message_ts: 0 }, '')).toBe(true);
    expect(matchesDateFilter(ROW, '')).toBe(true);
  });

  it('«Сегодня» — календарный день, «Вчера» — день до него', () => {
    const today = rowAt(Math.floor(+startToday / 1000) + 3600);
    const yesterday = rowAt(Math.floor(+startToday / 1000) - DAY + 3600);
    expect(matchesDateFilter(today, 'today')).toBe(true);
    expect(matchesDateFilter(today, 'yesterday')).toBe(false);
    expect(matchesDateFilter(yesterday, 'yesterday')).toBe(true);
    expect(matchesDateFilter(yesterday, 'today')).toBe(false);
  });

  it('окна 7/30 дней считаются от сейчас', () => {
    const inSevenDays = rowAt(NOW - 6 * DAY);
    const justOverSeven = rowAt(NOW - 8 * DAY);
    const inThirty = rowAt(NOW - 29 * DAY);
    expect(matchesDateFilter(inSevenDays, '7d')).toBe(true);
    expect(matchesDateFilter(justOverSeven, '7d')).toBe(false);
    expect(matchesDateFilter(justOverSeven, '30d')).toBe(true);
    expect(matchesDateFilter(inThirty, '30d')).toBe(true);
  });

  it('date:YYYY-MM-DD — конкретный календарный день', () => {
    const ts = Math.floor(new Date(2026, 7, 1, 12).getTime() / 1000);
    expect(matchesDateFilter(rowAt(ts), 'date:2026-08-01')).toBe(true);
    expect(matchesDateFilter(rowAt(ts), 'date:2026-08-02')).toBe(false);
  });

  it('без последнего сообщения ни один фильтр не проходит', () => {
    const bare = { ...ROW, last_message_ts: 0 };
    for (const f of ['today', '7d', 'date:2026-08-01']) {
      expect(matchesDateFilter(bare, f)).toBe(false);
    }
  });
});

import { withArchive } from './search';

describe('поиск с архивом', () => {
  it('добавляет архивные диалоги без дублей и помечает их', () => {
    const rows = [{ chat_id: 1 }, { chat_id: 2 }];
    rows.total = 2;
    const merged = withArchive(rows, [{ chat_id: 2 }, { chat_id: 3 }]);
    expect(merged.map((r) => r.chat_id)).toEqual([1, 2, 3]);
    expect(merged[2].hidden).toBe(true);
    expect(merged[1].hidden).toBeUndefined();
    expect(merged.total).toBe(2);
  });

  it('без архива возвращает тот же список', () => {
    const rows = [{ chat_id: 1 }];
    expect(withArchive(rows, [])).toBe(rows);
  });
});
