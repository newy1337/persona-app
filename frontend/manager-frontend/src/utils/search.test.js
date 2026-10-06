import { describe, it, expect } from 'vitest';
import { matchesQuery, matchesHeadFilters } from './search';

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
