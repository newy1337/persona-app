import { applyOperatorSlots } from './profile';
import type { ConversationState } from '../kernel/types';

const blank = (): ConversationState =>
  ({
    history: [],
    memories: [],
    character: {},
  }) as unknown as ConversationState;

describe('ручные отметки оператора', () => {
  it('значение ложится в слот и в память', () => {
    const state = blank();
    expect(
      applyOperatorSlots(
        state,
        { location: 'Омск', name: 'Сергей' },
        '2026-09-12',
      ),
    ).toEqual(['location', 'name']);
    expect(state.character.slots).toMatchObject({
      location: 'Омск',
      name: 'Сергей',
    });
    expect(
      state.memories.some((m) => m.slot_id === 'location' && m.text === 'Омск'),
    ).toBe(true);
    expect(state.user_name).toBe('Сергей');
  });

  it('исправление заменяет прежнее, а не копится рядом', () => {
    const state = blank();
    applyOperatorSlots(state, { location: 'Омск' }, '2026-09-12');
    applyOperatorSlots(state, { location: 'Томск' }, '2026-09-12');
    const about = state.memories.filter((m) => m.slot_id === 'location');
    expect(about).toHaveLength(1);
    expect(about[0].text).toBe('Томск');
  });

  it('пустое значение снимает отметку вместе с памятью', () => {
    const state = blank();
    applyOperatorSlots(state, { work: 'таксист' }, '2026-09-12');
    expect(applyOperatorSlots(state, { work: '  ' }, '2026-09-12')).toEqual([
      'work',
    ]);
    expect(state.character.slots).not.toHaveProperty('work');
    expect(state.memories.some((m) => m.slot_id === 'work')).toBe(false);
  });

  it('то же значение второй раз — не правка', () => {
    const state = blank();
    applyOperatorSlots(state, { age: '38' }, '2026-09-12');
    expect(applyOperatorSlots(state, { age: '38' }, '2026-09-12')).toEqual([]);
  });
});
