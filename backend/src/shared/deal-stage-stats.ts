import { PrismaService } from 'src/prisma.service';
import { DEAL_STAGES, DEAL_STAGE_EVENT } from 'src/domain/deal-stage';
import { dayKey } from 'src/modules/stats/range';
import { TtlCache } from './ttl-cache';

type ReachedRow = { chat_id: bigint; stages: string[]; archived: boolean };
// Проход по всем карточкам с этапами: ~0,2 с и тысячи строк. Плитки дашборда
// спрашивают его у каждого менеджера раз в 10 секунд — отдаём общий ответ.
const reachedRows = new WeakMap<object, TtlCache>();
const REACHED_TTL_MS = 30_000;

export const zeroStages = (): Record<string, number> =>
  Object.fromEntries(DEAL_STAGES.map((s) => [s, 0]));

export interface StageMove {
  day: string;
  stage: string;
  chatId: bigint;
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
      out.push({ day, stage: e.to, chatId: e.chatId });
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
 * Какие этапы чатам фактически ставили за всё время: тем же правилом, что и
 * за период, — без «пройденных по пути» и ошибочных кликов. Архив — если чат
 * в архиве сейчас (из архива возвращают, и прошлый архив итог не меняет).
 */
export async function actualStagesEver(
  prisma: PrismaService,
  chatIds: bigint[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < chatIds.length; i += 5000) {
    const chunk = chatIds.slice(i, i + 5000);
    const [rows, facts] = await Promise.all([
      prisma.funnelEvent.findMany({
        where: { eventType: DEAL_STAGE_EVENT, chatId: { in: chunk } },
        select: { id: true, chatId: true, eventMeta: true, ts: true },
      }),
      prisma.leadFacts.findMany({
        where: { chatId: { in: chunk }, facts: { contains: '"archive"' } },
        select: { chatId: true, facts: true },
      }),
    ]);
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
      const got = out.get(key) ?? [];
      if (!got.includes(m.stage)) got.push(m.stage);
      out.set(key, got);
    }
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

/** Сколько чатов за всё время дошло до каждого этапа; архив — сколько в архиве сейчас. */
export async function stagesReachedEver(
  prisma: PrismaService,
  chatIds: Set<string> | null = null,
): Promise<Record<string, number>> {
  // Дашборд опрашивает это раз в 10 секунд: один проход по таблице, и JSON
  // разбирается только у чатов, где этапы вообще были.
  let cache = reachedRows.get(prisma);
  if (!cache) reachedRows.set(prisma, (cache = new TtlCache()));
  const rows = await cache.get(
    'rows',
    REACHED_TTL_MS,
    () => prisma.$queryRaw<ReachedRow[]>`
    SELECT p.chat_id,
      ARRAY(SELECT jsonb_object_keys(COALESCE(j.v->'deal_reached', '{}'::jsonb))) AS stages,
      COALESCE(j.v->>'deal_stage' = 'archive', false) AS archived
    FROM pinned_facts p, LATERAL (SELECT p.facts::jsonb AS v) j
    WHERE p.facts LIKE '%"deal_%'`,
  );
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
