import { actualStageMoves, type StageSetEvent } from './deal-stage-stats';

let id = 0;
const set = (
  chat: number,
  ts: number,
  to: string,
  note = '',
): StageSetEvent => ({ chatId: BigInt(chat), ts, id: ++id, to, note });

const DAY = 86400;
const START = 100 * DAY;
const END = 130 * DAY;
const count = (events: StageSetEvent[], stage: string) =>
  actualStageMoves(events, START, END).filter((m) => m.stage === stage).length;

describe('этапы за период: только фактически поставленные', () => {
  it('перескок «Соглас» → «Депозит» — депозит, но не лид', () => {
    const events = [
      set(1, START + 10, 'soglas'),
      set(1, START + DAY, 'deposit'),
    ];
    expect(count(events, 'deposit')).toBe(1);
    expect(count(events, 'lead')).toBe(0);
  });

  it('«Депозит» и в ту же минуту архив с причиной «пропал» — ошибочный клик', () => {
    const events = [
      set(2, START + 10, 'deposit'),
      set(2, START + 40, 'archive', 'пропал'),
    ];
    expect(count(events, 'deposit')).toBe(0);
    expect(count(events, 'archive')).toBe(1);
  });

  it('«Депозит» и сразу архив с причиной «депозит» / «дэп» — депозит был', () => {
    expect(
      count(
        [set(3, START, 'deposit'), set(3, START + 5, 'archive', 'Депозит')],
        'deposit',
      ),
    ).toBe(1);
    expect(
      count(
        [
          set(4, START, 'deposit'),
          set(4, START + 5, 'archive', 'дэп передан саппу'),
        ],
        'deposit',
      ),
    ).toBe(1);
  });

  it('«Депозит» и сразу назад на «Предлогу» — ошибка; шаг вперёд «Лид» → «Депозит» лид не отменяет', () => {
    expect(
      count(
        [set(5, START, 'deposit'), set(5, START + 3, 'predloga')],
        'deposit',
      ),
    ).toBe(0);
    const forward = [set(6, START, 'lead'), set(6, START + 30, 'deposit')];
    expect(count(forward, 'lead')).toBe(1);
    expect(count(forward, 'deposit')).toBe(1);
  });

  it('в архив через несколько дней — депозит засчитан, какой бы ни была причина', () => {
    expect(
      count(
        [set(7, START, 'deposit'), set(7, START + 3 * DAY, 'archive', 'отказ')],
        'deposit',
      ),
    ).toBe(1);
  });

  it('исправление, пришедшее уже после конца периода, тоже отменяет клик', () => {
    const events = [
      set(8, END - 30, 'deposit'),
      set(8, END + 30, 'archive', 'блок'),
    ];
    expect(count(events, 'deposit')).toBe(0);
  });

  it('один чат в этапе за период считается один раз, вне периода — не считается', () => {
    const events = [
      set(9, START - DAY, 'lead'),
      set(9, START + 10, 'lead'),
      set(9, START + 2 * DAY, 'soglas'),
      set(9, START + 3 * DAY, 'lead'),
    ];
    expect(count(events, 'lead')).toBe(1);
  });

  it('ранний этап и сразу архив — этап засчитан: «Вброс» → архив «перестал отвечать»', () => {
    expect(
      count(
        [
          set(10, START, 'vbros'),
          set(10, START + 20, 'archive', 'перестал отвечать'),
        ],
        'vbros',
      ),
    ).toBe(1);
  });
});
