import { dealNoteError, isDealStage } from './deal-stage';

describe('этап сделки', () => {
  it('знает свои этапы и отвергает чужие', () => {
    expect(isDealStage('soglas')).toBe(true);
    expect(isDealStage('cold')).toBe(false);
    expect(isDealStage(null)).toBe(false);
  });

  it('архив требует причину, остальные нет', () => {
    expect(dealNoteError('archive', '  ')).toMatch(/причина/);
    expect(dealNoteError('archive', 'не отвечает')).toBeNull();
    expect(dealNoteError('lead', '')).toBeNull();
    expect(dealNoteError('lead', 'x'.repeat(501))).toMatch(/длиннее/);
  });
});
