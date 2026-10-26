import { GATEWAY_ROUTE } from 'src/brain/llm/gateway';
import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { Role } from 'src/enums/roles.enum';
import { ClockService } from 'src/shared/clock.service';
import { MemoService } from 'src/shared/memo.service';
import { fromChatId } from 'src/utils/ids';
import {
  DEFAULT_PRICES,
  PRICES_KEY,
  ZERO_TOKENS,
  cacheWrite1hExtra,
  costOf,
  parseTable,
  resolvePrice,
  type ModelPrice,
  type PriceTable,
  type Tokens,
} from './prices';
import { dayKey, resolveRange, type DayRange } from './range';
import { ACTIVE_AFTER, coldFunnel, coldLeadRows } from './cold-funnel';
import {
  FUNNEL_STEPS,
  addLead,
  costPerStep,
  heatmap,
  sliceBy,
  speedOf,
  zeroFunnel,
  type CohortLead,
} from './insights';
import { normalizeModel } from './prices';
import { DEAL_STAGES, DEAL_STAGE_LABELS } from 'src/domain/deal-stage';
import {
  stageMovesInRange,
  chatStagesEver,
  countStagesReached,
  zeroStages,
} from 'src/shared/deal-stage-stats';

const TOP_CHATS = 12;
const INSIGHTS_MAX_DAYS = 93;
const NO_MANAGER = '—';

interface LeadCounts {
  uploaded: number;
  valid: number;
  replied: number;
  byDay: Map<string, { uploaded: number; valid: number; replied: number }>;
}

interface MessageCounts {
  in: number;
  out: number;
  manual: number;
  chats: Set<string>;
  byDay: Map<
    string,
    { in: number; out: number; manual: number; chats: Set<string> }
  >;
}

const talkOf = (
  map: Map<string, MessageCounts>,
  key: string,
): MessageCounts => {
  let row = map.get(key);
  if (!row)
    map.set(
      key,
      (row = { in: 0, out: 0, manual: 0, chats: new Set(), byDay: new Map() }),
    );
  return row;
};

const talkDay = (row: MessageCounts, day: string) => {
  let value = row.byDay.get(day);
  if (!value)
    row.byDay.set(
      day,
      (value = { in: 0, out: 0, manual: 0, chats: new Set<string>() }),
    );
  return value;
};

const usd = (x: number): number => Math.round(x * 1e6) / 1e6;

interface UsageRow {
  chatId: bigint | null;
  personaId: string | null;
  model: string;
  stage: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  cacheWrite1hTokens: number | null;
  elapsedMs: number | null;
  createdAt: number;
}

function tokensOf(u: UsageRow): Tokens {
  const cacheRead = u.cachedTokens ?? 0;
  const cacheWrite = u.cacheWriteTokens ?? 0;
  const whole = u.inputTokens ?? 0;
  return {
    input: Math.max(0, whole - cacheRead - cacheWrite),
    output: u.outputTokens ?? 0,
    cache_write: cacheWrite,
    cache_read: cacheRead,
  };
}

const addTokens = (a: Tokens, b: Tokens): void => {
  a.input += b.input;
  a.output += b.output;
  a.cache_write += b.cache_write;
  a.cache_read += b.cache_read;
};

interface Bucket {
  calls: number;
  tokens: Tokens;
  cost: number;
  latencySum: number;
  latencyN: number;
}

const bucket = (): Bucket => ({
  calls: 0,
  tokens: ZERO_TOKENS(),
  cost: 0,
  latencySum: 0,
  latencyN: 0,
});

function add(b: Bucket, u: UsageRow, price: ModelPrice | null): void {
  const t = tokensOf(u);
  b.calls += 1;
  addTokens(b.tokens, t);
  b.cost +=
    costOf(price, t) + cacheWrite1hExtra(price, u.cacheWrite1hTokens ?? 0);
  if (u.elapsedMs !== null) {
    b.latencySum += u.elapsedMs;
    b.latencyN += 1;
  }
}

const avgLatency = (b: Bucket): number | null =>
  b.latencyN ? Math.round(b.latencySum / b.latencyN) : null;

const view = (b: Bucket) => ({
  calls: b.calls,
  tokens: b.tokens,
  cost_usd: usd(b.cost),
  avg_latency_ms: avgLatency(b),
});

const mergeBucket = (into: Bucket, from: Bucket): void => {
  into.calls += from.calls;
  addTokens(into.tokens, from.tokens);
  into.cost += from.cost;
  into.latencySum += from.latencySum;
  into.latencyN += from.latencyN;
};

/** Сырые агрегаты одного менеджера за период; команда — слияние таких по людям. */
interface ManagerAgg {
  spend: Bucket;
  spendDays: Map<string, Bucket>;
  chats: Set<string>;
  talk: MessageCounts;
  leads: LeadCounts;
  stages: {
    total: Record<string, number>;
    byDay: Map<string, Record<string, number>>;
  };
}

const emptyAgg = (): ManagerAgg => ({
  spend: bucket(),
  spendDays: new Map(),
  chats: new Set(),
  talk: { in: 0, out: 0, manual: 0, chats: new Set(), byDay: new Map() },
  leads: { uploaded: 0, valid: 0, replied: 0, byDay: new Map() },
  stages: { total: zeroStages(), byDay: new Map() },
});

function mergeAgg(into: ManagerAgg, from: ManagerAgg): ManagerAgg {
  mergeBucket(into.spend, from.spend);
  for (const [day, b] of from.spendDays) {
    if (!into.spendDays.has(day)) into.spendDays.set(day, bucket());
    mergeBucket(into.spendDays.get(day)!, b);
  }
  for (const c of from.chats) into.chats.add(c);
  into.talk.in += from.talk.in;
  into.talk.out += from.talk.out;
  into.talk.manual += from.talk.manual;
  for (const c of from.talk.chats) into.talk.chats.add(c);
  for (const [day, d] of from.talk.byDay) {
    const t = talkDay(into.talk, day);
    t.in += d.in;
    t.out += d.out;
    t.manual += d.manual;
    for (const c of d.chats) t.chats.add(c);
  }
  into.leads.uploaded += from.leads.uploaded;
  into.leads.valid += from.leads.valid;
  into.leads.replied += from.leads.replied;
  for (const [day, d] of from.leads.byDay) {
    let t = into.leads.byDay.get(day);
    if (!t)
      into.leads.byDay.set(day, (t = { uploaded: 0, valid: 0, replied: 0 }));
    t.uploaded += d.uploaded;
    t.valid += d.valid;
    t.replied += d.replied;
  }
  for (const [stage, n] of Object.entries(from.stages.total))
    into.stages.total[stage] = (into.stages.total[stage] ?? 0) + n;
  for (const [day, counts] of from.stages.byDay) {
    if (!into.stages.byDay.has(day)) into.stages.byDay.set(day, zeroStages());
    const t = into.stages.byDay.get(day)!;
    for (const [stage, n] of Object.entries(counts))
      t[stage] = (t[stage] ?? 0) + n;
  }
  return into;
}

const share = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 1000) / 1000 : 0;

/** Строка таблицы: итог за период и дни, в которых была хоть какая-то работа. */
function aggRow(agg: ManagerAgg, range: DayRange) {
  return {
    ...view(agg.spend),
    chats: agg.chats.size,
    messages_in: agg.talk.in,
    messages_out: agg.talk.out,
    manual_share: share(agg.talk.manual, agg.talk.out),
    leads_uploaded: agg.leads.uploaded,
    leads_valid: agg.leads.valid,
    leads_replied: agg.leads.replied,
    active_chats: agg.talk.chats.size,
    stages: agg.stages.total,
    days: range.days
      .map((day) => {
        const talkDay = agg.talk.byDay.get(day);
        const leadDay = agg.leads.byDay.get(day);
        return {
          day,
          stages: agg.stages.byDay.get(day) ?? zeroStages(),
          ...view(agg.spendDays.get(day) ?? bucket()),
          messages_in: talkDay?.in ?? 0,
          messages_out: talkDay?.out ?? 0,
          manual_share: share(talkDay?.manual ?? 0, talkDay?.out ?? 0),
          leads_uploaded: leadDay?.uploaded ?? 0,
          leads_valid: leadDay?.valid ?? 0,
          leads_replied: leadDay?.replied ?? 0,
          active_chats: talkDay?.chats.size ?? 0,
        };
      })
      .filter(
        (d) =>
          d.calls ||
          d.messages_in ||
          d.messages_out ||
          d.leads_uploaded ||
          Object.values(d.stages).some((n) => n > 0),
      ),
  };
}

function memoPrice(table: PriceTable): (model: string) => ModelPrice | null {
  const cache = new Map<string, ModelPrice | null>();
  return (model) => {
    if (!cache.has(model)) cache.set(model, resolvePrice(table, model));
    return cache.get(model) ?? null;
  };
}

@Injectable()
export class StatsService {
  private readonly log = new Logger(StatsService.name);

  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private memo: MemoService,
  ) {}

  /**
   * Этапы сделки по дням. Этапы воронки: чат засчитывается в этап один раз —
   * в день, когда впервые до него дошёл; пройденные этапы остаются, откат
   * назад ничего не снимает. Архив отдельно: по дням — сколько чатов
   * отправили в архив, «всего» — сколько чатов в архиве сейчас.
   */
  /** Холодка за период: получено, написали, ответили, активные — всего и по менеджерам. */
  async coldLeads(query: { from?: string; to?: string }) {
    const range = resolveRange(query, this.clock.ts());
    const rows = await coldLeadRows(this.prisma, range.start, range.end);
    const ids = [
      ...new Set(rows.map((r) => r.owner_user_id).filter((id) => id !== null)),
    ];
    const users = await this.prisma.dashboardUser.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, role: true, regionCode: true },
    });
    return {
      range: { from: range.from, to: range.to },
      active_after: ACTIVE_AFTER,
      ...coldFunnel(
        rows,
        new Map(
          users.map((u) => [
            u.id,
            { username: u.username, role: u.role, region_code: u.regionCode },
          ]),
        ),
      ),
    };
  }

  /**
   * Срезы «про результат»: воронка когорты лидов (кому впервые написали в
   * период) и её разрезы, стоимость результата, аккаунты, тепловая карта
   * сообщений клиентов и скорость ответов. Подробности — в insights.ts.
   */
  async insights(query: { from?: string; to?: string }) {
    const range = resolveRange(query, this.clock.ts());
    // Три прохода по messages за период: длиннее квартала — дорого и бессмысленно.
    if (range.days.length > INSIGHTS_MAX_DAYS)
      throw new UnprocessableEntityException(
        `срезы считаются не больше чем за ${INSIGHTS_MAX_DAYS} дней`,
      );
    const cohort = await this.prisma.$queryRaw<
      {
        persona_id: string | null;
        owner_user_id: number | null;
        source_type: string;
        donor: string | null;
        account_id: number | null;
        cold: boolean;
        chat_id: bigint | null;
        replied: boolean;
        reached: string[] | null;
      }[]
    >`
      SELECT l.persona_id, l.owner_user_id, l.source_type, l.donor,
             COALESCE(l.assigned_account_id, l.preferred_account_id) AS account_id,
             l.cold, l.chat_id,
             EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = l.chat_id AND m.role = 'user'
                       AND m.deleted_at IS NULL AND m.ts >= l.first_contact_at) AS replied,
             ARRAY(SELECT jsonb_object_keys(
                     CASE WHEN jsonb_typeof(p.facts::jsonb->'deal_reached') = 'object'
                          THEN p.facts::jsonb->'deal_reached' ELSE '{}'::jsonb END)
                   FROM pinned_facts p WHERE p.chat_id = l.chat_id AND p.facts LIKE '%"deal_reached"%') AS reached
      FROM leads l
      WHERE l.first_contact_at >= ${range.start} AND l.first_contact_at < ${range.end}`;
    const leads: CohortLead[] = cohort.map((r) => ({
      persona: r.persona_id,
      owner: r.owner_user_id === null ? null : Number(r.owner_user_id),
      source: r.donor ? `donor:${r.donor}` : r.source_type,
      account: r.account_id === null ? null : Number(r.account_id),
      cold: r.cold,
      chatId: r.chat_id === null ? null : String(r.chat_id),
      replied: r.replied,
      reached: r.reached ?? [],
    }));

    // Деньги на модели по чатам когорты — за всё время: столько стоил результат.
    // Токены суммируются в базе по (чат, модель): цена линейна по токенам, в JS
    // остаётся только умножить на прайс — вместо выгрузки каждого вызова.
    const price = memoPrice(await this.prices());
    const costByChat = new Map<string, number>();
    const agg = await this.prisma.$queryRaw<
      {
        chat_id: bigint;
        model: string;
        input: bigint;
        output: bigint;
        cached: bigint;
        cw: bigint;
        cw1h: bigint;
      }[]
    >`
      SELECT u.chat_id, u.model,
             COALESCE(SUM(u.input_tokens), 0) AS input,
             COALESCE(SUM(u.output_tokens), 0) AS output,
             COALESCE(SUM(u.cached_tokens), 0) AS cached,
             COALESCE(SUM(u.cache_write_tokens), 0) AS cw,
             COALESCE(SUM(u.cache_write_1h_tokens), 0) AS cw1h
      FROM model_usage u
      WHERE u.chat_id IN (SELECT l.chat_id FROM leads l
                          WHERE l.first_contact_at >= ${range.start} AND l.first_contact_at < ${range.end}
                            AND l.chat_id IS NOT NULL)
      GROUP BY u.chat_id, u.model`;
    for (const r of agg) {
      const cached = Number(r.cached);
      const cw = Number(r.cw);
      const t: Tokens = {
        input: Math.max(0, Number(r.input) - cached - cw),
        output: Number(r.output),
        cache_write: cw,
        cache_read: cached,
      };
      const p = price(normalizeModel(r.model));
      const key = String(r.chat_id);
      costByChat.set(
        key,
        (costByChat.get(key) ?? 0) +
          costOf(p, t) +
          cacheWrite1hExtra(p, Number(r.cw1h)),
      );
    }
    const chatIds = [...new Set(leads.map((l) => l.chatId).filter((c) => c))];

    const [users, personas, accounts] = await Promise.all([
      this.prisma.dashboardUser.findMany({
        select: { id: true, username: true },
      }),
      this.prisma.persona.findMany({ select: { slug: true, name: true } }),
      this.prisma.channelAccount.findMany({
        select: {
          id: true,
          username: true,
          displayName: true,
          login: true,
          channel: true,
          status: true,
        },
      }),
    ]);
    const userName = new Map(users.map((u) => [String(u.id), u.username]));
    const personaName = new Map(personas.map((p) => [p.slug, p.name]));
    const accountOf = new Map(accounts.map((a) => [a.id, a]));
    const accountName = (id: number) => {
      const a = accountOf.get(id);
      return a
        ? a.username
          ? `@${a.username}`
          : a.displayName || a.login
        : `#${id}`;
    };
    const sourceLabel = (key: string) =>
      key.startsWith('donor:')
        ? key.slice(6)
        : key === 'manual'
          ? 'вручную'
          : key === 'import'
            ? 'импорт'
            : key;

    const funnel = zeroFunnel();
    for (const l of leads) addLead(funnel, l);
    const cost = chatIds.reduce((sum, c) => sum + (costByChat.get(c!) ?? 0), 0);

    // Аккаунты за период: сколько написали, в скольких чатах клиент ответил.
    const accountTalk = await this.prisma.$queryRaw<
      {
        account_id: number;
        out: bigint;
        in: bigint;
        chats: bigint;
        replied_chats: bigint;
      }[]
    >`
      SELECT c.account_id,
             COUNT(*) FILTER (WHERE m.role = 'assistant') AS out,
             COUNT(*) FILTER (WHERE m.role = 'user') AS in,
             COUNT(DISTINCT m.chat_id) FILTER (WHERE m.role = 'assistant') AS chats,
             COUNT(DISTINCT m.chat_id) FILTER (WHERE m.role = 'user' AND EXISTS (
               SELECT 1 FROM messages a WHERE a.chat_id = m.chat_id AND a.role = 'assistant'
                 AND a.deleted_at IS NULL AND a.ts >= ${range.start} AND a.ts < ${range.end})) AS replied_chats
      FROM messages m JOIN contacts c ON c.chat_id = m.chat_id
      WHERE m.ts >= ${range.start} AND m.ts < ${range.end} AND m.deleted_at IS NULL
        AND m.role IN ('user', 'assistant') AND c.account_id IS NOT NULL
      GROUP BY c.account_id`;
    const talk = new Map(accountTalk.map((r) => [Number(r.account_id), r]));
    const byAccountFunnel = new Map(
      sliceBy(
        leads.filter((l) => l.account !== null),
        (l) => String(l.account),
        (k) => k,
        costByChat,
      ).map((r) => [Number(r.key), r]),
    );
    const accountRows = accounts
      .map((a) => {
        const t = talk.get(a.id);
        const f = byAccountFunnel.get(a.id);
        const chats = Number(t?.chats ?? 0);
        const repliedChats = Number(t?.replied_chats ?? 0);
        return {
          id: a.id,
          label: accountName(a.id),
          channel: a.channel,
          status: a.status,
          messages_out: Number(t?.out ?? 0),
          messages_in: Number(t?.in ?? 0),
          chats,
          replied_chats: repliedChats,
          reply_rate: chats
            ? Math.round((repliedChats / chats) * 1000) / 1000
            : null,
          leads_written: f?.written ?? 0,
          leads_replied: f?.replied ?? 0,
          deposits: f?.deposit ?? 0,
        };
      })
      .filter(
        (a) =>
          a.messages_out ||
          a.messages_in ||
          a.leads_written ||
          a.status === 'banned' ||
          a.status === 'unauthorized',
      )
      .sort((a, b) => b.messages_out - a.messages_out || a.id - b.id);

    // Когда пишут клиенты: сообщения клиентов по дню недели и часу (Москва).
    const cells = await this.prisma.$queryRaw<
      { dow: number; hour: number; n: bigint }[]
    >`
      SELECT EXTRACT(DOW FROM to_timestamp(ts) AT TIME ZONE 'Europe/Moscow')::int AS dow,
             EXTRACT(HOUR FROM to_timestamp(ts) AT TIME ZONE 'Europe/Moscow')::int AS hour,
             COUNT(*) AS n
      FROM messages
      WHERE role = 'user' AND deleted_at IS NULL AND ts >= ${range.start} AND ts < ${range.end}
      GROUP BY 1, 2`;

    // Скорость: от сообщения клиента до нашего ответа (бот / менеджер) и от
    // первого нашего сообщения лиду до его первого ответа.
    const replies = await this.prisma.$queryRaw<
      { who: string; median: number; p90: number; n: bigint }[]
    >`
      WITH m AS (
        SELECT chat_id, role, author, ts, id,
               LAG(role) OVER w AS prev_role
        FROM messages
        WHERE ts >= ${range.start} AND ts < ${range.end} AND deleted_at IS NULL
          AND role IN ('user', 'assistant') AND text NOT LIKE '[Реакция%'
        WINDOW w AS (PARTITION BY chat_id ORDER BY ts, id)
      ),
      -- Серия подряд идущих сообщений одной стороны; ждём от её первого сообщения.
      runs AS (
        SELECT chat_id, role, author, ts,
               SUM(CASE WHEN prev_role IS DISTINCT FROM role THEN 1 ELSE 0 END)
                 OVER (PARTITION BY chat_id ORDER BY ts, id) AS run
        FROM m
      ),
      starts AS (
        SELECT chat_id, role, run, MIN(ts) AS first_ts, MIN(author) AS author
        FROM runs GROUP BY chat_id, role, run
      ),
      pairs AS (
        SELECT s.author, s.first_ts - LAG(s.first_ts) OVER (PARTITION BY s.chat_id ORDER BY s.run) AS wait,
               LAG(s.role) OVER (PARTITION BY s.chat_id ORDER BY s.run) AS prev_role, s.role
        FROM starts s
      )
      SELECT CASE WHEN author = 'operator:voice' THEN 'voice'
                  WHEN author LIKE 'operator:%' THEN 'manager' ELSE 'bot' END AS who,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY wait) AS median,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY wait) AS p90,
             COUNT(*) AS n
      FROM pairs
      WHERE role = 'assistant' AND prev_role = 'user'
      GROUP BY 1`;
    const [firstReply] = await this.prisma.$queryRaw<
      { median: number | null; p90: number | null; n: bigint }[]
    >`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY d) AS median,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY d) AS p90,
             COUNT(d) AS n
      FROM (
        SELECT (SELECT MIN(m.ts) FROM messages m WHERE m.chat_id = l.chat_id AND m.role = 'user'
                  AND m.deleted_at IS NULL AND m.ts >= l.first_contact_at) - l.first_contact_at AS d
        FROM leads l
        WHERE l.first_contact_at >= ${range.start} AND l.first_contact_at < ${range.end} AND l.chat_id IS NOT NULL
      ) x WHERE d IS NOT NULL`;

    return {
      range: { from: range.from, to: range.to },
      steps: FUNNEL_STEPS,
      funnel,
      cost: {
        total_usd: Math.round(cost * 1e4) / 1e4,
        per_step: costPerStep(funnel, cost),
      },
      by: {
        persona: sliceBy(
          leads,
          (l) => l.persona ?? '—',
          (k) => personaName.get(k) ?? (k === '—' ? 'без личности' : k),
          costByChat,
        ),
        manager: sliceBy(
          leads,
          (l) => (l.owner === null ? '—' : String(l.owner)),
          (k) => userName.get(k) ?? 'без менеджера',
          costByChat,
        ),
        source: sliceBy(leads, (l) => l.source, sourceLabel, costByChat),
        type: sliceBy(
          leads,
          (l) => (l.cold ? 'cold' : 'hot'),
          (k) => (k === 'cold' ? 'Холодка' : 'Хот'),
          costByChat,
        ),
        account: sliceBy(
          leads,
          (l) => (l.account === null ? '—' : String(l.account)),
          (k) => (k === '—' ? 'не назначен' : accountName(Number(k))),
          costByChat,
        ),
      },
      accounts: accountRows,
      heatmap: heatmap(
        cells.map((c) => ({ dow: c.dow, hour: c.hour, n: Number(c.n) })),
      ),
      speed: {
        bot: speedOf(replies.find((r) => r.who === 'bot')),
        manager: speedOf(replies.find((r) => r.who === 'manager')),
        first_reply: speedOf(firstReply),
      },
    };
  }

  async dealStages(query: { from?: string; to?: string }) {
    const range = resolveRange(query, this.clock.ts());
    const moves = await stageMovesInRange(this.prisma, range.start, range.end);
    const byDay = new Map<string, Record<string, number>>(
      range.days.map((d) => [d, zeroStages()]),
    );
    const totals = zeroStages();
    for (const m of moves) {
      const row = byDay.get(m.day);
      if (!row) continue;
      row[m.stage] += 1;
      totals[m.stage] += 1;
    }
    // Та же выборка, что у плиток дашборда: одна запись кеша на обоих.
    const reached = countStagesReached(
      await this.memo.get('stages-ever', 30_000, () =>
        chatStagesEver(this.prisma),
      ),
    );
    return {
      range: { from: range.from, to: range.to },
      stages: DEAL_STAGES.map((id) => ({ id, label: DEAL_STAGE_LABELS[id] })),
      days: range.days
        .map((day) => ({ day, counts: byDay.get(day)! }))
        .filter((d) => Object.values(d.counts).some((n) => n > 0)),
      totals,
      reached,
    };
  }

  // Прайс читается на каждом запросе статистики, а меняется из панели редко:
  // держим в памяти, сбрасываем при записи. Один процесс бэкенда — этого хватает.
  private pricesCache: PriceTable | null = null;

  async prices(): Promise<PriceTable> {
    if (this.pricesCache) return this.pricesCache;
    const row = await this.prisma.setting.findUnique({
      where: { key: PRICES_KEY },
    });
    if (!row)
      return (this.pricesCache = { ...DEFAULT_PRICES, is_default: true });
    try {
      return (this.pricesCache = {
        ...parseTable(JSON.parse(row.value), DEFAULT_PRICES.families),
        is_default: false,
      });
    } catch (e) {
      this.log.warn(
        `таблица цен в настройках не читается (${(e as Error).message}) — работаю по умолчаниям`,
      );
      return (this.pricesCache = { ...DEFAULT_PRICES, is_default: true });
    }
  }

  async putPrices(raw: unknown): Promise<PriceTable> {
    let table: PriceTable;
    try {
      table = parseTable(raw, (await this.prices()).families);
    } catch (e) {
      throw new UnprocessableEntityException((e as Error).message);
    }
    const now = this.clock.ts();
    const value = JSON.stringify(table);
    await this.prisma.setting.upsert({
      where: { key: PRICES_KEY },
      create: { key: PRICES_KEY, value, updatedAt: now },
      update: { value, updatedAt: now },
    });
    this.pricesCache = null;
    return { ...table, is_default: false };
  }

  async resetPrices(): Promise<PriceTable> {
    await this.prisma.setting.deleteMany({ where: { key: PRICES_KEY } });
    this.pricesCache = null;
    return { ...DEFAULT_PRICES, is_default: true };
  }

  async overview(query: { from?: string; to?: string }) {
    const range: DayRange = resolveRange(query, this.clock.ts());
    const table = await this.prices();
    const price = memoPrice(table);

    const rows = (await this.prisma.modelUsage.findMany({
      where: { createdAt: { gte: range.start, lt: range.end } },
      select: {
        chatId: true,
        personaId: true,
        model: true,
        stage: true,
        inputTokens: true,
        outputTokens: true,
        cachedTokens: true,
        cacheWriteTokens: true,
        cacheWrite1hTokens: true,
        elapsedMs: true,
        createdAt: true,
        provider: true,
        providerEstimatedCostUsd: true,
      },
    })) as (UsageRow & {
      provider: string;
      providerEstimatedCostUsd: number | null;
    })[];

    const total = bucket();
    const byDay = new Map<string, Bucket>(range.days.map((d) => [d, bucket()]));
    const byModel = new Map<string, Bucket>();
    const byStage = new Map<string, Bucket>();
    const byPersona = new Map<string, Bucket>();
    const byChat = new Map<string, Bucket>();
    const unpriced = new Set<string>();
    // Факт: сколько выставил OpenRouter. Шлюз (LLMR) бесплатный — его вызовы
    // считаем по прайсу отдельно: столько они стоили бы в OpenRouter.
    let paid = 0;
    let llmCalls = 0;
    const gateway = bucket();

    for (const u of rows) {
      u.model = normalizeModel(u.model);
      const p = price(u.model);
      if (!p) unpriced.add(u.model);
      add(total, u, p);
      if (u.provider === 'openrouter') paid += u.providerEstimatedCostUsd ?? 0;
      if (u.provider === GATEWAY_ROUTE) add(gateway, u, p);
      if (u.provider === 'openrouter' || u.provider === GATEWAY_ROUTE)
        llmCalls += 1;
      const day = byDay.get(dayKey(u.createdAt));
      if (day) add(day, u, p);
      for (const [map, key] of [
        [byModel, u.model],
        [byStage, u.stage],
        [byPersona, u.personaId ?? '—'],
      ] as [Map<string, Bucket>, string][]) {
        if (!map.has(key)) map.set(key, bucket());
        add(map.get(key)!, u, p);
      }
      if (u.chatId !== null) {
        const key = String(u.chatId);
        if (!byChat.has(key)) byChat.set(key, bucket());
        add(byChat.get(key)!, u, p);
      }
    }

    const messages = await this.messages(range);
    const cacheable =
      total.tokens.input + total.tokens.cache_read + total.tokens.cache_write;

    return {
      range: {
        from: range.from,
        to: range.to,
        days: range.days,
        first_day: await this.firstDay(),
      },
      prices: {
        currency: table.currency,
        is_default: Boolean(table.is_default),
        note: table.note,
      },
      totals: {
        ...view(total),
        cache_hit_rate: cacheable
          ? Math.round((total.tokens.cache_read / cacheable) * 1000) / 1000
          : 0,
        chats: byChat.size,
        ...messages.totals,
        /** Фактически заплачено OpenRouter за период. */
        paid_usd: usd(paid),
        /** Шлюз LLMR: сколько стоили бы его вызовы в OpenRouter — сэкономлено. */
        gateway_saved_usd: usd(gateway.cost),
        gateway_calls: gateway.calls,
        gateway_share: llmCalls
          ? Math.round((gateway.calls / llmCalls) * 1000) / 1000
          : 0,
      },
      by_day: range.days.map((day) => ({
        day,
        ...view(byDay.get(day)!),
        messages_in: messages.byDay.get(day)?.in ?? 0,
        messages_out: messages.byDay.get(day)?.out ?? 0,
      })),
      by_model: [...byModel.entries()]
        .map(([model, b]) => ({
          model,
          priced: Boolean(price(model)),
          ...view(b),
        }))
        .sort((a, b) => b.cost_usd - a.cost_usd || b.calls - a.calls),
      by_stage: [...byStage.entries()]
        .map(([stage, b]) => ({ stage, ...view(b) }))
        .sort((a, b) => b.cost_usd - a.cost_usd || b.calls - a.calls),
      by_persona: [...byPersona.entries()]
        .map(([persona_id, b]) => ({ persona_id, ...view(b) }))
        .sort((a, b) => b.cost_usd - a.cost_usd),
      top_chats: [...byChat.entries()]
        .map(([chat, b]) => ({ chat_id: Number(chat), ...view(b) }))
        .sort((a, b) => b.cost_usd - a.cost_usd || b.calls - a.calls)
        .slice(0, TOP_CHATS),
      unpriced_models: [...unpriced].sort(),
    };
  }

  private async firstDay(): Promise<string | null> {
    const row = await this.prisma.modelUsage.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return row ? dayKey(row.createdAt) : null;
  }

  async byManager({ from, to }: { from?: string; to?: string }) {
    const range = resolveRange({ from, to }, this.clock.ts());
    const table = await this.prices();
    const price = memoPrice(table);
    const owners = await this.chatOwners();
    const rows = (await this.prisma.modelUsage.findMany({
      where: { createdAt: { gte: range.start, lt: range.end } },
      select: {
        chatId: true,
        personaId: true,
        model: true,
        stage: true,
        inputTokens: true,
        outputTokens: true,
        cachedTokens: true,
        cacheWriteTokens: true,
        cacheWrite1hTokens: true,
        elapsedMs: true,
        createdAt: true,
      },
    })) as UsageRow[];

    const spend = new Map<string, Bucket>();
    const spendDays = new Map<string, Map<string, Bucket>>();
    const chats = new Map<string, Set<string>>();
    for (const u of rows) {
      u.model = normalizeModel(u.model);
      const p = price(u.model);
      const manager = owners.manager(u.chatId);
      if (!spend.has(manager)) spend.set(manager, bucket());
      add(spend.get(manager)!, u, p);
      if (!spendDays.has(manager)) spendDays.set(manager, new Map());
      const days = spendDays.get(manager)!;
      const key = dayKey(u.createdAt);
      if (!days.has(key)) days.set(key, bucket());
      add(days.get(key)!, u, p);
      if (u.chatId !== null) {
        if (!chats.has(manager)) chats.set(manager, new Set());
        chats.get(manager)!.add(String(u.chatId));
      }
    }

    const messages = await this.messages(range, owners);
    const leads = await this.leadFunnel(range);
    const stages = await this.stageMoves(range, owners);
    const ids = new Set([
      ...spend.keys(),
      ...messages.byManager.keys(),
      ...leads.keys(),
      ...stages.keys(),
    ]);
    const aggOf = (id: string): ManagerAgg => ({
      spend: spend.get(id) ?? bucket(),
      spendDays: spendDays.get(id) ?? new Map(),
      chats: chats.get(id) ?? new Set(),
      talk: messages.byManager.get(id) ?? emptyAgg().talk,
      leads: leads.get(id) ?? emptyAgg().leads,
      stages: stages.get(id) ?? emptyAgg().stages,
    });
    const order = (
      a: { cost_usd: number; messages_out: number },
      b: { cost_usd: number; messages_out: number },
    ) => b.cost_usd - a.cost_usd || b.messages_out - a.messages_out;

    // Команды: тимлид или хед со всеми подчинёнными по цепочке lead_id,
    // включая себя. Хед видит и тимлидов, и их менеджеров, и прямых менеджеров.
    const users = await this.prisma.dashboardUser.findMany({
      where: { role: { in: [Role.TEAMLEAD, Role.HEAD] } },
      select: { id: true, username: true, role: true, regionCode: true },
    });
    const links = await this.prisma.dashboardUser.findMany({
      where: { leadId: { not: null } },
      select: { id: true, leadId: true },
    });
    const subordinates = new Map<number, number[]>();
    for (const l of links) {
      if (!subordinates.has(l.leadId!)) subordinates.set(l.leadId!, []);
      subordinates.get(l.leadId!)!.push(l.id);
    }
    const teamOf = (leadId: number): number[] => {
      const seen = new Set<number>([leadId]);
      const queue = [leadId];
      while (queue.length) {
        for (const id of subordinates.get(queue.shift()!) ?? [])
          if (!seen.has(id)) {
            seen.add(id);
            queue.push(id);
          }
      }
      return [...seen];
    };
    const roleRank: Record<string, number> = { head: 0, teamlead: 1 };
    const by_team = users
      .map((u) => {
        const members = teamOf(u.id);
        const agg = emptyAgg();
        for (const id of members) mergeAgg(agg, aggOf(String(id)));
        return {
          manager_id: u.id,
          username: u.username,
          role: u.role,
          region_code: u.regionCode,
          members: members.length - 1,
          ...aggRow(agg, range),
        };
      })
      .sort(
        (a, b) =>
          (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9) ||
          (a.region_code ?? '').localeCompare(b.region_code ?? '') ||
          order(a, b),
      );

    return {
      range: { from: range.from, to: range.to, days: range.days },
      by_manager: [...ids]
        .map((id) => ({
          manager_id: id === NO_MANAGER ? null : Number(id),
          username: owners.titles.get(id) ?? `#${id}`,
          ...aggRow(aggOf(id), range),
        }))
        .sort(order),
      by_team,
    };
  }

  private async leadFunnel(range: DayRange): Promise<Map<string, LeadCounts>> {
    const rows = await this.prisma.lead.findMany({
      where: { insertedAt: { gte: range.start, lt: range.end } },
      select: {
        ownerUserId: true,
        chatId: true,
        status: true,
        insertedAt: true,
      },
    });
    const out = new Map<string, LeadCounts>();
    for (const row of rows) {
      const key =
        row.ownerUserId === null ? NO_MANAGER : String(row.ownerUserId);
      let counts = out.get(key);
      if (!counts)
        out.set(
          key,
          (counts = { uploaded: 0, valid: 0, replied: 0, byDay: new Map() }),
        );
      let day = counts.byDay.get(dayKey(row.insertedAt));
      if (!day)
        counts.byDay.set(
          dayKey(row.insertedAt),
          (day = { uploaded: 0, valid: 0, replied: 0 }),
        );
      counts.uploaded += 1;
      day.uploaded += 1;
      if (row.chatId !== null) {
        counts.valid += 1;
        day.valid += 1;
      }
      if (row.status === 'replied') {
        counts.replied += 1;
        day.replied += 1;
      }
    }
    return out;
  }

  /** Этапы за период по менеджеру чата: итог и по дням, той же логикой, что и общая таблица. */
  private async stageMoves(
    range: DayRange,
    owners: { manager: (chatId: bigint | number | null) => string },
  ): Promise<
    Map<
      string,
      {
        total: Record<string, number>;
        byDay: Map<string, Record<string, number>>;
      }
    >
  > {
    const out = new Map<
      string,
      {
        total: Record<string, number>;
        byDay: Map<string, Record<string, number>>;
      }
    >();
    for (const m of await stageMovesInRange(
      this.prisma,
      range.start,
      range.end,
    )) {
      const manager = owners.manager(m.chatId);
      if (!out.has(manager))
        out.set(manager, { total: zeroStages(), byDay: new Map() });
      const row = out.get(manager)!;
      row.total[m.stage] += 1;
      if (!row.byDay.has(m.day)) row.byDay.set(m.day, zeroStages());
      row.byDay.get(m.day)![m.stage] += 1;
    }
    return out;
  }

  private async chatOwners(): Promise<{
    manager: (chatId: bigint | number | null) => string;
    titles: Map<string, string>;
  }> {
    const [contacts, links, users] = await Promise.all([
      this.prisma.contact.findMany({
        select: { chatId: true, accountId: true },
      }),
      this.prisma.managerAccount.findMany({
        select: { userId: true, accountId: true },
      }),
      this.prisma.dashboardUser.findMany({
        select: { id: true, username: true },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u.username]));
    const managerByAccount = new Map(
      links.map((l) => [l.accountId, String(l.userId)]),
    );
    const accountByChat = new Map(
      contacts.map((c) => [String(c.chatId), c.accountId]),
    );
    const titles = new Map<string, string>([[NO_MANAGER, 'Без менеджера']]);
    for (const [id, username] of userById) titles.set(String(id), username);
    return {
      manager: (chatId) => {
        if (chatId === null || chatId === undefined) return NO_MANAGER;
        const accountId = accountByChat.get(String(chatId));
        if (accountId === null || accountId === undefined) return NO_MANAGER;
        return managerByAccount.get(accountId) ?? NO_MANAGER;
      },
      titles,
    };
  }

  private async messages(
    range: DayRange,
    owners?: { manager: (chatId: bigint | number | null) => string },
  ) {
    const rows = await this.prisma.message.findMany({
      where: { ts: { gte: range.start, lt: range.end } },
      select: { ts: true, role: true, author: true, chatId: true },
    });
    const byDay = new Map<string, { in: number; out: number }>(
      range.days.map((d) => [d, { in: 0, out: 0 }]),
    );
    const byManager = new Map<string, MessageCounts>();
    let msgIn = 0;
    let msgOut = 0;
    let manual = 0;
    for (const m of rows) {
      const key = dayKey(m.ts);
      const day = byDay.get(key);
      const manager = owners
        ? talkOf(byManager, owners.manager(m.chatId))
        : null;
      const managerDay = manager ? talkDay(manager, key) : null;
      if (m.role === 'user') {
        msgIn += 1;
        if (day) day.in += 1;
        if (manager) {
          manager.in += 1;
          manager.chats.add(String(m.chatId));
        }
        if (managerDay) {
          managerDay.in += 1;
          managerDay.chats.add(String(m.chatId));
        }
      } else if (m.role === 'assistant') {
        msgOut += 1;
        if (day) day.out += 1;
        if (manager) manager.out += 1;
        if (managerDay) managerDay.out += 1;
        if (m.author && m.author.startsWith('operator')) {
          manual += 1;
          if (manager) manager.manual += 1;
          if (managerDay) managerDay.manual += 1;
        }
      }
    }
    return {
      byDay,
      byManager,
      totals: {
        messages_in: msgIn,
        messages_out: msgOut,
        manual_share: msgOut ? Math.round((manual / msgOut) * 1000) / 1000 : 0,
      },
    };
  }

  async forChat(chatId: number, days = 30) {
    const to = dayKey(this.clock.ts());
    const range = resolveRange(
      { from: dayKey(this.clock.ts() - (days - 1) * 86400), to },
      this.clock.ts(),
    );
    const table = await this.prices();
    const price = memoPrice(table);
    const rows = (await this.prisma.modelUsage.findMany({
      where: {
        chatId: BigInt(chatId),
        createdAt: { gte: range.start, lt: range.end },
      },
      select: {
        chatId: true,
        personaId: true,
        model: true,
        stage: true,
        inputTokens: true,
        outputTokens: true,
        cachedTokens: true,
        cacheWriteTokens: true,
        cacheWrite1hTokens: true,
        elapsedMs: true,
        createdAt: true,
      },
    })) as UsageRow[];
    const b = bucket();
    for (const u of rows) add(b, u, price(u.model));
    return { chat_id: fromChatId(BigInt(chatId)), days, ...view(b) };
  }
}
