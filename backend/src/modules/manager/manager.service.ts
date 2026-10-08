import { Inject, Injectable } from '@nestjs/common';
import { REPLY_BRAIN, type ReplyBrain } from 'src/brain/reply-brain.port';
import type { NextBotAction } from 'src/brain/nastya/dialogue/forecast';
import { Prisma } from '@prisma/client';
import { resolveRange, type DayRange } from '../stats/range';
import {
  stageMovesInRange,
  stagesReachedEver,
  zeroStages,
} from 'src/shared/deal-stage-stats';
import { PrismaService } from 'src/prisma.service';
import { PersonaService } from 'src/brain/persona.service';
import { ClockService } from 'src/shared/clock.service';
import { DEFAULT_FUNNEL_STAGE } from 'src/domain/funnel';
import {
  HIDDEN_FROM_DASHBOARD_KEY,
  intOrNull,
  parseLeadFacts,
  LeadFacts,
  HANDOFF_TRIGGER_KEY,
  MEDIA_REQUEST_KEY,
  PITCH_PHASE_KEY,
} from 'src/domain/lead-facts';
import { pauseReasonHead, TakeoverReason } from 'src/domain/pause';
import { pausedBeforeKeyMove } from 'src/domain/attention-reasons';
import {
  PresenceService,
  type ClientActivity,
} from 'src/shared/presence.service';
import {
  accountLostOf,
  clientTelegramView,
  type ClientPresence,
} from 'src/domain/tg-status';
import {
  ManagerAttributionService,
  ManagerAttribution,
  UNASSIGNED_MANAGER,
} from 'src/shared/manager-attribution.service';

export const ACTIVE_WINDOW_S = 24 * 3600;

/** Предел выдачи списка: панель фильтрует и листает на своей стороне. */
const CONVERSATIONS_LIMIT = 1000;

export interface StageView {
  id: string;
  title: string;
  index: number;
  total: number;
}

export interface ManagerChatRow extends ManagerAttribution {
  chat_id: number;
  account_id: number | null;
  account_username: string | null;
  name: string | null;
  /** этап сделки, выставленный менеджером; null — не задан */
  deal_stage: string | null;
  deal_note: string | null;
  age: number | null;
  city: string | null;
  phone: string | null;
  client_username: string | null;
  avatar_url: string | null;
  typing: ClientActivity | null;
  next_bot_action: NextBotAction | null;
  client_presence: ClientPresence | null;
  blocked_by_client_at: number | null;
  cleared_by_client_at: number | null;
  unread_count: number;
  account_lost: 'banned' | 'logged_out' | null;
  status: string;
  stage: StageView | null;
  vbros_phase: string;
  is_paused: boolean;
  last_message_ts: number;
  handoff_state: string | null;
  hold_armed_at: number | null;
  queue_reason: string | null;
  waiting_since: number | null;
  hidden: boolean;
}

interface RawRow {
  chat_id: bigint | number;
  account_id: number | null;
  account_username?: string | null;
  pause_state: string | null;
  pause_reason?: string | null;
  paused_ts?: number | null;
  handoff_state?: string | null;
  hold_armed_at?: number | null;
  last_ts: number | bigint | null;
  last_client_ts?: number | bigint | null;
  facts: string | null;
  profile_city: string | null;
  profile_phone?: string | null;
  profile_username?: string | null;
  account_status?: string | null;
  account_lost_at?: number | bigint | null;
  client_status?: string | null;
  client_status_at?: number | bigint | null;
  blocked_by_client_at?: number | bigint | null;
  cleared_by_client_at?: number | bigint | null;
  unread_count?: number | bigint | null;
}

const n = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

const HAS_CLIENT_SQL = Prisma.sql`AND EXISTS (SELECT 1 FROM messages mu WHERE mu.chat_id = c.chat_id AND mu.role = 'user')`;
const NOT_HIDDEN_SQL = Prisma.sql`AND COALESCE((NULLIF(p.facts, '')::jsonb ->> '_manager_hidden')::boolean, false) = false`;

@Injectable()
export class ManagerService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private personas: PersonaService,
    private presence: PresenceService,
    @Inject(REPLY_BRAIN) private brain: ReplyBrain,
    private attribution: ManagerAttributionService,
  ) {}

  /**
   * Прогноз «что бот сделает дальше» на строку дашборда. Движок сбрасывает
   * прогноз чата сам, когда в нём что-то происходит, поэтому кешированный
   * ответ можно отдавать долго; пересчёт устаревших идёт в фоне.
   */
  private static readonly FORECAST_MAX_AGE_S = 120;

  private async withNextActions(
    rows: ManagerChatRow[],
  ): Promise<ManagerChatRow[]> {
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        next_bot_action: await this.brain
          .nextAction(row.chat_id, ManagerService.FORECAST_MAX_AGE_S)
          .catch(() => null),
      })),
    );
  }

  private async withManagers(
    rows: ManagerChatRow[],
  ): Promise<ManagerChatRow[]> {
    const directory = await this.attribution.directory();
    return rows.map((row) => ({
      ...row,
      ...directory.forAccount(row.account_id),
    }));
  }

  private async stageResolver(): Promise<
    (accountId: number | null, facts: LeadFacts) => StageView | null
  > {
    const accounts = await this.prisma.tgAccount.findMany({
      select: { id: true, personaId: true },
    });
    const personaByAccount = new Map(accounts.map((a) => [a.id, a.personaId]));
    const fallback = await this.personas.default().catch(() => null);
    const stagesBySlug = new Map<
      string,
      Array<{ id: string; title: string }>
    >();
    const toStages = (goals: Record<string, any> | undefined) =>
      ((goals?.['stages'] ?? []) as Array<Record<string, unknown>>).map(
        (st) => ({
          id: String(st.id ?? ''),
          title: String(st.title ?? st.id ?? ''),
        }),
      );
    for (const slug of new Set(
      accounts.map((a) => a.personaId).filter(Boolean),
    )) {
      const persona = await this.personas.bySlug(slug).catch(() => fallback);
      stagesBySlug.set(slug, toStages(persona?.config.goals));
    }
    const fallbackStages = toStages(fallback?.config.goals);

    return (accountId, facts) => {
      const slug = accountId === null ? null : personaByAccount.get(accountId);
      const stages = (slug && stagesBySlug.get(slug)) || fallbackStages;
      if (!stages.length) return null;
      const at = Math.max(
        0,
        stages.findIndex((st) => st.id === String(facts['_brain_stage'] ?? '')),
      );
      return {
        id: stages[at].id,
        title: stages[at].title,
        index: at + 1,
        total: stages.length,
      };
    };
  }

  private scopeSql(accounts: number[] | null): Prisma.Sql {
    if (accounts === null) return Prisma.empty;
    if (accounts.length === 0) return Prisma.sql`AND 1 = 0`;
    return Prisma.sql`AND c.account_id IN (${Prisma.join(accounts)})`;
  }

  private row(
    r: RawRow,
    facts: LeadFacts,
    stage: StageView | null = null,
  ): ManagerChatRow {
    return {
      ...UNASSIGNED_MANAGER,
      chat_id: Number(r.chat_id),
      account_id: r.account_id === null ? null : Number(r.account_id),
      account_username: r.account_username || null,
      name: (facts['name'] as string) ?? null,
      deal_stage: (facts['deal_stage'] as string) ?? null,
      deal_note: (facts['deal_note'] as string) ?? null,
      age: intOrNull(facts['age']),
      city: (facts['city'] as string) || r.profile_city || null,
      phone:
        (facts['handoff_phone_collected'] as string) ||
        (facts['phone'] as string) ||
        r.profile_phone ||
        null,
      client_username:
        (facts['tg_username'] as string) || r.profile_username || null,
      avatar_url: this.presence.avatarUrl(Number(r.chat_id)),
      typing: this.presence.activityOf(Number(r.chat_id)),
      next_bot_action: null,
      ...clientTelegramView(
        {
          clientStatus: r.client_status ?? null,
          clientStatusAt: n(r.client_status_at),
          blockedByClientAt: n(r.blocked_by_client_at),
          clearedByClientAt: n(r.cleared_by_client_at),
        },
        this.clock.ts(),
      ),
      account_lost: accountLostOf(
        r.account_status ?? null,
        n(r.account_lost_at),
      ),
      unread_count: n(r.unread_count) ?? 0,
      status: String(facts['funnel_stage'] || DEFAULT_FUNNEL_STAGE),
      stage,
      vbros_phase: String(facts[PITCH_PHASE_KEY] ?? ''),
      is_paused: (r.pause_state ?? 'active') === 'paused',
      last_message_ts: n(r.last_ts) ?? 0,
      handoff_state: r.handoff_state ?? null,
      hold_armed_at: n(r.hold_armed_at),
      queue_reason: null,
      waiting_since: null,
      hidden: Boolean(facts[HIDDEN_FROM_DASHBOARD_KEY]),
    };
  }

  /** Сколько диалогов всего: срез в списке не должен выглядеть как весь список. */
  async conversationsTotal(accounts: number[] | null): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ n: bigint | number }[]>(
      Prisma.sql`SELECT COUNT(*) AS n FROM contacts c
        LEFT JOIN pinned_facts p ON p.chat_id = c.chat_id
        WHERE 1 = 1 ${this.scopeSql(accounts)} ${HAS_CLIENT_SQL} ${NOT_HIDDEN_SQL}`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async conversations(
    accounts: number[] | null,
    opts: { limit?: number; includeHidden?: boolean } = {},
  ): Promise<ManagerChatRow[]> {
    const limit = opts.limit ?? CONVERSATIONS_LIMIT;
    const visible = opts.includeHidden
      ? HAS_CLIENT_SQL
      : Prisma.sql`${HAS_CLIENT_SQL} ${NOT_HIDDEN_SQL}`;
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT c.chat_id, c.account_id, c.pause_state, a.username AS account_username, a.status AS account_status, a.banned_at AS account_lost_at,
             c.client_status, c.client_status_at, c.blocked_by_client_at, c.cleared_by_client_at,
             (SELECT COUNT(*) FROM messages mu
               WHERE mu.chat_id = c.chat_id AND mu.role = 'user' AND mu.deleted_at IS NULL
                 AND mu.ts > COALESCE(c.manager_seen_ts, 0)
                 AND mu.ts > COALESCE((SELECT MAX(ma.ts) FROM messages ma
                                       WHERE ma.chat_id = c.chat_id AND ma.role = 'assistant' AND ma.text NOT LIKE '[Реакция%'), 0)) AS unread_count,
             (SELECT MAX(ts) FROM messages m WHERE m.chat_id = c.chat_id) AS last_ts,
             p.facts AS facts,
             (SELECT pn.city FROM phone_numbers pn WHERE pn.telegram_user_id = c.chat_id LIMIT 1) AS profile_city,
             (SELECT pn.phone_e164 FROM phone_numbers pn WHERE pn.telegram_user_id = c.chat_id LIMIT 1) AS profile_phone,
             (SELECT COALESCE(pn.telegram_username, pn.username_key) FROM phone_numbers pn WHERE pn.telegram_user_id = c.chat_id LIMIT 1) AS profile_username
      FROM contacts c LEFT JOIN pinned_facts p ON p.chat_id = c.chat_id
      LEFT JOIN tg_accounts a ON a.id = c.account_id
      WHERE 1 = 1 ${this.scopeSql(accounts)} ${visible}
      ORDER BY last_ts DESC NULLS LAST LIMIT ${limit}`;
    const stageOf = await this.stageResolver();
    const listed = await this.withManagers(
      rows.map((r) => {
        const facts = parseLeadFacts(r.facts);
        return this.row(
          r,
          facts,
          stageOf(r.account_id === null ? null : Number(r.account_id), facts),
        );
      }),
    );
    // В архиве бот молчит: прогноз там не нужен, а стоил он десяток запросов на чат.
    return opts.includeHidden ? listed : this.withNextActions(listed);
  }

  /** Этапы для плиток: за период — пройденные в эти дни, без периода — дошли всего. */
  private async stageTiles(
    accounts: number[] | null,
    range: DayRange | null,
  ): Promise<Record<string, number>> {
    const mine =
      accounts === null
        ? null
        : new Set(
            (
              await this.prisma.contact.findMany({
                where: { accountId: { in: accounts } },
                select: { chatId: true },
              })
            ).map((c) => String(c.chatId)),
          );
    if (!range) return stagesReachedEver(this.prisma, mine);
    const out = zeroStages();
    for (const m of await stageMovesInRange(
      this.prisma,
      range.start,
      range.end,
    ))
      if (!mine || mine.has(String(m.chatId))) out[m.stage] += 1;
    return out;
  }

  private async readAttentionQueue(
    accounts: number[] | null,
  ): Promise<ManagerChatRow[]> {
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT c.chat_id, c.account_id, c.pause_state, c.pause_reason, c.paused_ts, a.username AS account_username, a.status AS account_status, a.banned_at AS account_lost_at,
             c.client_status, c.client_status_at, c.blocked_by_client_at, c.cleared_by_client_at,
             (SELECT COUNT(*) FROM messages mu
               WHERE mu.chat_id = c.chat_id AND mu.role = 'user' AND mu.deleted_at IS NULL
                 AND mu.ts > COALESCE(c.manager_seen_ts, 0)
                 AND mu.ts > COALESCE((SELECT MAX(ma.ts) FROM messages ma
                                       WHERE ma.chat_id = c.chat_id AND ma.role = 'assistant' AND ma.text NOT LIKE '[Реакция%'), 0)) AS unread_count,
             h.state AS handoff_state, h.hold_armed_at AS hold_armed_at,
             (SELECT MAX(ts) FROM messages m WHERE m.chat_id = c.chat_id) AS last_ts,
             (SELECT MAX(ts) FROM messages m WHERE m.chat_id = c.chat_id AND m.role = 'user') AS last_client_ts,
             p.facts AS facts,
             (SELECT pn.city FROM phone_numbers pn WHERE pn.telegram_user_id = c.chat_id LIMIT 1) AS profile_city,
             (SELECT pn.phone_e164 FROM phone_numbers pn WHERE pn.telegram_user_id = c.chat_id LIMIT 1) AS profile_phone,
             (SELECT COALESCE(pn.telegram_username, pn.username_key) FROM phone_numbers pn WHERE pn.telegram_user_id = c.chat_id LIMIT 1) AS profile_username
      FROM contacts c
      LEFT JOIN lead_handoff h ON h.chat_id = c.chat_id
      LEFT JOIN pinned_facts p ON p.chat_id = c.chat_id
      LEFT JOIN tg_accounts a ON a.id = c.account_id
      WHERE 1 = 1 ${this.scopeSql(accounts)} ${NOT_HIDDEN_SQL}`;

    const out: ManagerChatRow[] = [];
    const stageOf = await this.stageResolver();
    for (const r of rows) {
      const facts = parseLeadFacts(r.facts);
      const [reason, since] = this.attentionReason(r, facts);
      if (reason === null) continue;
      const stage = stageOf(
        r.account_id === null ? null : Number(r.account_id),
        facts,
      );
      out.push({
        ...this.row(r, facts, stage),
        queue_reason: reason,
        waiting_since: since,
      });
    }
    return this.withManagers(
      out.sort((a, b) => (a.waiting_since ?? 0) - (b.waiting_since ?? 0)),
    );
  }

  private attentionReason(
    r: RawRow,
    facts: LeadFacts,
  ): [string | null, number | null] {
    if (r.account_id === null) return [null, null];
    if (r.handoff_state === 'hold_armed')
      return ['hold_armed', n(r.hold_armed_at)];
    if (
      r.pause_state === 'paused' &&
      pauseReasonHead(r.pause_reason) === TakeoverReason.MANUAL_TAKEOVER
    ) {
      const media = facts[MEDIA_REQUEST_KEY] as { kind?: string } | undefined;
      if (media?.kind) return [`media_${media.kind}`, n(r.paused_ts)];
      if (facts[HANDOFF_TRIGGER_KEY]) return ['trigger_phrase', n(r.paused_ts)];
      return [pausedBeforeKeyMove(facts) ?? 'manual_takeover', n(r.paused_ts)];
    }
    if (
      r.pause_state === 'paused' &&
      pauseReasonHead(r.pause_reason) === TakeoverReason.HOLD &&
      n(r.unread_count) > 0
    ) {
      return ['manual_mode', n(r.last_client_ts) ?? n(r.paused_ts)];
    }
    return [null, null];
  }

  queue(accounts: number[] | null): Promise<ManagerChatRow[]> {
    return this.readAttentionQueue(accounts);
  }

  /**
   * Плитки дашборда. Без периода — как есть: все диалоги, лиды за всё время,
   * этапы «дошли всего». С периодом (дни по Москве) — диалоги, в которых
   * клиент писал в эти дни, лиды, оформленные в эти дни, и этапы, пройденные
   * в эти дни. «Ждут менеджера», «активны сейчас» и аккаунты от периода не
   * зависят: это состояние на сейчас.
   */
  async stats(
    accounts: number[] | null,
    period: { from?: string; to?: string } = {},
  ) {
    const nowTs = this.clock.ts();
    const activeSince = nowTs - ACTIVE_WINDOW_S;
    const scope = this.scopeSql(accounts);
    const range = period.from || period.to ? resolveRange(period, nowTs) : null;
    const one = async (sql: Prisma.Sql) => {
      const r = await this.prisma.$queryRaw<{ n: bigint | number }[]>(sql);
      return Number(r[0]?.n ?? 0);
    };
    const inPeriod = range
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM messages mp WHERE mp.chat_id = c.chat_id AND mp.role = 'user' AND mp.ts >= ${range.start} AND mp.ts < ${range.end})`
      : Prisma.empty;
    const total = await one(Prisma.sql`
      SELECT COUNT(*) AS n FROM contacts c LEFT JOIN pinned_facts p ON p.chat_id = c.chat_id
      WHERE 1 = 1 ${scope} ${HAS_CLIENT_SQL} ${NOT_HIDDEN_SQL} ${inPeriod}`);
    const active = await one(Prisma.sql`
      SELECT COUNT(*) AS n FROM contacts c LEFT JOIN pinned_facts p ON p.chat_id = c.chat_id
      WHERE EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.chat_id AND m.ts >= ${activeSince})
      ${scope} ${HAS_CLIENT_SQL} ${NOT_HIDDEN_SQL}`);
    const leadsInPeriod = range
      ? Prisma.sql`AND COALESCE(h.closed_at, h.contact_delivered_at, h.analyst_assigned_at, h.updated_at) >= ${range.start}
                   AND COALESCE(h.closed_at, h.contact_delivered_at, h.analyst_assigned_at, h.updated_at) < ${range.end}`
      : Prisma.empty;
    const leads = await one(Prisma.sql`
      SELECT COUNT(*) AS n FROM lead_handoff h JOIN contacts c ON c.chat_id = h.chat_id
      WHERE h.state IN ('analyst_assigned', 'contact_delivered', 'closed') ${scope} ${leadsInPeriod}`);
    const queue = await this.readAttentionQueue(accounts);
    const need = queue.filter((r) => r.queue_reason !== 'manual_mode').length;
    const stages = await this.stageTiles(accounts, range);
    return {
      need_manager: need,
      total,
      active_now: active,
      leads,
      period: range ? { from: range.from, to: range.to } : null,
      ...Object.fromEntries(
        Object.entries(stages).map(([k, v]) => [`stage_${k}`, v]),
      ),
      accounts:
        accounts === null
          ? await this.prisma.tgAccount.count({
              where: { status: { not: 'retired' } },
            })
          : accounts.length,
    };
  }
}
