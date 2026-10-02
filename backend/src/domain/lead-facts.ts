export type LeadFacts = Record<string, unknown>;

export const ARCHIVED_AT_KEY = '_archived_at';
export const ARCHIVED_BOT_ON_KEY = '_archived_bot_on';

export const HIDDEN_FROM_DASHBOARD_KEY = '_manager_hidden';
export const FIRST_CONTACT_TS_KEY = '_first_seen_ts';
export const REFUSAL_LOCK_KEY = '_refusal_lock';
export const KEY_MOVE_PAUSE_ARMED_KEY = '_key_move_pause_armed';
export const PITCH_PHASE_KEY = 'vbros_phase';

export const EDITABLE_LEAD_FACT_KEYS = new Set([
  'name',
  'age',
  'city',
  'site',
  'job',
  'family',
  'finances',
  'phone',
  'analyst_offered',
  'analyst_agreed',
  'children_count',
]);

const INT_KEYS = new Set(['age', 'children_count']);
const BOOL_KEYS = new Set(['analyst_offered', 'analyst_agreed']);
const TRUE_WORDS = new Set(['true', '1', 'yes', 'y', 'да']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'n', 'нет', '']);

export function coerceLeadFactValue(key: string, value: string): unknown {
  const raw = value.trim();
  if (INT_KEYS.has(key)) {
    const n = Number(raw);
    if (!Number.isInteger(n))
      throw new Error(`поле '${key}' требует целое число, получено '${value}'`);
    return n;
  }
  if (BOOL_KEYS.has(key)) {
    const low = raw.toLowerCase();
    if (TRUE_WORDS.has(low)) return true;
    if (FALSE_WORDS.has(low)) return false;
    throw new Error(`поле '${key}' требует да/нет, получено '${value}'`);
  }
  return raw;
}

const MIRRORED_INTERNAL_KEYS: Record<string, string> = {
  _job_raw: 'job_raw',
  _trade_screen_sent: 'trade_screen_sent',
};

export const MEDIA_REQUEST_KEY = '_media_request';
/** клиент написал стоп-фразу из настроек: {phrase, ts} — пока менеджер не вернёт бота */
export const HANDOFF_TRIGGER_KEY = '_handoff_trigger';

export const MEDIA_REQUEST_LABELS: Record<string, string> = {
  voice: 'просит голосовое',
  photo: 'просит фото',
  video_note: 'просит кружок',
  video: 'просит видео',
};

export function publicLeadFacts(facts: LeadFacts): LeadFacts {
  const out: LeadFacts = {};
  for (const [k, v] of Object.entries(facts)) {
    if (!k.startsWith('_') && k !== 'funnel_stage') out[k] = v;
  }
  for (const [internal, pub] of Object.entries(MIRRORED_INTERNAL_KEYS)) {
    if (facts[internal]) out[pub] = facts[internal];
  }
  const children = facts['_client_children'];
  if (Array.isArray(children) && children.length > 0)
    out['children_count'] = children.length;
  return out;
}

export function isTruthy(facts: LeadFacts, key: string): boolean {
  const v = facts[key];
  if (typeof v === 'string')
    return ['true', '1', 'yes'].includes(v.trim().toLowerCase());
  return Boolean(v);
}

export function hasAnyOf(facts: LeadFacts, ...keys: string[]): boolean {
  return keys.some((k) => {
    const v = facts[k];
    if (v === null || v === undefined || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  });
}

export function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function parseLeadFacts(raw: string | null | undefined): LeadFacts {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}
