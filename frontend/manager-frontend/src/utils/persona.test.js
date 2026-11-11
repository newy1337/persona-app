import { describe, expect, it } from 'vitest';
import { personaLabel } from './persona';

describe('personaLabel', () => {
  it('холодная личность помечена (Х)', () => {
    expect(personaLabel({ name: 'Денис', traffic_type: 'cold' })).toBe('Денис (Х)');
    expect(personaLabel({ name: 'Настя', traffic_type: 'hot' })).toBe('Настя');
    expect(personaLabel({ name: 'Алина' })).toBe('Алина');
  });
});
