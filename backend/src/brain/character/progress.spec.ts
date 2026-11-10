import { goalProgress } from './progress';
import type { CharacterState } from '../kernel/types';

const goals = {
  stages: [
    {
      id: 'knock',
      title: 'первое касание',
      enter: { turns: 0, days: 0, slots: 0 },
      min_turns: 8,
      ask_slots: ['name', 'age', 'work'],
    },
    {
      id: 'smalltalk',
      title: 'разговорились',
      enter: { turns: 10, days: 1, slots: 1 },
      min_turns: 16,
      ask_slots: ['family'],
    },
  ],
  slots: [
    { id: 'name', hint: 'как тебя зовут?', priority: 2, required_by_day: 1 },
    { id: 'age', hint: 'сколько тебе лет?', priority: 3, required_by_day: 1 },
    { id: 'work', hint: 'а работаешь где?', priority: 5, required_by_day: 1 },
    {
      id: 'family',
      hint: 'семья есть?',
      priority: 7,
      required_by_day: 2,
      not_before_day: 2,
    },
    { id: 'weekend', topic: 'как проводит выходные; чем занят вечером' },
  ],
};

const character = (extra: Partial<CharacterState> = {}): CharacterState => ({
  stage_id: 'knock',
  turns: 4,
  days: ['2026-09-10'],
  slots: {},
  ...extra,
});

describe('ход знакомства для панели', () => {
  it('в списке — все темы личности, с темой словами и способом спрашивать', () => {
    const view = goalProgress(goals, character());
    expect(view.slots.map((s) => s.id)).toEqual([
      'name',
      'age',
      'work',
      'family',
      'weekend',
    ]);
    // Тема без дня — тоже в списке: видно, что бот её поднимает по ходу разговора.
    expect(view.slots.find((s) => s.id === 'weekend')).toMatchObject({
      topic: 'как проводит выходные; чем занят вечером',
      required_by_day: null,
      desired_by_day: null,
    });
    expect(view.percent).toBe(0);
    expect(view.stage).toMatchObject({
      id: 'knock',
      title: 'первое касание',
      index: 1,
      total: 2,
    });
  });

  it('общий прогресс — доля узнанного в процентах', () => {
    const view = goalProgress(
      goals,
      character({ slots: { name: 'Сергей', age: '30' } }),
    );
    expect(view).toMatchObject({ known: 2, total: 5, percent: 40 });
  });

  it('узнанное считается и показывается ответом собеседника', () => {
    const view = goalProgress(goals, character({ slots: { name: 'Сергей' } }));
    expect(view.known).toBe(1);
    expect(view.slots.find((s) => s.id === 'name')).toMatchObject({
      state: 'known',
      value: 'Сергей',
    });
    expect(view.slots[view.slots.length - 1].id).toBe('name');
  });

  it('следующая тема — та же, что уйдёт судье: по приоритету и просрочке', () => {
    const view = goalProgress(goals, character({ slots: { name: 'Сергей' } }));
    expect(view.next).toEqual({ id: 'age', title: 'сколько тебе лет?' });
  });

  it('спрошенное, отложенное и ещё не открытое различаются', () => {
    const view = goalProgress(
      goals,
      character({ slot_asks: { age: 1 }, deferred_slots: ['work'] }),
    );
    const by = Object.fromEntries(view.slots.map((s) => [s.id, s]));
    expect(by.age).toMatchObject({ state: 'asked', asks: 1 });
    expect(by.work.state).toBe('deferred');
    expect(by.family.state).toBe('locked');
    expect(view.next?.id).toBe('name');
  });

  it('спросили дважды — тема закрывается от повтора', () => {
    const view = goalProgress(goals, character({ slot_asks: { name: 2 } }));
    expect(view.slots.find((s) => s.id === 'name')).toMatchObject({
      state: 'locked',
      asks: 2,
    });
    expect(view.next?.id).toBe('age');
  });

  it('пустой диалог не ломает счёт', () => {
    const view = goalProgress(goals, undefined);
    expect(view.known).toBe(0);
    expect(view.stage.id).toBe('knock');
    expect(view.next?.id).toBe('name');
  });
});
