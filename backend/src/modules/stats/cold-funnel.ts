import { Prisma } from '@prisma/client';
import type { PrismaService } from 'src/prisma.service';

/** Диалог активный, когда лид написал больше стольких сообщений. */
export const ACTIVE_AFTER = 5;

export interface ColdLeadRow {
  owner_user_id: number | null;
  written: boolean;
  /** Написать невозможно: Telegram не нашёл человека или не даёт ему писать. */
  invalid: boolean;
  user_msgs: number;
}

export interface ColdCounts {
  received: number;
  written: number;
  invalid: number;
  replied: number;
  active: number;
}

export interface ColdManager extends ColdCounts {
  user_id: number | null;
  username: string;
  role: string | null;
  region_code: string | null;
}

const zero = (): ColdCounts => ({
  received: 0,
  written: 0,
  invalid: 0,
  replied: 0,
  active: 0,
});

function add(into: ColdCounts, row: ColdLeadRow): void {
  into.received += 1;
  if (!row.written) {
    if (row.invalid) into.invalid += 1;
    return;
  }
  into.written += 1;
  if (row.user_msgs > 0) into.replied += 1;
  if (row.user_msgs > ACTIVE_AFTER) into.active += 1;
}

/**
 * Воронка холодки по лидам, полученным за период: сколько пришло, скольким
 * написали, сколько ответили и где разговор живой (лид написал больше
 * ACTIVE_AFTER сообщений). Считаются только сообщения лида после нашего
 * первого — наши не накручивают «активность».
 */
export function coldFunnel(
  rows: readonly ColdLeadRow[],
  users: ReadonlyMap<
    number,
    { username: string; role: string; region_code: string | null }
  >,
): { totals: ColdCounts; by_manager: ColdManager[] } {
  const totals = zero();
  const byOwner = new Map<number | null, ColdCounts>();
  for (const row of rows) {
    add(totals, row);
    let own = byOwner.get(row.owner_user_id);
    if (!own) byOwner.set(row.owner_user_id, (own = zero()));
    add(own, row);
  }
  const by_manager = [...byOwner.entries()]
    .map(([id, counts]) => {
      const user = id === null ? undefined : users.get(id);
      return {
        user_id: id,
        username: user?.username ?? (id === null ? '—' : `#${id}`),
        role: user?.role ?? null,
        region_code: user?.region_code ?? null,
        ...counts,
      };
    })
    .sort(
      (a, b) =>
        b.received - a.received ||
        b.active - a.active ||
        a.username.localeCompare(b.username),
    );
  return { totals, by_manager };
}

/** Холодные лиды, пришедшие в [start, end), с числом сообщений лида после первого нашего. */
export function coldLeadRows(
  prisma: PrismaService,
  start: number,
  end: number,
): Promise<ColdLeadRow[]> {
  return prisma.$queryRaw<ColdLeadRow[]>(Prisma.sql`
    SELECT p.owner_user_id,
           (p.first_contact_at IS NOT NULL) AS written,
           (p.first_contact_at IS NULL AND p.status = 'dead') AS invalid,
           COALESCE(m.n, 0)::int AS user_msgs
    FROM leads p
    LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM messages m
      WHERE m.chat_id = p.chat_id
        AND m.role = 'user'
        AND m.deleted_at IS NULL
        AND m.ts >= p.first_contact_at
    ) m ON p.first_contact_at IS NOT NULL AND p.chat_id IS NOT NULL
    WHERE p.cold AND p.inbound_at >= ${start} AND p.inbound_at < ${end}
  `);
}
