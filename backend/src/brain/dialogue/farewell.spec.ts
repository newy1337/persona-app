import {
  dropRepeatedFarewell,
  isClosingOnly,
  isMorningText,
  saidGoodnightRecently,
  saidMorningRecently,
} from './farewell';

const NOW = 1_789_000_000;

describe('прощание и «доброе утро» — по одному разу', () => {
  it('ответ-закрытие после прощания', () => {
    for (const t of [
      'и тебе)',
      'Сладких снов, Настюш🤗',
      'Спокойной, еще раз)',
      'спасибо, спокойной',
      '🤗',
      'пока-пока',
    ]) {
      expect(isClosingOnly(t)).toBe(true);
    }
    for (const t of [
      'Так а по каким?)',
      'Пиши, как проснешься)))) Ты мне сделала день ярче',
      'и тебе, а завтра что делаешь?',
    ]) {
      expect(isClosingOnly(t)).toBe(false);
    }
  });

  it('прощалась или здоровалась недавно — по её словам, не по реакциям и не по его', () => {
    const history = [
      { role: 'user', content: 'спокойной ночи', created_at: NOW - 100 },
      { role: 'assistant', content: '[Реакция: 🥰]', created_at: NOW - 50 },
    ];
    expect(saidGoodnightRecently(history, NOW)).toBe(false);
    expect(
      saidGoodnightRecently(
        [
          ...history,
          {
            role: 'assistant',
            content: 'спокойной ночи, Саш🤗',
            created_at: NOW - 3600,
          },
        ],
        NOW,
      ),
    ).toBe(true);
    expect(
      saidGoodnightRecently(
        [
          {
            role: 'assistant',
            content: 'спокойной ночи',
            created_at: NOW - 11 * 3600,
          },
        ],
        NOW,
      ),
    ).toBe(false);
    expect(
      saidMorningRecently(
        [
          {
            role: 'assistant',
            content: 'доброе утро) как спалось?',
            created_at: NOW - 3600,
          },
        ],
        NOW,
      ),
    ).toBe(true);
    expect(isMorningText('С добрым утром!')).toBe(true);
    expect(isMorningText('утро было тяжёлое')).toBe(false);
  });

  it('повторное прощание вырезается: строка целиком или хвост', () => {
    const drop = { goodnight: true, morning: false };
    expect(
      dropRepeatedFarewell(
        'ты меня смущаешь)\nконечно напишу, как проснусь\nспокойной ночи, Саш🤗',
        drop,
      ),
    ).toBe('ты меня смущаешь)\nконечно напишу, как проснусь');
    expect(
      dropRepeatedFarewell('больше по Таиланду катаюсь) спокойной ночи', drop),
    ).toBe('больше по Таиланду катаюсь)');
    expect(dropRepeatedFarewell('спокойной) 🌙', drop)).toBe('');
    expect(dropRepeatedFarewell('спокойной ночи, до завтра🤗', drop)).toBe('');
    expect(
      dropRepeatedFarewell('спокойной ночи', {
        goodnight: false,
        morning: false,
      }),
    ).toBe('спокойной ночи');
    expect(
      dropRepeatedFarewell('доброе утро) как спалось?', {
        goodnight: false,
        morning: true,
      }),
    ).toBe('');
    expect(
      dropRepeatedFarewell('ну привет\nс добрым утром тебя', {
        goodnight: false,
        morning: true,
      }),
    ).toBe('ну привет');
  });
});
