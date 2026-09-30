import { CHECK_IN_GUIDANCE, unansweredUnprompted } from './initiative';
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
