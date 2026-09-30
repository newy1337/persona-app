// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { authorClass, fmtChatDate, loadReadCursor, mediaUrl, saveReadCursor, telegramReadMark, withToken } from './chat';

const D1 = Math.floor(new Date(2026, 7, 20, 12).getTime() / 1000);

describe('authorClass', () => {
  it('клиент — только по role=user, автор в колонке не годится (в БД у всех llm)', () => {
    expect(authorClass({ role: 'user', author: 'llm' })).toBe('client');
    expect(authorClass({ role: 'assistant', author: 'llm' })).toBe('bot');
    expect(authorClass({ role: 'assistant', author: 'operator:777' })).toBe('manager');
  });
});

describe('fmtChatDate', () => {
  it('день недели + дата на русском', () => {
    const s = fmtChatDate(D1);
    expect(s).toContain('августа');
    expect(s).toContain('2026');
  });
});

describe('курсор прочтения (localStorage, per-чат)', () => {
  beforeEach(() => window.localStorage.clear());

  it('по умолчанию ничего не прочитано', () => {
    expect(loadReadCursor(111)).toBe(-1);
  });

  it('сохраняется и читается обратно, чаты не смешиваются', () => {
    saveReadCursor(111, 12);
    saveReadCursor(222, 3);
    expect(loadReadCursor(111)).toBe(12);
    expect(loadReadCursor(222)).toBe(3);
  });

  it('мусор в хранилище не валит страницу', () => {
    window.localStorage.setItem('chutter_mgr_read_v1:111', 'не-число');
    expect(loadReadCursor(111)).toBe(-1);
  });
});

describe('ссылки на вложения несут токен', () => {
  beforeEach(() => window.localStorage.setItem('nastya_manager_token', 'abc.def'));

  it('свои файлы — с токеном, внешние ссылки — как есть', () => {
    expect(withToken('/api/files/12')).toBe('/api/files/12?token=abc.def');
    expect(withToken('/api/files/12?x=1')).toBe('/api/files/12?x=1&token=abc.def');
    expect(withToken('https://example.com/a.ogg')).toBe('https://example.com/a.ogg');
    expect(withToken(null)).toBe(null);
    expect(mediaUrl(5, 100)).toBe('/api/conversations/5/media/100?token=abc.def');
  });
});

describe('галочки Telegram', () => {
  it('наше: ✓ доставлено, ✓✓ прочитано', () => {
    expect(telegramReadMark({ tg_read: false }, 'bot')).toMatchObject({ icon: '✓', read: false });
    expect(telegramReadMark({ tg_read: true }, 'manager')).toMatchObject({ icon: '✓✓', read: true });
  });

  it('его: ✓✓ аккаунт прочитал, ● ещё нет', () => {
    expect(telegramReadMark({ tg_read: true }, 'client')).toMatchObject({ icon: '✓✓', read: true });
    expect(telegramReadMark({ tg_read: false }, 'client')).toMatchObject({ icon: '●', read: false });
  });

  it('не ушло в Telegram или старый ответ сервера — без галочки', () => {
    expect(telegramReadMark({ tg_read: null }, 'bot')).toBeNull();
    expect(telegramReadMark({}, 'client')).toBeNull();
  });
});
