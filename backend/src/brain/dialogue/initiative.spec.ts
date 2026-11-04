import {
  CHECK_IN_GUIDANCE,
  unansweredUnprompted,
  continueTopicGuidance,
  RECENT_TOPIC_S,
  secondsSinceLastMessage,
} from './initiative';
import { DEFAULT_RHYTHM, mergeRhythm } from '../config/rhythm';

const msg = (role: string, source: string) =>
  ({ role, content: 'x', created_at: 1, source }) as any;

describe('сообщения без повода подряд', () => {
  it('считаются только после его последнего сообщения и только её «сама написала»', () => {
    const state = {
      history: [
        msg('assistant', 'initiative'),
        msg('user', 'dialogue'),
        msg('assistant', 'dialogue'),
        msg('assistant', 'initiative'),
        msg('assistant', 'morning'),
      ],
    } as any;
    expect(unansweredUnprompted(state)).toBe(2);
  });

  it('он ответил — счёт с нуля; пустая история — ноль', () => {
    expect(
      unansweredUnprompted({
        history: [msg('assistant', 'goodnight'), msg('user', 'dialogue')],
      } as any),
    ).toBe(0);
    expect(unansweredUnprompted({} as any)).toBe(0);
  });

  it('по умолчанию — одно подряд; в ритме настраивается от 0 до 5', () => {
    expect(DEFAULT_RHYTHM.max_unanswered).toBe(1);
    expect(mergeRhythm({}).max_unanswered).toBe(1);
    expect(mergeRhythm({ max_unanswered: 0 }).max_unanswered).toBe(0);
    expect(mergeRhythm({ max_unanswered: 40 }).max_unanswered).toBe(5);
  });

  it('«куда пропал» — вопрос одной строкой, без историй из её жизни', () => {
    expect(CHECK_IN_GUIDANCE).toMatch(/ОДНУ короткую/);
    expect(CHECK_IN_GUIDANCE).toMatch(/Не рассказывай истории/);
  });
});

describe('утро важнее сообщения «куда пропал»', () => {
  const { ritualSlot } = require('./rhythm');
  const morning = { enabled: true, from: '07:00', to: '11:00' };
  const at = (iso: string) => new Date(iso);

  it('внутри утреннего окна слот есть, вне окна — нет', () => {
    const inside = ritualSlot(
      at('2026-09-16T06:00:00Z'),
      morning,
      'Europe/Moscow',
      111,
      'morning',
    );
    expect(inside.windowStartTs).not.toBeNull();
    expect(inside.day).toBe('2026-09-16');
    const outside = ritualSlot(
      at('2026-09-16T10:30:00Z'),
      morning,
      'Europe/Moscow',
      111,
      'morning',
    );
    expect(outside.windowStartTs).toBeNull();
  });
});

describe('инициатива посреди сегодняшнего разговора', () => {
  const state = (ts: number[]) =>
    ({
      history: ts.map((created_at, i) => ({
        id: String(i),
        role: i % 2 ? 'assistant' : 'user',
        content: 'x',
        created_at,
        source: 'dialogue',
      })),
    }) as never;

  it('считает время с последнего сообщения любой стороны', () => {
    expect(secondsSinceLastMessage(state([100, 200]), 500)).toBe(300);
    expect(secondsSinceLastMessage(state([]), 500)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(RECENT_TOPIC_S).toBe(12 * 3600);
  });

  it('продолжает тему, не здоровается и не поднимает старые дела из памяти', () => {
    const female = continueTopicGuidance('female');
    expect(female).toContain('Продолжи ЭТОТ разговор');
    expect(female).toContain('Не здоровайся заново');
    expect(female).toContain('Не поднимай старые дела');
    expect(female).toContain('не ответил');
    expect(continueTopicGuidance('male')).toContain('не ответила');
  });
});
