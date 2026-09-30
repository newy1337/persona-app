import { MAX_REPLY_BUBBLES, splitReplyMessages } from './split';

describe('splitReplyMessages', () => {
  it('каждая строка — отдельное сообщение', () => {
    const reply =
      'если честно, без чёткого плана живу)\nкогда прилетела, собиралась на три месяца\nк родителям очень хочу съездить';
    expect(splitReplyMessages(reply)).toEqual([
      'если честно, без чёткого плана живу)',
      'когда прилетела, собиралась на три месяца',
      'к родителям очень хочу съездить',
    ]);
  });

  it('пустые строки и пробелы по краям не дают пустых сообщений', () => {
    expect(splitReplyMessages('  привет)\r\n\r\n\n  как ты?  \n')).toEqual([
      'привет)',
      'как ты?',
    ]);
    expect(splitReplyMessages('одна строка')).toEqual(['одна строка']);
  });

  it(`больше ${MAX_REPLY_BUBBLES} строк — короткие соседние склеиваются, порядок и текст сохраняются`, () => {
    const lines = [
      'первая длинная мысль про погоду и море',
      'да',
      'ага',
      'вторая длинная мысль про работу',
      'третья мысль',
      'и последняя',
    ];
    const parts = splitReplyMessages(lines.join('\n'));
    expect(parts).toHaveLength(MAX_REPLY_BUBBLES);
    expect(parts.join('\n')).toBe(lines.join('\n'));
    expect(parts[1]).toBe('да\nага');
  });
});
