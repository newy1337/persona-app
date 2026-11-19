import { createHash } from 'crypto';
import { DEAL_STAGES } from 'src/domain/deal-stage';
import {
  type ChatStageHistory,
  reachedStage,
} from 'src/shared/deal-stage-stats';

/** Поля строки списка, по которым фильтрует и считает панель. */
export interface FilterableRow {
  chat_id: number;
  channel?: string | null;
  account_id: number | null;
  name: string | null;
  city: string | null;
  phone: string | null;
  client_username: string | null;
  contact?: { display?: string | null } | null;
  manager_username?: string | null;
  region_code?: string | null;
  deal_stage: string | null;
  stage: { id: string; title: string; index: number } | null;
  is_paused: boolean;
  unread_count: number;
  last_message_ts: number;
  hidden: boolean;
  /**
   * Фактически поставленные этапы — фильтр «этап сделки» считает, как
   * статистика: кто дошёл до этапа. Без истории — по текущему этапу.
   */
  reached?: ChatStageHistory;
}

export interface ConversationFilter {
  q?: string;
  /** tg | vk */
  channel?: string;
  /** этап сделки или none — без этапа */
  deal?: string;
  /** этап сценария бота (stage.id) */
  stage?: string;
  /** только чаты на ручном режиме с непрочитанным от клиента */
  only_new?: boolean;
  /** кто ведёт: bot | manager */
  lead?: string;
  account?: string;
  /** период по последнему сообщению: [start, end) */
  since?: number;
  until?: number;
  sort?: 'name' | 'status' | 'last';
  dir?: 'asc' | 'desc';
}

export const channelKey = (channel?: string | null) =>
  channel === 'vk' ? 'vk' : 'tg';

/** Новые на ручном: чат у менеджера, клиент написал, переписку не открывали. */
export const waitsForManager = (row: FilterableRow) =>
  Boolean(row.is_paused) && (row.unread_count ?? 0) > 0;

/** Поиск как в панели: телефон по цифрам, ник с @ и без, имя, город, id. */
export function matchesQuery(row: FilterableRow, query?: string): boolean {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const phoneDigits = String(row.phone || '').replace(/\D/g, '');
  if (digits && phoneDigits && phoneDigits.includes(digits)) return true;
  const nick = q.replace(/^@/, '');
  const nicks = [row.client_username, row.contact?.display]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase().replace(/^@/, ''));
  if (nick && nicks.some((v) => v.includes(nick))) return true;
  return [
    row.name,
    row.city,
    row.chat_id,
    row.account_id,
    row.manager_username,
    row.region_code,
  ]
    .filter((v) => v != null && v !== '')
    .some((v) => String(v).toLowerCase().includes(q));
}

/**
 * Дошёл ли чат до этапа сделки. С периодом — поставили ли этап в период:
 * так считает статистика.
 */
export function reachedDeal(
  row: FilterableRow,
  deal: string,
  since?: number,
  until?: number,
): boolean {
  if (row.reached) return reachedStage(row.reached, deal, since, until);
  // без истории — текущий этап и период по последнему сообщению
  const ts = row.last_message_ts;
  return (
    row.deal_stage === deal &&
    (since === undefined || (ts > 0 && ts >= since)) &&
    (until === undefined || (ts > 0 && ts < until))
  );
}

/** Выбран этап, до которого доходят: период тогда — когда этап поставили. */
const byReached = (f: ConversationFilter) =>
  Boolean(f.deal && f.deal !== 'none');

export function matches(row: FilterableRow, f: ConversationFilter): boolean {
  if (f.channel && f.channel !== 'all' && channelKey(row.channel) !== f.channel)
    return false;
  if (f.deal === 'none' && row.deal_stage) return false;
  if (byReached(f) && !reachedDeal(row, f.deal!, f.since, f.until))
    return false;
  if (f.stage && row.stage?.id !== f.stage) return false;
  if (f.only_new && !waitsForManager(row)) return false;
  if (f.lead && (f.lead === 'manager' ? !row.is_paused : row.is_paused))
    return false;
  if (f.account && String(row.account_id) !== f.account) return false;
  if (!byReached(f) && (f.since !== undefined || f.until !== undefined)) {
    const ts = row.last_message_ts;
    if (!ts) return false;
    if (f.since !== undefined && ts < f.since) return false;
    if (f.until !== undefined && ts >= f.until) return false;
  }
  return matchesQuery(row, f.q);
}

function compare(a: FilterableRow, b: FilterableRow, f: ConversationFilter) {
  if (!f.sort || f.sort === 'last') {
    const d = (a.last_message_ts || 0) - (b.last_message_ts || 0);
    return f.dir === 'asc' ? d : -d;
  }
  const key = (r: FilterableRow) =>
    f.sort === 'name' ? (r.name || '').toLowerCase() : (r.stage?.index ?? 0);
  const x = key(a),
    y = key(b);
  const d = x < y ? -1 : x > y ? 1 : 0;
  return f.dir === 'desc' ? -d : d;
}

/**
 * Счётчики кнопок фильтров — по всему набору, а не по странице: сколько чатов
 * в каждом канале, этапе сделки и этапе бота, сколько ждут менеджера.
 */
export function facets(
  rows: FilterableRow[],
  f: ConversationFilter = {},
  dealRows: FilterableRow[] = rows,
) {
  // Счётчики группы — по чатам, прошедшим все прочие фильтры: «Лид 5» при
  // выбранном периоде и поиске значит, что по кнопке откроются ровно 5.
  const except = (key: keyof ConversationFilter) =>
    rows.filter((r) => matches(r, { ...f, [key]: undefined }));
  const byChannel = except('channel');
  // этапы сделки — кто дошёл до этапа (в период, если он выбран), как в
  // статистике; архивные чаты тоже считаются
  const dealBase = dealRows.filter((r) =>
    matches(r, { ...f, deal: undefined, since: undefined, until: undefined }),
  );
  const byStage = except('stage');
  const channel = { all: byChannel.length, tg: 0, vk: 0 };
  const deal: Record<string, number> = Object.fromEntries(
    [...DEAL_STAGES, 'none'].map((s) => [s, 0]),
  );
  const stages = new Map<
    string,
    { id: string; title: string; index: number; count: number }
  >();
  const accounts = new Set<number>();
  const noDeal: number[] = [];
  let fresh = 0;
  for (const r of byChannel) channel[channelKey(r.channel)] += 1;
  for (const r of dealBase) {
    for (const d of DEAL_STAGES)
      if (reachedDeal(r, d, f.since, f.until)) deal[d] += 1;
  }
  deal.none = rows.filter((r) => matches(r, { ...f, deal: 'none' })).length;
  for (const r of byStage) {
    if (r.stage?.id) {
      const s = stages.get(r.stage.id) ?? { ...r.stage, count: 0 };
      s.count += 1;
      stages.set(r.stage.id, s);
    }
  }
  for (const r of rows) {
    if (r.account_id !== null) accounts.add(r.account_id);
    if (waitsForManager(r)) fresh += 1;
    if (!r.deal_stage && !r.hidden) noDeal.push(r.chat_id);
  }
  noDeal.sort((a, b) => a - b);
  return {
    channel,
    deal,
    stages: [...stages.values()].sort((a, b) => a.index - b.index),
    new: fresh,
    accounts: [...accounts].sort((a, b) => a - b),
    /** чаты без этапа сделки: число и отпечаток набора — для напоминания */
    no_deal: {
      count: noDeal.length,
      signature: noDeal.length
        ? createHash('sha1').update(noDeal.join(',')).digest('hex')
        : '',
    },
  };
}

/** Отбор, сортировка и страница; счётчик группы — с учётом прочих фильтров. */
export function pageOf<T extends FilterableRow>(
  rows: T[],
  f: ConversationFilter,
  page: number,
  size: number,
  dealRows: FilterableRow[] = rows,
) {
  const filtered = rows.filter((r) => matches(r, f));
  const sorted = [...filtered].sort((a, b) => compare(a, b, f));
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return {
    items: sorted.slice((current - 1) * size, current * size),
    /** порядок всех отобранных чатов: из чата листают тот же список */
    order: sorted.map((r) => r.chat_id),
    total: filtered.length,
    all: rows.length,
    page: current,
    pages,
    size,
    facets: facets(rows, f, dealRows),
  };
}
