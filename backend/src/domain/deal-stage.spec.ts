import { dealNoteError, isDealStage, stagesReachedBy } from './deal-stage';

describe('этап сделки', () => {
  it('знает свои этапы и отвергает чужие', () => {
    expect(isDealStage('soglas')).toBe(true);
    expect(isDealStage('deposit')).toBe(true);
    expect(isDealStage('cold')).toBe(false);
    expect(isDealStage(null)).toBe(false);
  });

  it('этап тянет за собой все предыдущие, архив — ничего', () => {
    expect(stagesReachedBy('vbros')).toEqual(['vbros']);
    expect(stagesReachedBy('lead')).toEqual([
      'vbros',
      'predloga',
      'soglas',
      'lead',
    ]);
    expect(stagesReachedBy('archive')).toEqual([]);
  });

  it('архив требует причину, остальные нет', () => {
    expect(dealNoteError('archive', '  ')).toMatch(/причина/);
    expect(dealNoteError('archive', 'не отвечает')).toBeNull();
    expect(dealNoteError('lead', '')).toBeNull();
    expect(dealNoteError('lead', 'x'.repeat(501))).toMatch(/длиннее/);
  });
});
