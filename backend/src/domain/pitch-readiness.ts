import {
  FIRST_CONTACT_TS_KEY,
  hasAnyOf,
  intOrNull,
  isTruthy,
  LeadFacts,
} from './lead-facts';

export const REQUIRED_CONDITIONS = 3;

const DAY_TWO_S = 24 * 3600;
const LIVE_WINDOW_S = 24 * 3600;
const MONOSYLLABIC_CHARS = 12;
const HOSTILE_OBJECTIONS = new Set(['scam', 'attack', 'distrust']);

export interface PitchReadiness {
  ready: boolean;
  met: string[];
  blockers: string[];
}

function isDialogueLive(
  facts: LeadFacts,
  nowTs: number,
  lastClientTs: number | null,
): boolean {
  const firstContact = intOrNull(facts[FIRST_CONTACT_TS_KEY]);
  if (firstContact === null || nowTs - firstContact < DAY_TWO_S) return false;
  if (lastClientTs === null || nowTs - lastClientTs > LIVE_WINDOW_S)
    return false;
  const lens = facts['_recent_client_msg_lens'];
  if (Array.isArray(lens) && lens.length) {
    const nums = lens.map(intOrNull).filter((n): n is number => n !== null);
    if (nums.length && Math.max(...nums) < MONOSYLLABIC_CHARS) return false;
  }
  return true;
}

function qualificationTouched(facts: LeadFacts): boolean {
  const job = hasAnyOf(
    facts,
    'job',
    '_job_raw',
    'salary_exact_rub',
    'salary_official',
    'finances',
  );
  const arrests =
    hasAnyOf(facts, 'arrest_ever', 'has_arrests') ||
    isTruthy(facts, '_arrest_selfdisclose_done');
  const experience = hasAnyOf(
    facts,
    'trading_experience',
    'sphere_understanding',
  );
  return [job, arrests, experience].filter(Boolean).length >= 1;
}

function topicIsOpen(facts: LeadFacts): boolean {
  return hasAnyOf(
    facts,
    '_asked_topics',
    '_client_interests',
    '_topics_probed_so_far',
  );
}

function seedLandedWithoutAlarm(facts: LeadFacts): boolean {
  if (!isTruthy(facts, '_vbros_seed_emitted')) return false;
  return (intOrNull(facts['_vbros_doubt_count']) ?? 0) === 0;
}

function blockers(facts: LeadFacts): string[] {
  const out: string[] = [];
  if ((intOrNull(facts['_vbros_doubt_count']) ?? 0) > 0)
    out.push('волна сомнений');
  if (
    HOSTILE_OBJECTIONS.has(
      String(facts['_llm_objection_class'] ?? '')
        .trim()
        .toLowerCase(),
    )
  ) {
    out.push('разоблачение/скам');
  }
  if (hasAnyOf(facts, '_refusal_lock', '_refusal_state')) out.push('отказ');
  if (hasAnyOf(facts, '_funnel_stall', '_vbros_preamble_stall'))
    out.push('воронка встала');
  return out;
}

export function pitchReadiness(
  facts: LeadFacts,
  nowTs: number,
  lastClientTs: number | null,
): PitchReadiness {
  const conditions: Record<string, boolean> = {
    'живой диалог': isDialogueLive(facts, nowTs, lastClientTs),
    'квалификация тронута': qualificationTouched(facts),
    'тема открыта': topicIsOpen(facts),
    'посев без аларма': seedLandedWithoutAlarm(facts),
  };
  const met = Object.entries(conditions)
    .filter(([, ok]) => ok)
    .map(([name]) => name);
  const blocked = blockers(facts);
  const ready =
    conditions['живой диалог'] &&
    met.length >= REQUIRED_CONDITIONS &&
    blocked.length === 0;
  return { ready, met, blockers: blocked };
}
