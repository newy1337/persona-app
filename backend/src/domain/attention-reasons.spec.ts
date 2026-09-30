import {
  isDialogueLive,
  pausedBeforeKeyMove,
  qualificationGap,
  qualificationOverdue,
  QUALIFICATION_DEADLINE_S,
  upcomingKeyMove,
} from './attention-reasons';

const NOW = 1_800_000_000;

describe('attention reasons', () => {
  it('a dialogue is live within 24h of the last client message', () => {
    expect(isDialogueLive(NOW, NOW - 3600)).toBe(true);
    expect(isDialogueLive(NOW, NOW - 25 * 3600)).toBe(false);
    expect(isDialogueLive(NOW, null)).toBe(false);
  });

  it('maps the pitch phase to the key move ahead, only while live', () => {
    expect(upcomingKeyMove({ vbros_phase: 'predloga' }, NOW, NOW - 60)).toBe(
      'before_soglas',
    );
    expect(upcomingKeyMove({ vbros_phase: 'interlude_1' }, NOW, NOW - 60)).toBe(
      'before_vbros',
    );
    expect(
      upcomingKeyMove({ vbros_phase: 'predloga' }, NOW, NOW - 2 * 86400),
    ).toBeNull();
    expect(upcomingKeyMove({}, NOW, NOW - 60)).toBeNull();
  });

  it('an armed pause counts only while the chat stays on that phase', () => {
    expect(
      pausedBeforeKeyMove({
        _key_move_pause_armed: 'interlude_2',
        vbros_phase: 'interlude_2',
      }),
    ).toBe('before_predloga');
    expect(
      pausedBeforeKeyMove({
        _key_move_pause_armed: 'interlude_2',
        vbros_phase: 'predloga',
      }),
    ).toBeNull();
  });

  it('qualification gap names missing fields with the waivers applied', () => {
    expect(qualificationGap({})).toEqual([
      'работа',
      'зарплата',
      'аресты',
      'гражданство',
    ]);
    expect(
      qualificationGap({
        job: 'x',
        norm_job_signal: true,
        _arrest_selfdisclose_done: '1',
        citizenship: 'ru',
      }),
    ).toEqual([]);
  });

  it('overdue only after 12h from first contact and while live', () => {
    const facts = { _first_seen_ts: NOW - QUALIFICATION_DEADLINE_S - 1 };
    expect(qualificationOverdue(facts, NOW, NOW - 60).length).toBe(4);
    expect(
      qualificationOverdue({ _first_seen_ts: NOW - 3600 }, NOW, NOW - 60),
    ).toEqual([]);
    expect(qualificationOverdue(facts, NOW, null)).toEqual([]);
  });
});
