import { goodnightReason } from './goodnight-policy';
import { forecastNextAction, ForecastInput } from './forecast';
import { DEFAULT_RHYTHM } from '../config/rhythm';
const now = Date.parse('2026-09-24T16:55:00Z') / 1000;
const message = (role: string, content: string, age = 30 * 60) =>
  ({ role, content, created_at: now - age }) as any;
it.each([
  'Продолжим? Расскажи, что было дальше',
  'Хочу обсудить отпуск',
  'Не собираюсь спать',
  'Я еще не засыпаю',
  '«Завтра рано вставать», сказал коллега',
  'Ты собираешься спать?',
  'Я уже засыпаю, но давай еще поговорим',
])('does not turn %s into a goodnight reason', (text) => {
  expect(goodnightReason([message('user', text)], now)).toBeNull();
});
it('requires a fresh closing cue in the most recent user turn and no previous goodbye', () => {
  const history = [
    message('user', 'Я уже засыпаю'),
    message('assistant', 'Сегодня много дел было'),
  ];
  expect(goodnightReason(history, now)).toBe('Я уже засыпаю');
  expect(
    goodnightReason(
      [...history, message('user', 'А про отпуск расскажи')],
      now,
    ),
  ).toBeNull();
  expect(
    goodnightReason([...history, message('assistant', 'Спокойной ночи')], now),
  ).toBeNull();
  expect(goodnightReason(history, now + 2 * 3600)).toBeNull();
});
it('does not forecast a scheduled goodbye just because the 23:00 window opened', () => {
  const state = {
    history: [
      message('user', 'Расскажи про отпуск'),
      message('assistant', 'Мне понравилось море'),
    ],
  } as any;
  const args: ForecastInput = {
    chatId: 1,
    nowTs: now,
    stopped: false,
    ready: true,
    hasAccount: true,
    paused: false,
    refused: false,
    schedule: null,
    lastRole: 'assistant',
    lastUserTs: now - 1800,
    lastAssistantTs: now - 1700,
    state,
    rhythm: {
      ...DEFAULT_RHYTHM,
      timezone: 'Asia/Bangkok',
      morning: { enabled: false, from: '07:00', to: '11:00' },
      goodnight: { enabled: true, from: '23:00', to: '00:00' },
    },
    settings: {
      initiative_enabled: true,
      proactive_max_per_day: 1,
      quiet_start: '00:00',
      quiet_end: '00:00',
    },
  };
  expect(forecastNextAction(args)).toEqual({ kind: 'none' });
});
