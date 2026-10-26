import { describe, expect, it } from 'vitest';
import { hasSetting, hasTop, menuFor, settingsPath } from './navigation';

const labels = (items) => items.map((item) => item.label);

describe('меню по ролям', () => {
  it('админ: шесть вкладок + Настройки; в Настройках все разделы', () => {
    const m = menuFor('admin');
    expect(labels(m.top)).toEqual(['Диалоги', 'Лиды', 'Войсер', 'Аккаунты', 'Менеджеры', 'Статистика', 'Настройки']);
    expect(labels(m.settings)).toEqual(['Аккаунты', 'Личности', 'Образы', 'LeadGet', 'Справочники', 'Буфер', 'Шаблоны ответов', 'Бот и API', 'Журнал']);
  });

  it('хед: без статистики (бэкенд отдаёт её только админу); в Настройках Команда, Буфер, Образы, Аккаунты', () => {
    const m = menuFor('head');
    expect(labels(m.top)).toEqual(['Диалоги', 'Лиды', 'Войсер', 'Настройки']);
    expect(labels(m.settings)).toEqual(['Команда', 'Буфер', 'Образы', 'Аккаунты', 'Шаблоны ответов']);
  });

  it('тимлид: в Настройках Буфер, Образы, Аккаунты', () => {
    const m = menuFor('teamlead');
    expect(labels(m.top)).toEqual(['Диалоги', 'Лиды', 'Войсер', 'Настройки']);
    expect(labels(m.settings)).toEqual(['Буфер', 'Образы', 'Аккаунты']);
  });

  it('менеджер: без Настроек, Аккаунты и Образы сверху', () => {
    const m = menuFor('manager');
    expect(labels(m.top)).toEqual(['Диалоги', 'Лиды', 'Войсер', 'Аккаунты', 'Образы']);
    expect(m.settings).toEqual([]);
  });

  it('войсер видит только Войсер; неизвестная роль — ничего', () => {
    expect(labels(menuFor('voice').top)).toEqual(['Войсер']);
    expect(menuFor('nobody')).toEqual({ top: [], settings: [] });
  });

  it('проверки доступа и адреса подвкладок', () => {
    expect(hasTop('admin', 'accounts')).toBe(true);
    expect(hasSetting('admin', 'accounts')).toBe(true);
    expect(hasTop('head', 'accounts')).toBe(false);
    expect(hasSetting('head', 'team')).toBe(true);
    expect(hasSetting('teamlead', 'team')).toBe(false);
    expect(settingsPath('leadget')).toBe('/settings/leadget');
    expect(menuFor('head').settings[0].to).toBe('/settings/team');
  });
});
