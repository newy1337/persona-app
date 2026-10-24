import { forecastNextAction, type ForecastInput } from './forecast';
import { DEFAULT_RHYTHM } from '../config/rhythm';

const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const msg = (role: string, iso: string, source = 'dialogue') =>
  ({ role, content: 'x', created_at: ts(iso), source }) as any;

function input(over: Partial<ForecastInput> = {}): ForecastInput {
  return {
    chatId: 111,
    nowTs: ts('2026-09-16T12:00:00Z'),
    stopped: false,
    ready: true,
    hasAccount: true,
    paused: false,
    refused: false,
    schedule: null,
    lastRole: 'assistant',
    lastUserTs: ts('2026-09-16T11:00:00Z'),
    lastAssistantTs: ts('2026-09-16T11:05:00Z'),
    state: {
      history: [
        msg('user', '2026-09-16T11:00:00Z'),
        msg('assistant', '2026-09-16T11:05:00Z'),
      ],
    } as any,
    rhythm: DEFAULT_RHYTHM,
    settings: {
      initiative_enabled: true,
      proactive_max_per_day: 1,
      quiet_start: '23:00',
      quiet_end: '08:00',
    },
    ...over,
  };
}

describe('когда напишет бот', () => {
  it('ответ уже в очереди — время ответа и причина задержки', () => {
    const r = forecastNextAction(
      input({
        schedule: { dueAt: ts('2026-09-16T12:12:00Z'), reason: 'normal' },
        lastRole: 'user',
      }),
    );
    expect(r).toEqual({
      kind: 'reply',
      at: ts('2026-09-16T12:12:00Z'),
      reason: 'normal',
    });
  });

  it('ответ забран из очереди и пишется — «пишет ответ», а не «ответ не запланирован»', () => {
    expect(
      forecastNextAction(
        input({
          lastRole: 'user',
          lastUserTs: ts('2026-09-16T11:55:00Z'),
          composing: true,
        }),
      ),
    ).toEqual({ kind: 'composing' });
  });

  it('ручной режим, стоп, удалённый аккаунт, отказ — бот не пишет, и видно почему', () => {
    expect(forecastNextAction(input({ paused: true })).kind).toBe('manual');
    expect(forecastNextAction(input({ stopped: true })).kind).toBe('stopped');
    expect(forecastNextAction(input({ hasAccount: false })).kind).toBe(
      'no_account',
    );
    expect(forecastNextAction(input({ refused: true })).kind).toBe('refused');
    expect(forecastNextAction(input({ ready: false })).kind).toBe('no_model');
    expect(
      forecastNextAction(
        input({
          accountOnline: false,
          schedule: { dueAt: 1, reason: 'normal' },
          lastRole: 'user',
        }),
      ).kind,
    ).toBe('account_offline');
  });

  it('его сообщение без ответа: старое — не ответит, свежее — ответ не запланирован (ошибка)', () => {
    const old = ts('2026-09-01T10:00:00Z');
    expect(
      forecastNextAction(input({ lastRole: 'user', lastUserTs: old })),
    ).toEqual({ kind: 'no_reply', why: 'expired' });
    expect(
      forecastNextAction(
        input({ lastRole: 'user', lastUserTs: ts('2026-09-16T11:50:00Z') }),
      ),
    ).toEqual({ kind: 'no_reply', why: 'not_scheduled' });
  });

  it('уже писала сама и он не ответил — ждёт, второе подряд не пишет', () => {
    const state = {
      history: [
        msg('user', '2026-09-16T08:00:00Z'),
        msg('assistant', '2026-09-16T11:05:00Z', 'initiative'),
      ],
    } as any;
    expect(forecastNextAction(input({ state }))).toEqual({ kind: 'waiting' });
  });

  it('днём после разговора — «куда пропал», когда он молчит 3 часа', () => {
    const r = forecastNextAction(input());
    expect(r.kind).toBe('initiative');
    const at = (r as { at: number }).at;
    expect(at).toBeGreaterThanOrEqual(ts('2026-09-16T14:00:00Z'));
    expect(at).toBeLessThan(ts('2026-09-16T14:20:00Z'));
  });

  it('поздно вечером, прощание уже было — «доброе утро» утром следующего дня', () => {
    const state = {
      history: [
        msg('user', '2026-09-16T19:00:00Z'),
        msg('assistant', '2026-09-16T19:30:00Z'),
      ],
      rhythm: { goodnight: { '2026-09-16': 'sent' } },
    } as any;
    const r = forecastNextAction(
      input({
        nowTs: ts('2026-09-16T20:00:00Z'),
        lastUserTs: ts('2026-09-16T19:00:00Z'),
        lastAssistantTs: ts('2026-09-16T19:30:00Z'),
        state,
      }),
    );
    expect(r.kind).toBe('morning');
    const at = (r as { at: number }).at;
    expect(at).toBeGreaterThanOrEqual(ts('2026-09-17T04:00:00Z'));
    expect(at).toBeLessThan(ts('2026-09-17T08:00:00Z'));
  });

  it('инициатива выключена — сам не пишет', () => {
    expect(
      forecastNextAction(
        input({
          settings: {
            initiative_enabled: false,
            proactive_max_per_day: 1,
            quiet_start: '23:00',
            quiet_end: '08:00',
          },
        }),
      ).kind,
    ).toBe('initiative_off');
  });
  it('does not forecast morning or initiative over a remembered unanswered question', () => {
    expect(forecastNextAction(input({ unansweredQuestion: true }))).toEqual({
      kind: 'no_reply',
      why: 'not_scheduled',
    });
    expect(
      forecastNextAction(
        input({
          unansweredQuestion: true,
          schedule: { dueAt: 1, reason: 'normal' },
        }),
      ).kind,
    ).toBe('reply');
  });
});
