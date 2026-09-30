import {
  coerceLeadFactValue,
  hasAnyOf,
  intOrNull,
  isTruthy,
  parseLeadFacts,
  publicLeadFacts,
} from './lead-facts';

describe('lead facts', () => {
  it('coerces operator input by field type', () => {
    expect(coerceLeadFactValue('age', ' 34 ')).toBe(34);
    expect(coerceLeadFactValue('analyst_agreed', 'Да')).toBe(true);
    expect(coerceLeadFactValue('analyst_offered', '')).toBe(false);
    expect(coerceLeadFactValue('city', ' Пхукет ')).toBe('Пхукет');
    expect(() => coerceLeadFactValue('age', 'много')).toThrow(/целое число/);
    expect(() => coerceLeadFactValue('analyst_agreed', 'maybe')).toThrow(
      /да\/нет/,
    );
  });

  it('public card hides internal markers and mirrors the few the manager needs', () => {
    const out = publicLeadFacts({
      name: 'Олег',
      funnel_stage: 'pain',
      _refusal_lock: 1,
      _job_raw: 'таксист',
      _client_children: [{}, {}],
    });
    expect(out).toEqual({
      name: 'Олег',
      job_raw: 'таксист',
      children_count: 2,
    });
  });

  it('json-ish truthiness and presence', () => {
    expect(isTruthy({ a: 'True' }, 'a')).toBe(true);
    expect(isTruthy({ a: '0' }, 'a')).toBe(false);
    expect(hasAnyOf({ a: [], b: {} }, 'a', 'b')).toBe(false);
    expect(hasAnyOf({ a: [], b: 'x' }, 'a', 'b')).toBe(true);
    expect(intOrNull('12.7')).toBe(12);
    expect(intOrNull('')).toBeNull();
  });

  it('parseLeadFacts never throws on garbage', () => {
    expect(parseLeadFacts('{bad')).toEqual({});
    expect(parseLeadFacts('[1]')).toEqual({});
    expect(parseLeadFacts('{"a":1}')).toEqual({ a: 1 });
  });
});
