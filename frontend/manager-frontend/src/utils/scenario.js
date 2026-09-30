import { moscowDay } from './panelTime';
export const LEAD_FIELDS = [
  { key: 'name', label: 'имя' },
  { key: 'age', label: 'возраст' },
  { key: 'city', label: 'город' },
  { key: 'family', label: 'семья' },
];

const STAGE_LABELS = {
  cold: 'холодный',
  rapport: 'сближение',
  pain: 'боль',
  close: 'закрытие',
  post_lead: 'после лида',
};

export function stageLabel(stage) {
  if (!stage) return null;
  return STAGE_LABELS[stage] || stage;
}

export function stageAtTs(events, ts) {
  if (!ts || !Array.isArray(events)) return null;
  const transitions = events
    .filter((e) => e && e.event_type === 'stage_transition' && e.ts != null)
    .sort((a, b) => a.ts - b.ts);
  if (transitions.length === 0) return null;

  let stage = null;
  for (const t of transitions) {
    if (t.ts <= ts) stage = (t.metadata && t.metadata.to) || stage;
  }
  if (stage) return stage;
  const first = transitions[0];
  return (first.metadata && first.metadata.from) || null;
}

export function leadChecklist(pins) {
  const facts = pins || {};
  const known = [];
  const missing = [];
  for (const f of LEAD_FIELDS) {
    const v = facts[f.key];
    if (v === undefined || v === null || v === '') missing.push(f);
    else known.push({ ...f, value: String(v) });
  }
  return { known, missing };
}

export function leadSignals(pins) {
  const f = pins || {};
  const out = [];
  if (f.pain_confirmed) {
    const n = f.pain_confirmed_turns;
    out.push({ key: 'pain', tone: 'good', text: `Боль подтверждена${n ? ` (${n})` : ''}` });
  }
  if (typeof f.turns_in_current_stage === 'number' && f.turns_in_current_stage >= 20) {
    out.push({
      key: 'stuck',
      tone: 'warn',
      text: `Застрял в стадии: ${f.turns_in_current_stage} ходов`,
    });
  }
  return out;
}

const HIDDEN_BEATS = new Set(['B1']);

export function splitBeats(beats) {
  const listed = (beats || []).filter(
    (b) => b && b.status !== 'out_of_scope' && !HIDDEN_BEATS.has(b.id),
  );
  return {
    todo: listed.filter((b) => b.status !== 'delivered'),
    done: listed.filter((b) => b.status === 'delivered'),
  };
}

function beatOrder(b) {
  const m = /^B(\d+)(?:\.|$)/.exec(String(b.id));
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function orderedBeats(beats) {
  const listed = (beats || []).filter(
    (b) => b && b.status !== 'out_of_scope' && !HIDDEN_BEATS.has(b.id),
  );
  return listed.sort(
    (a, b) => (a.day ?? 0) - (b.day ?? 0) || beatOrder(a) - beatOrder(b) || byId(a, b),
  );
}

export function outOfScopeBeats(beats) {
  return (beats || []).filter(
    (b) => b && b.status === 'out_of_scope' && !HIDDEN_BEATS.has(b.id),
  );
}

export const MANUAL_CLOSE_LABEL = 'закрыт вручную';

export function manuallyClosedBeats(beats) {
  return (beats || []).filter((b) => b && HIDDEN_BEATS.has(b.id));
}

export function deliveredBy(beat) {
  if (!beat || beat.status !== 'delivered') return null;
  if (beat.by === 'manager') return beat.actor ? `менеджер ${beat.actor}` : 'менеджер';
  if (beat.src === 'pin') return 'по пину';
  return beat.src === 'event' ? 'по событию' : 'судья';
}

const PAIR_RX = /^Клиент:\s*«([\s\S]*?)»\s*→\s*Ира:\s*«([\s\S]*)»$/;
const PIN_PREFIX = 'pinned_facts:';
const PIN_HUMAN_PREFIX = 'по пину:';

const PIN_PHRASES = {
  disclosed_bio_keys: 'в анкете раскрыто био',
};

function parsePairSide(raw) {
  const text = raw.trim();
  return text && text !== '—' ? text : null;
}

export function beatComment(beat) {
  const evidence = String((beat && beat.evidence) || '').trim();
  if (!evidence && !String((beat && beat.reason) || '').trim()) return null;
  if (isMediaEvidence(evidence)) return { kind: 'media' };

  const reason = String((beat && beat.reason) || '').trim();
  if (reason) return { kind: 'reason', text: reason, evidence: evidence || null };

  const pair = PAIR_RX.exec(evidence);
  if (pair) {
    return { kind: 'pair', client: parsePairSide(pair[1]), ira: parsePairSide(pair[2]) };
  }

  if (evidence.startsWith(PIN_HUMAN_PREFIX)) {
    return {
      kind: 'pin',
      phrase: evidence.slice(PIN_HUMAN_PREFIX.length).trim() || null,
      key: null,
      value: null,
    };
  }

  if (evidence.startsWith(PIN_PREFIX)) {
    const path = evidence
      .slice(PIN_PREFIX.length)
      .split('.')
      .filter((seg) => seg && !seg.startsWith('_'))
      .join('.');
    const sep = path.indexOf(':');
    const key = sep === -1 ? path : path.slice(0, sep);
    return {
      kind: 'pin',
      phrase: PIN_PHRASES[key] || null,
      key,
      value: sep === -1 ? null : path.slice(sep + 1),
    };
  }

  return { kind: 'quote', text: evidence };
}

const FACT_VALUES = {
  job: {
    business: 'бизнес',
    service: 'найм / услуги',
    other: 'другое',
    none: 'не работает',
  },
  family: {
    has_kids: 'есть дети',
    married: 'женат',
    single: 'один',
    divorced: 'в разводе',
  },
  finances: {
    finances_mentioned: 'упоминал',
    finances_confirmed: 'подтвердил',
  },
  phone: {
    commit_intent: 'готов дать',
    given: 'дал номер',
  },
};

export function humanFact(key, value) {
  const raw = String(value);
  const dict = FACT_VALUES[key];
  return (dict && dict[raw]) || raw;
}

export function stillPending(pendingList, messages) {
  const out = (messages || [])
    .filter((m) => m && m.role !== 'user')
    .map((m) => String(m.content));
  return (pendingList || []).filter((p) => {
    const i = out.indexOf(String(p.text));
    if (i === -1) return true;
    out.splice(i, 1);
    return false;
  });
}

export function phoneLabel(pins, dbPhone = null) {
  const f = pins || {};
  const slot = String(f.handoff_phone_collected || '').trim();
  if (slot) return slot;
  const raw = String(f.phone || '').trim();
  const isNumber = raw.startsWith('+') || /^\d+$/.test(raw);
  if (raw && isNumber) return raw;
  const db = String(dbPhone || '').trim();
  if (db) return db;
  if (raw) return humanFact('phone', raw);
  return null;
}

export function childrenWord(n) {
  const last2 = Math.abs(n) % 100;
  if (last2 >= 11 && last2 <= 14) return 'детей';
  const last1 = last2 % 10;
  if (last1 === 1) return 'ребёнок';
  if (last1 >= 2 && last1 <= 4) return 'ребёнка';
  return 'детей';
}

export function familyLabel(pins) {
  const f = pins || {};
  const n = f.children_count;
  if (Number.isInteger(n) && n > 0) return `${n} ${childrenWord(n)}`;
  return f.family ? humanFact('family', f.family) : null;
}

export function shortTitle(title, limit = 32) {
  const t = String(title || '').trim();
  if (!t) return '';
  const head = t.includes(':') ? t.slice(0, t.indexOf(':')) : t;
  if (head.length <= limit) return head;
  const cut = head.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trim()}…`;
}

export function dayProgress(beats) {
  const measured = (beats || []).filter((b) => b && b.status !== 'out_of_scope');
  return groupByDay(measured).map(({ day, items }) => ({
    day,
    total: items.length,
    delivered: items.filter((b) => b.status === 'delivered').length,
  }));
}

export function groupByDay(beats) {
  const days = new Map();
  for (const b of beats || []) {
    const d = b.day ?? 0;
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(b);
  }
  return [...days.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, items]) => ({ day, items }));
}

const GOAL_STATE = {
  known: 'ok',
  open: 'ask',
  asked: 'ask',
  deferred: 'skip',
  locked: 'skip',
};

const DELAY_REASON = {
  warmup: 'разогрев',
  normal: 'обычная задержка',
  after_silence: 'после молчания',
  off: 'без задержки',
  late: 'ответ на старое сообщение',
  retry: 'повтор: модель не ответила',
  offline: 'ждёт, пока аккаунт подключится',
};

export function scheduledReplyLabel(scheduled, nowTs = Math.floor(Date.now() / 1000)) {
  if (!scheduled?.due_at) return null;
  const left = scheduled.due_at - nowTs;
  const at = new Date(scheduled.due_at * 1000).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
  let inText;
  if (left <= 30) inText = 'сейчас';
  else if (left < 3600) inText = `через ${Math.round(left / 60)} мин`;
  else inText = `через ${Math.floor(left / 3600)} ч ${Math.round((left % 3600) / 60)} мин`;
  const reason = DELAY_REASON[scheduled.reason] ?? scheduled.reason;
  const count = scheduled.messages > 1 ? ` · на ${scheduled.messages} сообщ.` : '';
  return `Ответит в ${at} (${inText}) · ${reason}${count}`;
}

function inWords(left) {
  if (left <= 30) return 'сейчас';
  const total = Math.max(1, Math.round(left / 60));
  if (total < 60) return `через ${total} мин`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `через ${h} ч ${m} мин` : `через ${h} ч`;
}

function whenWords(at, nowTs) {
  const date = new Date(at * 1000);
  const time = date.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
  const dayKey = moscowDay;
  const now = new Date(nowTs * 1000);
  const tomorrow = new Date((nowTs + 86400) * 1000);
  if (dayKey(date) === dayKey(now)) return `сегодня в ${time}`;
  if (dayKey(date) === dayKey(tomorrow)) return `завтра в ${time}`;
  return `${date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' })} в ${time}`;
}

const UNPROMPTED_WORDS = {
  morning: { full: 'напишет «доброе утро»', short: 'напишет «доброе утро»' },
  goodnight: { full: 'попрощается на ночь', short: 'попрощается' },
  initiative: { full: 'напишет первым — спросит, как дела', short: 'напишет сам' },
};

export function nextActionLabel(action, nowTs = Math.floor(Date.now() / 1000), { short = false } = {}) {
  if (!action?.kind) return null;
  switch (action.kind) {
    case 'reply': {
      if (action.reason === 'voicer_pending') return { tone: 'wait', text: short ? 'ждёт запись войсера' : 'Бот ждёт запись войсера; готовое голосовое отправится автоматически' };
      const reason = DELAY_REASON[action.reason] ?? action.reason;
      const left = inWords(action.at - nowTs);
      return { tone: 'ok', text: short ? `ответит ${left}` : `Ответит ${left} (${whenWords(action.at, nowTs)}) · ${reason}` };
    }
    case 'morning':
    case 'goodnight':
    case 'initiative': {
      const what = UNPROMPTED_WORDS[action.kind];
      return {
        tone: 'ok',
        text: short
          ? `${what.short} ${inWords(action.at - nowTs)}`
          : `Бот ${what.full} ${whenWords(action.at, nowTs)} (${inWords(action.at - nowTs)}), если собеседник не напишет раньше`,
      };
    }
    case 'composing':
      return { tone: 'ok', text: short ? 'пишет ответ…' : 'Бот пишет ответ…' };
    case 'waiting':
      return { tone: 'wait', text: short ? 'ждёт ответа' : 'Ждёт ответа собеседника: бот уже написал первым и больше подряд не пишет' };
    case 'no_reply':
      return action.why === 'expired'
        ? { tone: 'warn', text: short ? 'не ответит: старое' : 'Не ответит: сообщение собеседника слишком старое' }
        : { tone: 'warn', text: short ? 'ответ не запланирован' : 'Ответ не запланирован: попытки ответить не удались — нажмите «Ответить сейчас»' };
    case 'manual':
      return { tone: 'wait', text: short ? 'ручной режим' : 'Ручной режим — бот не пишет, пока его не включат' };
    case 'initiative_off':
      return { tone: 'wait', text: short ? 'сам не пишет' : 'Сам не пишет: сообщения без повода выключены в настройках' };
    case 'refused':
      return { tone: 'warn', text: short ? 'отказ собеседника' : 'Не пишет: собеседник отказался от общения' };
    case 'account_banned':
      return { tone: 'warn', text: short ? 'аккаунт в бане' : 'Не пишет: Telegram заблокировал аккаунт этого чата' };
    case 'account_logged_out':
      return { tone: 'warn', text: short ? 'сессия завершена' : 'Не пишет: сессия аккаунта завершена — войдите в аккаунт заново' };
    case 'client_blocked':
      return { tone: 'warn', text: short ? 'заблокировал нас' : 'Не пишет: собеседник заблокировал аккаунт — сообщения не доходят' };
    case 'account_offline':
      return { tone: 'warn', text: short ? 'аккаунт не в сети' : 'Аккаунт этого чата не в сети — ответит, когда он подключится' };
    case 'no_account':
      return { tone: 'warn', text: short ? 'аккаунт удалён' : 'Не пишет: аккаунт этого чата удалён' };
    case 'no_model':
      return { tone: 'warn', text: short ? 'нет ключа модели' : 'Не пишет: не задан ключ модели' };
    case 'stopped':
      return { tone: 'warn', text: short ? 'аварийный стоп' : 'Не пишет: включён аварийный стоп' };
    case 'none':
      return { tone: 'wait', text: short ? 'сам не напишет' : 'В ближайшие 48 часов сам не напишет' };
    default:
      return null;
  }
}

function goalNote(row) {
  if (row.state === 'known') return String(row.value || 'узнали');
  if (row.state === 'deferred') return 'отложена собеседником';
  if (row.state === 'locked') return row.asks >= 2 ? 'спрашивали дважды' : 'ещё рано';
  return row.asks > 0 ? `спросили ${row.asks} раз` : 'не спрошена';
}

export function goalRows(goals) {
  return (goals?.slots || []).map((row) => ({
    key: row.id,
    label: row.id,
    title: row.title,
    value: row.value ?? null,
    state: GOAL_STATE[row.state] || 'ask',
    note: goalNote(row),
  }));
}

export function goalNow(goals) {
  if (!goals) return { text: 'Цели пока не считались — диалог ещё не начинался', tone: 'skip' };
  if (goals.next) {
    return { text: goals.next.title, hint: `тема: ${goals.next.id}`, tone: 'ask' };
  }
  const total = goals.total || 0;
  if (total && goals.known >= total) return { text: 'Все темы этапа закрыты', tone: 'ok' };
  return { text: 'Открытых тем сейчас нет — бот ведёт разговор без анкеты', tone: 'skip' };
}

function squash(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const MIN_SUBSTANTIVE = 12;

function evidenceKeys(beat) {
  const raw = String((beat && beat.evidence) || '').trim();
  if (!raw || isMediaEvidence(raw)) return [];
  if (raw.startsWith(PIN_PREFIX) || raw.startsWith(PIN_HUMAN_PREFIX)) return [];
  const pair = PAIR_RX.exec(raw);
  if (!pair) return [{ text: raw, client: null }];
  const keys = [];
  const ira = parsePairSide(pair[2]);
  const client = parsePairSide(pair[1]);
  if (client) keys.push({ text: client, client: true });
  if (ira) keys.push({ text: ira, client: false });
  return keys;
}

const ELLIPSIS_RX = /(?:…|\.\.\.)$/;

function matchKey(list, key) {
  const k = squash(key.text);
  if (!k) return [];
  const needle = k.replace(ELLIPSIS_RX, '').trim();
  if (!needle) return [];
  const hits = [];
  for (let i = 0; i < list.length; i += 1) {
    const m = list[i];
    if (key.client !== null && (m.role === 'user') !== key.client) continue;
    const text = squash(m.content);
    if (!text) continue;
    if (text.includes(needle) || (text.length >= MIN_SUBSTANTIVE && needle.includes(text))) {
      hits.push(i);
    }
  }
  return hits;
}

export function findMessageIndex(messages, beat) {
  const list = Array.isArray(messages) ? messages : [];
  if (!beat || !list.length) return -1;

  for (const key of evidenceKeys(beat)) {
    const hits = matchKey(list, key);
    if (!hits.length) continue;
    const inTime = hits.filter(
      (i) => beat.ts == null || list[i].ts == null || list[i].ts <= beat.ts,
    );
    return inTime.length ? inTime[inTime.length - 1] : hits[0];
  }

  if (beat.ts) {
    let idx = -1;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].ts != null && list[i].ts <= beat.ts) idx = i;
    }
    return idx;
  }
  return -1;
}

export function searchMessages(messages, query) {
  const q = squash(query);
  if (!q) return [];
  return (Array.isArray(messages) ? messages : []).reduce((acc, m, i) => {
    if (squash(m.content).includes(q)) acc.push(i);
    return acc;
  }, []);
}

const MEDIA_EVIDENCE_RX = /\.(jpe?g|png|webp|gif|mp4|webm|mov|ogg|oga|m4a|mp3|wav)$/i;

export function isMediaEvidence(evidence) {
  if (typeof evidence !== 'string') return false;
  const raw = evidence.trim();
  return raw.length > 0 && !raw.includes(' ') && MEDIA_EVIDENCE_RX.test(raw);
}
