import { enforceReplyRules, isPlaceholderReply } from './reply';

describe('заглушка вместо ответа', () => {
  it('«верни пустую строку», понятое буквально, — тоже отказ писать', () => {
    for (const text of [
      '(пусто)',
      '(пустая строка)',
      '[пусто]',
      '[пустая строка]',
      'пусто',
      '(пустой ответ)',
      '«пустое сообщение»',
      '—',
      '...',
      'empty string',
    ])
      expect(isPlaceholderReply(text)).toBe(true);
  });

  it('обычные фразы со словом «пусто» не трогаем', () => {
    for (const text of [
      'Пусто как-то без тебя)',
      'Пусть дорога будет лёгкой)',
      'Пустырник это проверенное средство',
      'Доброе утро!',
    ])
      expect(isPlaceholderReply(text)).toBe(false);
  });

  it('заглушка не уходит собеседнику', () => {
    expect(() => enforceReplyRules('(пустая строка)')).toThrow(/empty reply/);
    expect(enforceReplyRules('Доброе утро)')).toBe('Доброе утро)');
  });
});
