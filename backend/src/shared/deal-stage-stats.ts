import { PrismaService } from 'src/prisma.service';
import {
  DEAL_REACHED_EVENT,
  DEAL_STAGES,
  DEAL_STAGE_EVENT,
} from 'src/domain/deal-stage';
import { dayKey } from 'src/modules/stats/range';

export const zeroStages = (): Record<string, number> =>
  Object.fromEntries(DEAL_STAGES.map((s) => [s, 0]));

export interface StageMove {
  day: string;
  stage: string;
  chatId: bigint;
}

/**
 * События этапов за период в виде (день, этап, чат): воронка — по первому
 * достижению этапа, архив — по отправке в архив, не чаще раза в день на чат.
 * Одна логика для общей статистики, таблицы по менеджерам и плиток дашборда.
 */
export async function stageMovesInRange(
  prisma: PrismaService,
  start: number,
  end: number,
): Promise<StageMove[]> {
  const events = await prisma.funnelEvent.findMany({
    where: {
      eventType: { in: [DEAL_REACHED_EVENT, DEAL_STAGE_EVENT] },
      chatId: { not: null },
      ts: { gte: start, lt: end },
    },
    select: { chatId: true, eventType: true, eventMeta: true, ts: true },
    orderBy: { ts: 'asc' },
  });
  const out: StageMove[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(e.eventMeta ?? '{}');
    } catch {
      continue;
    }
    const stage =
      e.eventType === DEAL_REACHED_EVENT
        ? String(meta.stage ?? '')
        : meta.to === 'archive'
          ? 'archive'
          : '';
    if (!stage || !(DEAL_STAGES as readonly string[]).includes(stage)) continue;
    const day = dayKey(e.ts);
    const key = `${stage}:${String(e.chatId)}:${stage === 'archive' ? day : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ day, stage, chatId: e.chatId! });
  }
  return out;
}

/** Сколько чатов за всё время дошло до каждого этапа; архив — сколько в архиве сейчас. */
export async function stagesReachedEver(
  prisma: PrismaService,
  chatIds: Set<string> | null = null,
): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<{ chat_id: bigint; stage: string }[]>`
    SELECT p.chat_id, k.stage
    FROM pinned_facts p, jsonb_object_keys(COALESCE(p.facts::jsonb->'deal_reached', '{}'::jsonb)) AS k(stage)`;
  const archived = await prisma.$queryRaw<{ chat_id: bigint }[]>`
    SELECT chat_id FROM pinned_facts WHERE facts::jsonb->>'deal_stage' = 'archive'`;
  const out = zeroStages();
  for (const r of rows)
    if (r.stage in out && (!chatIds || chatIds.has(String(r.chat_id))))
      out[r.stage] += 1;
  out.archive = archived.filter(
    (r) => !chatIds || chatIds.has(String(r.chat_id)),
  ).length;
  return out;
}
