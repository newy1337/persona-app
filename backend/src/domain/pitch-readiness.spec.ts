import { pitchReadiness } from './pitch-readiness';

const NOW = 1_800_000_000;
const live = { _first_seen_ts: NOW - 2 * 86400 };

describe('pitch readiness', () => {
  it('a dead dialogue is a veto even when everything else is met', () => {
    const r = pitchReadiness(
      { ...live, job: 'x', _asked_topics: ['a'], _vbros_seed_emitted: true },
      NOW,
      NOW - 3 * 86400,
    );
    expect(r.ready).toBe(false);
    expect(r.met).not.toContain('живой диалог');
  });

  it('needs live plus any two of the other three', () => {
    expect(
      pitchReadiness({ ...live, job: 'x', _asked_topics: ['a'] }, NOW, NOW - 60)
        .ready,
    ).toBe(true);
    expect(pitchReadiness({ ...live, job: 'x' }, NOW, NOW - 60).ready).toBe(
      false,
    );
  });

  it('monosyllabic recent replies are not a live dialogue', () => {
    const r = pitchReadiness(
      {
        ...live,
        _recent_client_msg_lens: [2, 3, 5],
        job: 'x',
        _asked_topics: ['a'],
      },
      NOW,
      NOW - 60,
    );
    expect(r.ready).toBe(false);
  });

  it('blockers are named and block', () => {
    const r = pitchReadiness(
      {
        ...live,
        job: 'x',
        _asked_topics: ['a'],
        _llm_objection_class: 'Scam',
        _refusal_lock: 1,
      },
      NOW,
      NOW - 60,
    );
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual(['разоблачение/скам', 'отказ']);
  });
});
