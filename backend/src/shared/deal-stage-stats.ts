import { PrismaService } from 'src/prisma.service';
import { DEAL_STAGES, DEAL_STAGE_EVENT } from 'src/domain/deal-stage';
import { dayKey } from 'src/modules/stats/range';
import { TtlCache } from './ttl-cache';

type ReachedRow = {
  chat_id: bigint;
  stages: string[];
  archived: boolean;
  /** все фактически поставленные этапы (и архив) с моментом */
  sets: Array<{ stage: string; ts: number }>;
};
// Проход по всем сменам этапов: тысячи строк. Плитки дашборда спрашивают его
// у каждого менеджера раз в 10 секунд — отдаём общий ответ.
const reachedRows = new WeakMap<object, TtlCache>();
const REACHED_TTL_MS = 30_000;

export const zeroStages = (): Record<string, number> =>
  Object.fromEntries(DEAL_STAGES.map((s) => [s, 0]));

export interface StageMove {
  day: string;
  stage: string;
  chatId: bigint;
  /** когда этап поставили */
  ts: number;
}

/** Сколько секунд даём на исправление: этап, сменённый быстрее, — ошибочный клик. */
export const MISCLICK_SECONDS = 120;

/** Как в причине архива называют этап, который в нём закрепили («деп», «лид»). */
const STAGE_IN_NOTE: Readonly<Record<string, RegExp>> = {
  deposit: /д[еэ]п/i,
  lead: /лид/i,
};

export interface StageSetEvent {
  chatId: bigint;
  ts: number;
  /** порядок событий одной секунды */
  id: number;
  to: string;
  note: string;
}

/**
 * Ошибочный клик: этап в течение MISCLICK_SECONDS сменили назад по воронке,
 * или «Лид» / «Депозит» отправили в архив с причиной, где этап не упомянут. Шаг
 * вперёд («Лид» → «Депозит») этап не отменяет, архив с причиной «деп» после
 * «Депозита» — тоже: депозит был.
 */
export function isMisclick(
  set: StageSetEvent,
  next: StageSetEvent | undefined,
) {
  if (!next || set.to === 'archive') return false;
  if (next.ts - set.ts > MISCLICK_SECONDS) return false;
  // В архив сразу после «Лида» или «Депозита» — промах мимо соседнего пункта,
  // если в причине этот этап не назван. Ранние этапы в архив уходят по делу.
  if (next.to === 'archive')
    return set.to in STAGE_IN_NOTE && !STAGE_IN_NOTE[set.to].test(next.note);
  const order = DEAL_STAGES as readonly string[];
  return order.indexOf(next.to) < order.indexOf(set.to);
}

/**
 * Этапы, фактически поставленные за период [start, end): чат считается в том
 * этапе, который ему поставили, один раз за период. Пройденные «по пути»
 * этапы и ошибочные клики не засчитываются. Архив — не чаще раза в день на чат.
 */
export function actualStageMoves(
  events: StageSetEvent[],
  start: number,
  end: number,
): StageMove[] {
  const byChat = new Map<string, StageSetEvent[]>();
  for (const e of events) {
    const key = String(e.chatId);
    if (!byChat.has(key)) byChat.set(key, []);
    byChat.get(key)!.push(e);
  }
  const out: StageMove[] = [];
  const seen = new Set<string>();
  for (const list of byChat.values()) {
    list.sort((a, b) => a.ts - b.ts || a.id - b.id);
    list.forEach((e, i) => {
      if (e.ts < start || e.ts >= end) return;
      if (!(DEAL_STAGES as readonly string[]).includes(e.to)) return;
      if (isMisclick(e, list[i + 1])) return;
      const day = dayKey(e.ts);
      const key = `${e.to}:${String(e.chatId)}:${e.to === 'archive' ? day : ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ day, stage: e.to, chatId: e.chatId, ts: e.ts });
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Этапы, фактически поставленные за период, в виде (день, этап, чат). Одна
 * логика для общей статистики, таблицы по командам и плиток дашборда.
 */
export async function stageMovesInRange(
  prisma: PrismaService,
  start: number,
  end: number,
): Promise<StageMove[]> {
  // Чуть дальше конца периода: исправление ошибочного клика может прийти после.
  const rows = await prisma.funnelEvent.findMany({
    where: {
      eventType: DEAL_STAGE_EVENT,
      chatId: { not: null },
      ts: { gte: start, lt: end + MISCLICK_SECONDS },
    },
    select: { id: true, chatId: true, eventMeta: true, ts: true },
  });
  const events: StageSetEvent[] = [];
  for (const r of rows) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(r.eventMeta ?? '{}');
    } catch {
      continue;
    }
    events.push({
      chatId: r.chatId!,
      ts: r.ts,
      id: r.id,
      to: String(meta.to ?? ''),
      note: String(meta.note ?? ''),
    });
  }
  return actualStageMoves(events, start, end);
}

/**
 * Когда каждому чату впервые фактически поставили каждый этап воронки (без
 * «пройденных по пути» и ошибочных кликов): чат → { этап: ts }. Архив сюда не
 * входит — он не этап воронки.
 */
export async function actualStageTimes(
  prisma: PrismaService,
  chatIds: bigint[],
): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>();
  for (let i = 0; i < chatIds.length; i += 5000) {
    const rows = await prisma.funnelEvent.findMany({
      where: {
        eventType: DEAL_STAGE_EVENT,
        chatId: { in: chatIds.slice(i, i + 5000) },
      },
      select: { id: true, chatId: true, eventMeta: true, ts: true },
    });
    const events: StageSetEvent[] = [];
    for (const r of rows) {
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(r.eventMeta ?? '{}');
      } catch {
        continue;
      }
      events.push({
        chatId: r.chatId!,
        ts: r.ts,
        id: r.id,
        to: String(meta.to ?? ''),
        note: String(meta.note ?? ''),
      });
    }
    for (const m of actualStageMoves(events, 0, Number.MAX_SAFE_INTEGER)) {
      if (m.stage === 'archive') continue;
      const key = String(m.chatId);
      const got = out.get(key) ?? {};
      if (got[m.stage] === undefined || m.ts < got[m.stage])
        got[m.stage] = m.ts;
      out.set(key, got);
    }
  }
  return out;
}

/**
 * Какие этапы чатам фактически ставили за всё время: тем же правилом, что и
 * за период. Архив — если чат в архиве сейчас (из архива возвращают, и
 * прошлый архив итог не меняет).
 */
export async function actualStagesEver(
  prisma: PrismaService,
  chatIds: bigint[],
): Promise<Map<string, string[]>> {
  const times = await actualStageTimes(prisma, chatIds);
  const out = new Map<string, string[]>(
    [...times.entries()].map(([chat, t]) => [chat, Object.keys(t)]),
  );
  for (let i = 0; i < chatIds.length; i += 5000) {
    const facts = await prisma.leadFacts.findMany({
      where: {
        chatId: { in: chatIds.slice(i, i + 5000) },
        facts: { contains: '"archive"' },
      },
      select: { chatId: true, facts: true },
    });
    for (const f of facts) {
      try {
        if (JSON.parse(f.facts)['deal_stage'] !== 'archive') continue;
      } catch {
        continue;
      }
      const key = String(f.chatId);
      out.set(key, [...(out.get(key) ?? []), 'archive']);
    }
  }
  return out;
}

/**
 * Этапы каждого чата за всё время по тому же правилу, что и за период: только
 * фактически поставленные, без «пройденных по пути» и ошибочных кликов. Архив —
 * в архиве ли чат сейчас. Все смены этапов разом — поля JSON достаёт база.
 */
async function actualReachedRows(prisma: PrismaService): Promise<ReachedRow[]> {
  const [sets, archived] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: number;
        chat_id: bigint;
        ts: number;
        to: string | null;
        note: string | null;
      }>
    >`
      SELECT id, chat_id, ts,
        NULLIF(event_meta, '')::jsonb ->> 'to' AS "to",
        NULLIF(event_meta, '')::jsonb ->> 'note' AS note
      FROM funnel_events
      WHERE event_type = ${DEAL_STAGE_EVENT} AND chat_id IS NOT NULL`,
    prisma.$queryRaw<Array<{ chat_id: bigint }>>`
      SELECT chat_id FROM pinned_facts
      WHERE facts LIKE '%"archive"%'
        AND NULLIF(facts, '')::jsonb ->> 'deal_stage' = 'archive'`,
  ]);
  const byChat = new Map<string, ReachedRow>();
  const rowOf = (chatId: bigint) => {
    const key = String(chatId);
    let row = byChat.get(key);
    if (!row)
      byChat.set(
        key,
        (row = { chat_id: chatId, stages: [], archived: false, sets: [] }),
      );
    return row;
  };
  const moves = actualStageMoves(
    sets.map((e) => ({
      chatId: e.chat_id,
      ts: Number(e.ts),
      id: Number(e.id),
      to: e.to ?? '',
      note: e.note ?? '',
    })),
    0,
    Number.MAX_SAFE_INTEGER,
  );
  for (const m of moves) {
    if (m.stage === 'archive') continue;
    const row = rowOf(m.chatId);
    if (!row.stages.includes(m.stage)) row.stages.push(m.stage);
  }
  for (const e of actualStageSets(
    sets.map((e) => ({
      chatId: e.chat_id,
      ts: Number(e.ts),
      id: Number(e.id),
      to: e.to ?? '',
      note: e.note ?? '',
    })),
  ))
    rowOf(e.chatId).sets.push({ stage: e.to, ts: e.ts });
  for (const a of archived) rowOf(a.chat_id).archived = true;
  return [...byChat.values()];
}

/** Все смены этапа, кроме ошибочных кликов, по порядку. */
function actualStageSets(events: StageSetEvent[]): StageSetEvent[] {
  const byChat = new Map<string, StageSetEvent[]>();
  for (const e of events) {
    const key = String(e.chatId);
    if (!byChat.has(key)) byChat.set(key, []);
    byChat.get(key)!.push(e);
  }
  const out: StageSetEvent[] = [];
  for (const list of byChat.values()) {
    list.sort((a, b) => a.ts - b.ts || a.id - b.id);
    list.forEach((e, i) => {
      if (!(DEAL_STAGES as readonly string[]).includes(e.to)) return;
      if (!isMisclick(e, list[i + 1])) out.push(e);
    });
  }
  return out;
}

/** Этапы чата для фильтров панели: что фактически ставили и в архиве ли он. */
export interface ChatStageHistory {
  sets: Array<{ stage: string; ts: number }>;
  archived: boolean;
}

export const NO_STAGE_HISTORY: ChatStageHistory = { sets: [], archived: false };

/**
 * Дошёл ли чат до этапа — как в статистике. Без периода: этап хоть раз
 * фактически ставили, архив — чат в архиве сейчас. С периодом [since, until) —
 * этап поставили в этот период (архив тоже).
 */
export function reachedStage(
  h: ChatStageHistory,
  stage: string,
  since?: number,
  until?: number,
): boolean {
  if (since === undefined && until === undefined)
    return stage === 'archive'
      ? h.archived
      : h.sets.some((x) => x.stage === stage);
  return h.sets.some(
    (x) =>
      x.stage === stage &&
      (since === undefined || x.ts >= since) &&
      (until === undefined || x.ts < until),
  );
}

async function cachedReachedRows(prisma: PrismaService) {
  // Дашборд опрашивает это раз в 10 секунд: считаем раз в 30 секунд на всех.
  let cache = reachedRows.get(prisma);
  if (!cache) reachedRows.set(prisma, (cache = new TtlCache()));
  return cache.get('rows', REACHED_TTL_MS, () => actualReachedRows(prisma));
}

/** Этапы всех чатов, где их ставили или где чат в архиве: chat_id → история. */
export async function stageHistories(
  prisma: PrismaService,
): Promise<Map<string, ChatStageHistory>> {
  const rows = await cachedReachedRows(prisma);
  return new Map(
    rows.map((r) => [
      String(r.chat_id),
      { sets: r.sets, archived: r.archived },
    ]),
  );
}

/** Сколько чатов за всё время дошло до каждого этапа (фактически поставленные); архив — сколько в архиве сейчас. */
export async function stagesReachedEver(
  prisma: PrismaService,
  chatIds: Set<string> | null = null,
): Promise<Record<string, number>> {
  const rows = await cachedReachedRows(prisma);
  const out = zeroStages();
  let archive = 0;
  for (const r of rows) {
    if (chatIds && !chatIds.has(String(r.chat_id))) continue;
    for (const stage of r.stages) if (stage in out) out[stage] += 1;
    if (r.archived) archive += 1;
  }
  out.archive = archive;
  return out;
}
