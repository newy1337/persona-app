import {
  FIRST_CONTACT_TS_KEY,
  hasAnyOf,
  intOrNull,
  isTruthy,
  KEY_MOVE_PAUSE_ARMED_KEY,
  LeadFacts,
  PITCH_PHASE_KEY,
} from './lead-facts';

export const AttentionReason = {
  HOLD_ARMED: 'hold_armed',
  MANUAL_TAKEOVER: 'manual_takeover',
  BEFORE_CONSENT: 'before_soglas',
  BEFORE_PRETEXT: 'before_predloga',
  BEFORE_PITCH: 'before_vbros',
  PITCH_READY: 'vbros_ready',
  QUALIFICATION_GAP: 'qual_gap',
} as const;

export const KEY_MOVE_AHEAD: Record<string, string> = {
  predloga: AttentionReason.BEFORE_CONSENT,
  interlude_2: AttentionReason.BEFORE_PRETEXT,
  interlude_1: AttentionReason.BEFORE_PITCH,
};

export const QUALIFICATION_DEADLINE_S = 12 * 3600;

const LIVE_WINDOW_S = 24 * 3600;

const QUALIFICATION_KEYS: Record<string, string[]> = {
  работа: ['job', '_job_raw'],
  зарплата: ['salary_exact_rub', 'salary_official', 'salary_unofficial'],
  аресты: ['has_arrests', 'arrest_ever'],
  гражданство: ['is_resident', 'citizenship'],
};

export function isDialogueLive(
  nowTs: number,
  lastClientTs: number | null,
): boolean {
  if (nowTs <= 0 || lastClientTs === null) return false;
  return nowTs - lastClientTs <= LIVE_WINDOW_S;
}

export function upcomingKeyMove(
  facts: LeadFacts,
  nowTs: number,
  lastClientTs: number | null,
): string | null {
  if (!isDialogueLive(nowTs, lastClientTs)) return null;
  return KEY_MOVE_AHEAD[String(facts[PITCH_PHASE_KEY] ?? '')] ?? null;
}

export function pausedBeforeKeyMove(facts: LeadFacts): string | null {
  const armed = String(facts[KEY_MOVE_PAUSE_ARMED_KEY] ?? '');
  if (!armed || armed !== String(facts[PITCH_PHASE_KEY] ?? '')) return null;
  return KEY_MOVE_AHEAD[armed] ?? null;
}

export function qualificationGap(facts: LeadFacts): string[] {
  return Object.entries(QUALIFICATION_KEYS)
    .filter(([, keys]) => !hasAnyOf(facts, ...keys))
    .map(([name]) => name)
    .filter((name) => {
      if (name === 'зарплата' && isTruthy(facts, 'norm_job_signal'))
        return false;
      if (name === 'аресты' && isTruthy(facts, '_arrest_selfdisclose_done'))
        return false;
      return true;
    });
}

export function qualificationOverdue(
  facts: LeadFacts,
  nowTs: number,
  lastClientTs: number | null,
): string[] {
  if (!isDialogueLive(nowTs, lastClientTs)) return [];
  const firstContact = intOrNull(facts[FIRST_CONTACT_TS_KEY]);
  if (firstContact === null || nowTs - firstContact < QUALIFICATION_DEADLINE_S)
    return [];
  return qualificationGap(facts);
}
