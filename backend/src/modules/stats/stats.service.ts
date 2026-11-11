import { GATEWAY_ROUTE } from 'src/brain/llm/gateway';
import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { Role } from 'src/enums/roles.enum';
import { ClockService } from 'src/shared/clock.service';
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
import { goalStats } from './goal-stats';
import { ACTIVE_AFTER, coldFunnel, coldLeadRows } from './cold-funnel';
import { normalizeModel } from './prices';
import {
  costOfSums,
  dialogCost,
  stageCostSummary,
  type ModelTokens,
} from './dialog-cost';
import {
  DEAL_REACHED_KEY as DEAL_REACHED_FACT,
  DEAL_STAGES,
  DEAL_STAGE_LABELS,
} from 'src/domain/deal-stage';
import { LEAD_STATUSES } from 'src/domain/leads';
import {
  TRAFFIC_SOURCES,
  TRAFFIC_SOURCE_FILTERS,
  TRAFFIC_SOURCE_LABELS,
} from 'src/domain/traffic-source';
import {
  stageMovesInRange,
  stagesReachedEver,
  zeroStages,
} from 'src/shared/deal-stage-stats';

const TOP_CHATS = 12;
const NO_MANAGER = '—';
/** Платные посредники: их счёт — факт расходов. */
const PAID_ROUTES = new Set<string | null>(['openrouter', 'nanogpt']);

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
  /** сколько вызов стоил по словам OpenRouter; для моделей без цены в таблице */
  providerEstimatedCostUsd?: number | null;
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

/**
 * Строка-сумма из базы: сколько вызовов в группе и их задержки. Цена линейна
 * по токенам, так что сумма токенов группы даёт ту же цену, что и вызовы по
 * одному.
 */
interface UsageGroup extends UsageRow {
  calls: number;
  latencySum: number;
  latencyN: number;
  provider: string | null;
  manager: string;
}

function add(
  b: Bucket,
  u: UsageRow | UsageGroup,
  price: ModelPrice | null,
): void {
  const t = tokensOf(u);
  const group = 'calls' in u ? u : null;
  b.calls += group ? group.calls : 1;
  addTokens(b.tokens, t);
  // Модели нет в таблице цен (Kimi, GLM через OpenRouter) — берём цену,
  // которую назвал OpenRouter, а не ноль.
  b.cost += price
    ? costOf(price, t) + cacheWrite1hExtra(price, u.cacheWrite1hTokens ?? 0)
    : (u.providerEstimatedCostUsd ?? 0);
  if (group) {
    b.latencySum += group.latencySum;
    b.latencyN += group.latencyN;
  } else if (u.elapsedMs !== null) {
    b.latencySum += u.elapsedMs;
    b.latencyN += 1;
  }
}

/** По чему группировать расход модели в базе. */
type UsageKey = 'day' | 'model' | 'stage' | 'persona' | 'provider' | 'chat';

const USAGE_KEY_SQL: Record<UsageKey | 'manager', string> = {
  day: '((u.created_at + 10800) / 86400)',
  model: 'u.model',
  stage: 'u.stage',
  persona: 'u.persona_id',
  provider: 'u.provider',
  chat: 'u.chat_id',
  manager: 'ma.user_id',
};

/**
 * Расход модели за период, сложенный в базе по нужным полям: в память
 * приходят суммы, а не каждый вызов (за месяц их сотни тысяч). Менеджер —
 * владелец аккаунта, с которого идёт чат, как в chatOwners(). В строке
 * поля, по которым не группировали, пустые.
 */
async function usageGroups(
  prisma: PrismaService,
  range: DayRange,
  keys: Array<UsageKey | 'manager'>,
): Promise<UsageGroup[]> {
  const cols = [...new Set<UsageKey | 'manager'>(['model', ...keys])];
  const select = cols.map((k) => `${USAGE_KEY_SQL[k]} AS k_${k}`).join(', ');
  const group = cols.map((k) => USAGE_KEY_SQL[k]).join(', ');
  const join = cols.includes('manager')
    ? `LEFT JOIN contacts c ON c.chat_id = u.chat_id
       LEFT JOIN manager_accounts ma ON ma.account_id = c.account_id`
    : '';
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT ${Prisma.raw(select)},
        COUNT(*) AS calls,
        SUM(GREATEST(0, COALESCE(u.input_tokens, 0) - COALESCE(u.cached_tokens, 0) - COALESCE(u.cache_write_tokens, 0))) AS input_net,
        SUM(COALESCE(u.output_tokens, 0)) AS output,
        SUM(COALESCE(u.cached_tokens, 0)) AS cache_read,
        SUM(COALESCE(u.cache_write_tokens, 0)) AS cache_write,
        SUM(COALESCE(u.cache_write_1h_tokens, 0)) AS cache_write_1h,
        SUM(COALESCE(u.provider_estimated_cost_usd, 0)) AS estimated,
        SUM(COALESCE(u.elapsed_ms, 0)) AS latency_sum,
        COUNT(u.elapsed_ms) AS latency_n
      FROM model_usage u ${Prisma.raw(join)}
      WHERE u.created_at >= ${range.start} AND u.created_at < ${range.end}
      GROUP BY ${Prisma.raw(group)}`,
  );
  const num = (v: unknown) => Number(v ?? 0);
  return rows.map((r) => {
    const cacheRead = num(r.cache_read);
    const cacheWrite = num(r.cache_write);
    const day = r.k_day;
    return {
      chatId: (r.k_chat as bigint | null | undefined) ?? null,
      personaId: (r.k_persona as string | null | undefined) ?? null,
      model: String(r.k_model),
      stage: (r.k_stage as string | undefined) ?? '',
      provider: (r.k_provider as string | null | undefined) ?? null,
      manager:
        r.k_manager === null || r.k_manager === undefined
          ? NO_MANAGER
          : String(r.k_manager),
      // tokensOf() вычтет кеш обратно — получится сумма «чистого» входа.
      inputTokens: num(r.input_net) + cacheRead + cacheWrite,
      outputTokens: num(r.output),
      cachedTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      cacheWrite1hTokens: num(r.cache_write_1h),
      providerEstimatedCostUsd: num(r.estimated),
      elapsedMs: null,
      createdAt:
        day === null || day === undefined ? 0 : num(day) * 86400 - 10800,
      calls: num(r.calls),
      latencySum: num(r.latency_sum),
      latencyN: num(r.latency_n),
    };
  });
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
  ) {}

  /**
   * Этапы сделки по дням. Этапы воронки: чат засчитывается в этап один раз —
   * в день, когда впервые до него дошёл; пройденные этапы остаются, откат
   * назад ничего не снимает. Архив отдельно: по дням — сколько чатов
   * отправили в архив, «всего» — сколько чатов в архиве сейчас.
   */
  /**
   * Цели по личностям: в какой доле диалогов личности узнана каждая цель.
   * Диалоги — начатые в периоде, где бот уже разговаривал. Считает база:
   * из состояния бота берутся только ключи узнанных целей.
   */
  async goalsByPersona(query: { from?: string; to?: string }) {
    const range = resolveRange(query, this.clock.ts());
    const scope = Prisma.sql`
      SELECT a.persona_id AS persona, b.state_json::jsonb #> '{character}' AS ch
      FROM brain_state b
      JOIN contacts c ON c.chat_id = b.chat_id
      JOIN channel_accounts a ON a.id = c.account_id
      WHERE c.created_at >= ${range.start} AND c.created_at < ${range.end}`;
    const [totals, slots, personas] = await Promise.all([
      this.prisma.$queryRaw<Array<{ persona: string; chats: number }>>(
        Prisma.sql`
          SELECT persona, COUNT(*)::int AS chats FROM (${scope}) d
          WHERE jsonb_typeof(d.ch -> 'turns') = 'number' AND (d.ch ->> 'turns')::numeric > 0
          GROUP BY persona`,
      ),
      this.prisma.$queryRaw<
        Array<{ persona: string; slot: string; chats: number }>
      >(Prisma.sql`
        SELECT d.persona, k AS slot, COUNT(*)::int AS chats FROM (${scope}) d,
          LATERAL jsonb_object_keys(
            CASE WHEN jsonb_typeof(d.ch -> 'slots') = 'object'
              THEN d.ch -> 'slots' ELSE '{}'::jsonb END) k
        WHERE jsonb_typeof(d.ch -> 'turns') = 'number' AND (d.ch ->> 'turns')::numeric > 0
        GROUP BY d.persona, k`),
      this.prisma.persona.findMany({
        select: { slug: true, name: true, goals: true, variables: true },
      }),
    ]);
    const known = new Map<string, Map<string, number>>();
    for (const r of slots) {
      const m = known.get(r.persona) ?? new Map<string, number>();
      m.set(r.slot, r.chats);
      known.set(r.persona, m);
    }
    return {
      range: { from: range.from, to: range.to },
      personas: goalStats(
        personas,
        new Map(totals.map((r) => [r.persona, r.chats])),
        known,
      ),
    };
  }

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
    const reached = await stagesReachedEver(this.prisma);
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

  async prices(): Promise<PriceTable> {
    const row = await this.prisma.setting.findUnique({
      where: { key: PRICES_KEY },
    });
    if (!row) return { ...DEFAULT_PRICES, is_default: true };
    try {
      return {
        ...parseTable(JSON.parse(row.value), DEFAULT_PRICES.families),
        is_default: false,
      };
    } catch (e) {
      this.log.warn(
        `таблица цен в настройках не читается (${(e as Error).message}) — работаю по умолчаниям`,
      );
      return { ...DEFAULT_PRICES, is_default: true };
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
    return { ...table, is_default: false };
  }

  async resetPrices(): Promise<PriceTable> {
    await this.prisma.setting.deleteMany({ where: { key: PRICES_KEY } });
    return { ...DEFAULT_PRICES, is_default: true };
  }

  async overview(query: { from?: string; to?: string }) {
    const range: DayRange = resolveRange(query, this.clock.ts());
    const table = await this.prices();
    const price = memoPrice(table);

    // Суммы из базы: по дню, модели, этапу, личности и маршруту — и отдельно
    // по чату для топа. Каждый вызов за месяц в память не тянем.
    const [rows, chatRows] = await Promise.all([
      usageGroups(this.prisma, range, ['day', 'stage', 'persona', 'provider']),
      usageGroups(this.prisma, range, ['chat']),
    ]);

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
      if (PAID_ROUTES.has(u.provider)) paid += u.providerEstimatedCostUsd ?? 0;
      if (u.provider === GATEWAY_ROUTE) add(gateway, u, p);
      if (PAID_ROUTES.has(u.provider) || u.provider === GATEWAY_ROUTE)
        llmCalls += u.calls;
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
    }
    for (const u of chatRows) {
      if (u.chatId === null) continue;
      u.model = normalizeModel(u.model);
      const key = String(u.chatId);
      if (!byChat.has(key)) byChat.set(key, bucket());
      add(byChat.get(key)!, u, price(u.model));
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
    // Суммы по менеджеру и дню — в базе; чаты менеджера — парами без повторов.
    const [rows, chatPairs] = await Promise.all([
      usageGroups(this.prisma, range, ['manager', 'day']),
      this.usageChats(range),
    ]);

    const spend = new Map<string, Bucket>();
    const spendDays = new Map<string, Map<string, Bucket>>();
    const chats = new Map<string, Set<string>>();
    for (const u of rows) {
      u.model = normalizeModel(u.model);
      const p = price(u.model);
      const manager = u.manager;
      if (!spend.has(manager)) spend.set(manager, bucket());
      add(spend.get(manager)!, u, p);
      if (!spendDays.has(manager)) spendDays.set(manager, new Map());
      const days = spendDays.get(manager)!;
      const key = dayKey(u.createdAt);
      if (!days.has(key)) days.set(key, bucket());
      add(days.get(key)!, u, p);
    }
    for (const { manager, chatId } of chatPairs) {
      if (!chats.has(manager)) chats.set(manager, new Set());
      chats.get(manager)!.add(chatId);
    }

    const messages = await this.messages(range, true);
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

    const { users, teamOf } = await this.teamTree();
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

  /**
   * Лиды за период по источнику трафика: по регионам — сколько добавлено,
   * в каких статусах и до каких этапов сделки дошли. Регион лида — регион
   * его менеджера, без менеджера — регион, в который лид прислали.
   * source: base | hot_leadgen | cold_leadgen | none (без отметки) | все.
   */
  async sources(query: {
    from?: string;
    to?: string;
    source?: string;
    region?: string;
    /** расход модели на диалоги лидов — только админу */
    withCost?: boolean;
  }) {
    const range = resolveRange(query, this.clock.ts());
    const source = (TRAFFIC_SOURCE_FILTERS as readonly string[]).includes(
      query.source ?? '',
    )
      ? query.source
      : null;
    const leads = await this.prisma.lead.findMany({
      where: {
        insertedAt: { gte: range.start, lt: range.end },
        ...(source === 'none'
          ? { trafficSource: null }
          : source
            ? { trafficSource: source }
            : {}),
      },
      select: {
        ownerUserId: true,
        requestedRegion: true,
        status: true,
        chatId: true,
        trafficSource: true,
      },
    });
    const users = await this.prisma.dashboardUser.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              leads.map((l) => l.ownerUserId).filter((id) => id !== null),
            ),
          ],
        },
      },
      select: { id: true, regionCode: true },
    });
    const regionOf = new Map(users.map((u) => [u.id, u.regionCode]));
    const reached = await this.reachedByChat(
      leads.flatMap((l) => (l.chatId ? [l.chatId] : [])),
    );
    const costs = query.withCost
      ? await this.chatCosts(leads.flatMap((l) => (l.chatId ? [l.chatId] : [])))
      : null;
    const blank = () => ({
      leads: 0,
      cost_usd: 0,
      statuses: Object.fromEntries(LEAD_STATUSES.map((st) => [st, 0])),
      stages: zeroStages(),
      by_source: Object.fromEntries(
        TRAFFIC_SOURCE_FILTERS.map((src) => [src, 0]),
      ) as Record<string, number>,
    });
    const regions = new Map<string, ReturnType<typeof blank>>();
    const bySource = new Map<string, ReturnType<typeof blank>>(
      TRAFFIC_SOURCE_FILTERS.map((src) => [src, blank()]),
    );
    const total = blank();
    for (const l of leads) {
      const region =
        (l.ownerUserId !== null ? regionOf.get(l.ownerUserId) : null) ??
        l.requestedRegion ??
        '—';
      if (query.region && region !== query.region) continue;
      if (!regions.has(region)) regions.set(region, blank());
      const own = bySource.get(l.trafficSource ?? 'none') ?? blank();
      for (const row of [regions.get(region)!, own, total]) {
        row.leads += 1;
        if (costs && l.chatId) row.cost_usd += costs.get(String(l.chatId)) ?? 0;
        row.statuses[l.status] = (row.statuses[l.status] ?? 0) + 1;
        row.by_source[l.trafficSource ?? 'none'] += 1;
        for (const st of reached.get(String(l.chatId)) ?? [])
          if (st in row.stages) row.stages[st] += 1;
      }
    }
    // Без флага денег в ответе нет совсем: хед видит те же строки без расхода.
    const money = <T extends { cost_usd: number }>(row: T) => {
      if (!costs) {
        const { cost_usd: _drop, ...rest } = row;
        return rest;
      }
      return { ...row, cost_usd: usd(row.cost_usd) };
    };
    return {
      range: { from: range.from, to: range.to },
      source: source ?? null,
      with_cost: Boolean(costs),
      sources: TRAFFIC_SOURCES.map((id) => ({
        id,
        label: TRAFFIC_SOURCE_LABELS[id],
      })),
      stages: DEAL_STAGES.map((id) => ({ id, label: DEAL_STAGE_LABELS[id] })),
      statuses: [...LEAD_STATUSES],
      total: money(total),
      by_source: [...bySource.entries()]
        .map(([id, row]) => ({
          source: id,
          label:
            TRAFFIC_SOURCE_LABELS[id as keyof typeof TRAFFIC_SOURCE_LABELS] ??
            'Не отмечен',
          ...money({
            leads: row.leads,
            cost_usd: row.cost_usd,
            statuses: row.statuses,
            stages: row.stages,
          }),
        }))
        .filter((r) => r.leads > 0),
      regions: [...regions.entries()]
        .map(([region, row]) => ({ region, ...money(row) }))
        .sort((a, b) => b.leads - a.leads || a.region.localeCompare(b.region)),
    };
  }

  /** Расход модели на каждый чат за всё время: id чата → доллары. */
  private async chatCosts(chatIds: bigint[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!chatIds.length) return out;
    const price = memoPrice(await this.prices());
    const rows = await this.prisma.$queryRaw<
      Array<{
        chat_id: bigint;
        model: string;
        input: bigint;
        output: bigint;
        cache_write: bigint;
        cache_read: bigint;
        cache_write_1h: bigint;
        estimated: number | null;
      }>
    >(Prisma.sql`
      SELECT chat_id, model,
        SUM(GREATEST(0, COALESCE(input_tokens, 0) - COALESCE(cached_tokens, 0) - COALESCE(cache_write_tokens, 0))) AS input,
        SUM(COALESCE(output_tokens, 0)) AS output,
        SUM(COALESCE(cache_write_tokens, 0)) AS cache_write,
        SUM(COALESCE(cached_tokens, 0)) AS cache_read,
        SUM(COALESCE(cache_write_1h_tokens, 0)) AS cache_write_1h,
        SUM(COALESCE(provider_estimated_cost_usd, 0)) AS estimated
      FROM model_usage
      WHERE chat_id = ANY(${[...new Set(chatIds)]}::bigint[])
      GROUP BY chat_id, model`);
    for (const r of rows) {
      const key = String(r.chat_id);
      out.set(
        key,
        (out.get(key) ?? 0) +
          costOfSums(
            [
              {
                model: r.model,
                input: Number(r.input),
                output: Number(r.output),
                cache_write: Number(r.cache_write),
                cache_read: Number(r.cache_read),
                cache_write_1h: Number(r.cache_write_1h),
                estimated: Number(r.estimated ?? 0),
              },
            ],
            price,
          ),
      );
    }
    return out;
  }

  /** До каких этапов дошёл каждый чат (deal_reached) и архив — по текущему этапу. */
  private async reachedByChat(chatIds: bigint[]) {
    const out = new Map<string, string[]>();
    for (let i = 0; i < chatIds.length; i += 5000) {
      const rows = await this.prisma.leadFacts.findMany({
        where: { chatId: { in: chatIds.slice(i, i + 5000) } },
        select: { chatId: true, facts: true },
      });
      for (const r of rows) {
        if (!r.facts.includes('"deal_')) continue;
        try {
          const f = JSON.parse(r.facts) as Record<string, unknown>;
          const got = Object.keys(
            (f[DEAL_REACHED_FACT] as Record<string, unknown>) ?? {},
          );
          if (f['deal_stage'] === 'archive') got.push('archive');
          out.set(String(r.chatId), got);
        } catch {
          continue;
        }
      }
    }
    return out;
  }

  /**
   * Команды: тимлид или хед со всеми подчинёнными по цепочке lead_id,
   * включая себя. Хед видит и тимлидов, и их менеджеров, и прямых менеджеров.
   */
  private async teamTree() {
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
    return { users, teamOf };
  }

  /**
   * Аккаунты за период: сколько каждый менеджер и команда добавили номеров
   * Telegram и VK, сколько из них слетело (бан, сессия) и сколько диалогов
   * было на слетевших. region — только сотрудники этого региона (хед).
   */
  async accounts(query: { from?: string; to?: string; region?: string }) {
    const range = resolveRange(query, this.clock.ts());
    const events = await this.prisma.accountEvent.findMany({
      where: { ts: { gte: range.start, lt: range.end } },
      select: { kind: true, channel: true, managerId: true, chats: true },
    });
    const blank = () => ({
      tg_added: 0,
      vk_added: 0,
      tg_lost: 0,
      vk_lost: 0,
      lost_chats: 0,
    });
    type Row = ReturnType<typeof blank>;
    const add = (row: Row, e: (typeof events)[number]) => {
      const ch = e.channel === 'vk' ? 'vk' : 'tg';
      if (e.kind === 'added') row[`${ch}_added`] += 1;
      if (e.kind === 'lost') {
        row[`${ch}_lost`] += 1;
        row.lost_chats += e.chats;
      }
    };
    const byManager = new Map<number | null, Row>();
    for (const e of events) {
      if (!byManager.has(e.managerId)) byManager.set(e.managerId, blank());
      add(byManager.get(e.managerId)!, e);
    }
    const people = await this.prisma.dashboardUser.findMany({
      select: { id: true, username: true, role: true, regionCode: true },
    });
    const person = new Map(people.map((u) => [u.id, u]));
    const inRegion = (id: number | null) =>
      !query.region ||
      (id !== null && person.get(id)?.regionCode === query.region);

    const managers = [...byManager.entries()]
      .filter(([id]) => inRegion(id))
      .map(([id, row]) => ({
        manager_id: id,
        username:
          id === null
            ? 'Без менеджера'
            : (person.get(id)?.username ?? `#${id}`),
        region_code: id === null ? null : (person.get(id)?.regionCode ?? null),
        ...row,
      }))
      .sort(
        (a, b) =>
          b.tg_added + b.vk_added - (a.tg_added + a.vk_added) ||
          b.tg_lost + b.vk_lost - (a.tg_lost + a.vk_lost),
      );
    const { users, teamOf } = await this.teamTree();
    const teams = users
      .filter((u) => !query.region || u.regionCode === query.region)
      .map((u) => {
        const row = blank();
        const members = teamOf(u.id);
        for (const id of members) {
          const m = byManager.get(id);
          if (!m) continue;
          for (const k of Object.keys(row) as (keyof Row)[]) row[k] += m[k];
        }
        return {
          manager_id: u.id,
          username: u.username,
          role: u.role,
          region_code: u.regionCode,
          members: members.length - 1,
          ...row,
        };
      })
      .sort(
        (a, b) =>
          (a.role === 'head' ? 0 : 1) - (b.role === 'head' ? 0 : 1) ||
          (a.region_code ?? '').localeCompare(b.region_code ?? '') ||
          a.username.localeCompare(b.username),
      );
    const total = blank();
    for (const m of managers)
      for (const k of Object.keys(total) as (keyof Row)[]) total[k] += m[k];
    return {
      range: { from: range.from, to: range.to },
      total,
      managers,
      teams,
    };
  }

  /** Регионы, где есть сотрудники, — выбор региона админу. */
  async regions(): Promise<string[]> {
    const rows = await this.prisma.dashboardUser.findMany({
      where: { regionCode: { not: null } },
      select: { regionCode: true },
      distinct: ['regionCode'],
      orderBy: { regionCode: 'asc' },
    });
    return rows.map((r) => r.regionCode!).filter(Boolean);
  }

  /**
   * Статистика региона для хеда: те же расчёты, что у админа, только по
   * сотрудникам региона. Расход по менеджерам и итог, номера, этапы,
   * холодка и разбивка по типу трафика личности (холодка / hot).
   */
  async region(query: { from?: string; to?: string; region: string }) {
    const range = resolveRange(query, this.clock.ts());
    const members = await this.prisma.dashboardUser.findMany({
      where: { regionCode: query.region },
      select: { id: true },
    });
    const ids = new Set(members.map((m) => m.id));
    const mine = (id: number | null) => id !== null && ids.has(id);

    const all = await this.byManager(query);
    const managers = all.by_manager.filter((r) => mine(r.manager_id));
    const total = {
      cost_usd: usd(managers.reduce((n, r) => n + r.cost_usd, 0)),
      calls: managers.reduce((n, r) => n + r.calls, 0),
      leads_uploaded: managers.reduce((n, r) => n + r.leads_uploaded, 0),
      leads_valid: managers.reduce((n, r) => n + r.leads_valid, 0),
      leads_replied: managers.reduce((n, r) => n + r.leads_replied, 0),
      active_chats: managers.reduce((n, r) => n + r.active_chats, 0),
      messages_in: managers.reduce((n, r) => n + r.messages_in, 0),
      messages_out: managers.reduce((n, r) => n + r.messages_out, 0),
    };

    // Этапы: суммы по менеджерам региона, по дням и за всё время.
    const totals = zeroStages();
    const byDay = new Map<string, Record<string, number>>();
    for (const r of managers) {
      for (const st of DEAL_STAGES) totals[st] += r.stages[st] ?? 0;
      for (const d of r.days) {
        if (!byDay.has(d.day)) byDay.set(d.day, zeroStages());
        for (const st of DEAL_STAGES)
          byDay.get(d.day)![st] += d.stages[st] ?? 0;
      }
    }
    const owners = await this.chatOwners();
    const regionChats = new Set(
      (await this.prisma.contact.findMany({ select: { chatId: true } }))
        .map((c) => c.chatId)
        .filter((c) => mine(Number(owners.manager(c)) || null))
        .map(String),
    );
    const stages = {
      range: { from: range.from, to: range.to },
      stages: DEAL_STAGES.map((id) => ({ id, label: DEAL_STAGE_LABELS[id] })),
      days: range.days
        .filter((d) => byDay.has(d))
        .map((day) => ({ day, counts: byDay.get(day)! }))
        .filter((d) => Object.values(d.counts).some((n) => n > 0)),
      totals,
      reached: await stagesReachedEver(this.prisma, regionChats),
    };

    const coldAll = await this.coldLeads(query);
    const coldRows = coldAll.by_manager.filter((r) => mine(r.user_id));
    const sum = (
      k: 'received' | 'written' | 'invalid' | 'replied' | 'active',
    ) => coldRows.reduce((n, r) => n + (r[k] ?? 0), 0);
    const cold = {
      range: coldAll.range,
      active_after: coldAll.active_after,
      totals: {
        received: sum('received'),
        written: sum('written'),
        invalid: sum('invalid'),
        replied: sum('replied'),
        active: sum('active'),
      },
      by_manager: coldRows,
    };

    return {
      range: all.range,
      region: query.region,
      managers,
      total,
      stages,
      cold,
      traffic: await this.trafficSplit(range, mine),
      sources: await this.sources({ ...query, region: query.region }),
      accounts: await this.accounts(query),
    };
  }

  /** Номера и расход региона по типу трафика личности: холодка, hot, не указан. */
  private async trafficSplit(
    range: DayRange,
    mine: (id: number | null) => boolean,
  ) {
    const personas = await this.prisma.persona.findMany({
      select: { slug: true, trafficType: true },
    });
    const typeOf = (slug: string | null) =>
      personas.find((p) => p.slug === slug)?.trafficType ?? 'none';
    const out = new Map<
      string,
      { leads_uploaded: number; leads_replied: number; cost: Bucket }
    >(
      ['cold', 'hot', 'none'].map((t) => [
        t,
        { leads_uploaded: 0, leads_replied: 0, cost: bucket() },
      ]),
    );
    const leads = await this.prisma.lead.findMany({
      where: { insertedAt: { gte: range.start, lt: range.end } },
      select: { ownerUserId: true, personaId: true, status: true },
    });
    for (const l of leads) {
      if (!mine(l.ownerUserId)) continue;
      const row = out.get(typeOf(l.personaId))!;
      row.leads_uploaded += 1;
      if (l.status === 'replied') row.leads_replied += 1;
    }
    const price = memoPrice(await this.prices());
    const usage = await usageGroups(this.prisma, range, ['manager', 'persona']);
    for (const u of usage) {
      if (!mine(Number(u.manager) || null)) continue;
      u.model = normalizeModel(u.model);
      add(out.get(typeOf(u.personaId))!.cost, u, price(u.model));
    }
    const LABEL: Record<string, string> = {
      cold: 'Холодка',
      hot: 'Hot',
      none: 'Тип не указан',
    };
    return [...out.entries()].map(([type, r]) => ({
      type,
      label: LABEL[type],
      leads_uploaded: r.leads_uploaded,
      leads_replied: r.leads_replied,
      cost_usd: view(r.cost).cost_usd,
    }));
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

  /** Какие чаты у какого менеджера тратили модель за период — пары без повторов. */
  private async usageChats(
    range: DayRange,
  ): Promise<Array<{ manager: string; chatId: string }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ manager: number | null; chat_id: bigint }>
    >(Prisma.sql`
      SELECT DISTINCT ma.user_id AS manager, u.chat_id
      FROM model_usage u
      LEFT JOIN contacts c ON c.chat_id = u.chat_id
      LEFT JOIN manager_accounts ma ON ma.account_id = c.account_id
      WHERE u.created_at >= ${range.start} AND u.created_at < ${range.end}
        AND u.chat_id IS NOT NULL`);
    return rows.map((r) => ({
      manager: r.manager === null ? NO_MANAGER : String(r.manager),
      chatId: String(r.chat_id),
    }));
  }

  /**
   * Сообщения за период: входящие, исходящие, ручные. Считает база — по дню,
   * а с byManager ещё по менеджеру чата и самому чату (активные чаты —
   * те, где писал собеседник). Миллион сообщений за месяц в память не тянем.
   */
  private async messages(range: DayRange, byManagerToo = false) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        day: number;
        manager: number | null;
        chat_id: bigint | null;
        msg_in: bigint;
        msg_out: bigint;
        manual: bigint;
      }>
    >(
      byManagerToo
        ? Prisma.sql`
          SELECT ((m.ts + 10800) / 86400) AS day, ma.user_id AS manager, m.chat_id,
            COUNT(*) FILTER (WHERE m.role = 'user') AS msg_in,
            COUNT(*) FILTER (WHERE m.role = 'assistant') AS msg_out,
            COUNT(*) FILTER (WHERE m.role = 'assistant' AND m.author LIKE 'operator%') AS manual
          FROM messages m
          LEFT JOIN contacts c ON c.chat_id = m.chat_id
          LEFT JOIN manager_accounts ma ON ma.account_id = c.account_id
          WHERE m.ts >= ${range.start} AND m.ts < ${range.end}
          GROUP BY 1, 2, 3`
        : Prisma.sql`
          SELECT ((m.ts + 10800) / 86400) AS day, NULL::int AS manager, NULL::bigint AS chat_id,
            COUNT(*) FILTER (WHERE m.role = 'user') AS msg_in,
            COUNT(*) FILTER (WHERE m.role = 'assistant') AS msg_out,
            COUNT(*) FILTER (WHERE m.role = 'assistant' AND m.author LIKE 'operator%') AS manual
          FROM messages m
          WHERE m.ts >= ${range.start} AND m.ts < ${range.end}
          GROUP BY 1`,
    );
    const byDay = new Map<string, { in: number; out: number }>(
      range.days.map((d) => [d, { in: 0, out: 0 }]),
    );
    const byManager = new Map<string, MessageCounts>();
    let msgIn = 0;
    let msgOut = 0;
    let manual = 0;
    for (const r of rows) {
      const key = dayKey(Number(r.day) * 86400 - 10800);
      const n = {
        in: Number(r.msg_in),
        out: Number(r.msg_out),
        manual: Number(r.manual),
      };
      msgIn += n.in;
      msgOut += n.out;
      manual += n.manual;
      const day = byDay.get(key);
      if (day) {
        day.in += n.in;
        day.out += n.out;
      }
      if (!byManagerToo) continue;
      const manager = talkOf(
        byManager,
        r.manager === null ? NO_MANAGER : String(r.manager),
      );
      const managerDay = talkDay(manager, key);
      manager.in += n.in;
      manager.out += n.out;
      manager.manual += n.manual;
      managerDay.in += n.in;
      managerDay.out += n.out;
      managerDay.manual += n.manual;
      if (n.in > 0 && r.chat_id !== null) {
        manager.chats.add(String(r.chat_id));
        managerDay.chats.add(String(r.chat_id));
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
        providerEstimatedCostUsd: true,
      },
    })) as UsageRow[];
    const b = bucket();
    for (const u of rows) add(b, u, price(u.model));
    return { chat_id: fromChatId(BigInt(chatId)), days, ...view(b) };
  }

  /** Сколько стоит диалог сейчас и сколько стоил на каждом этапе сделки. */
  async chatCost(chatId: number) {
    const price = memoPrice(await this.prices());
    const [rows, facts] = await Promise.all([
      this.prisma.modelUsage.findMany({
        where: { chatId: BigInt(chatId) },
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
          providerEstimatedCostUsd: true,
        },
      }) as Promise<UsageRow[]>,
      this.prisma.leadFacts.findUnique({
        where: { chatId: BigInt(chatId) },
        select: { facts: true },
      }),
    ]);
    let reached: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(facts?.facts || '{}');
      reached = parsed?.[DEAL_REACHED_FACT] ?? {};
    } catch {
      reached = {};
    }
    const calls = rows.map((u) => {
      const b = bucket();
      add(b, u, price(u.model));
      return { at: u.createdAt, cost: b.cost };
    });
    return {
      chat_id: fromChatId(BigInt(chatId)),
      since: rows.length ? Math.min(...rows.map((r) => r.createdAt)) : null,
      ...dialogCost(calls, reached),
    };
  }

  /**
   * Средняя цена диалога к этапу: по чатам, дошедшим до этапа в периоде,
   * расход модели от начала диалога до момента, когда этап поставили.
   */
  async stageCosts(query: { from?: string; to?: string }) {
    const range = resolveRange(query, this.clock.ts());
    const price = memoPrice(await this.prices());
    const rows = await this.prisma.$queryRaw<
      Array<{
        chat_id: bigint;
        stage: string;
        model: string | null;
        input: bigint | null;
        output: bigint | null;
        cache_write: bigint | null;
        cache_read: bigint | null;
        cache_write_1h: bigint | null;
        estimated: number | null;
      }>
    >(Prisma.sql`
      WITH reached AS (
        SELECT p.chat_id, s.key AS stage, s.value::bigint AS ts
        FROM pinned_facts p,
          LATERAL jsonb_each_text(
            CASE WHEN left(ltrim(p.facts), 1) = '{'
              THEN COALESCE(p.facts::jsonb -> ${DEAL_REACHED_FACT}, '{}'::jsonb)
              ELSE '{}'::jsonb END
          ) s
        WHERE p.facts LIKE ${'%' + DEAL_REACHED_FACT + '%'}
          AND s.value ~ '^[0-9]+$'
      )
      SELECT r.chat_id, r.stage, u.model,
        SUM(GREATEST(0, COALESCE(u.input_tokens, 0) - COALESCE(u.cached_tokens, 0) - COALESCE(u.cache_write_tokens, 0))) AS input,
        SUM(COALESCE(u.output_tokens, 0)) AS output,
        SUM(COALESCE(u.cache_write_tokens, 0)) AS cache_write,
        SUM(COALESCE(u.cached_tokens, 0)) AS cache_read,
        SUM(COALESCE(u.cache_write_1h_tokens, 0)) AS cache_write_1h,
        SUM(COALESCE(u.provider_estimated_cost_usd, 0)) AS estimated
      FROM reached r
      LEFT JOIN model_usage u ON u.chat_id = r.chat_id AND u.created_at <= r.ts
      WHERE r.ts >= ${range.start} AND r.ts < ${range.end}
      GROUP BY r.chat_id, r.stage, u.model`);
    const perChat = new Map<string, { stage: string; tokens: ModelTokens[] }>();
    for (const r of rows) {
      const key = `${r.chat_id}:${r.stage}`;
      if (!perChat.has(key)) perChat.set(key, { stage: r.stage, tokens: [] });
      if (r.model)
        perChat.get(key)!.tokens.push({
          model: r.model,
          input: Number(r.input ?? 0),
          output: Number(r.output ?? 0),
          cache_write: Number(r.cache_write ?? 0),
          cache_read: Number(r.cache_read ?? 0),
          cache_write_1h: Number(r.cache_write_1h ?? 0),
          estimated: Number(r.estimated ?? 0),
        });
    }
    return {
      range: { from: range.from, to: range.to },
      stages: stageCostSummary(
        [...perChat.values()].map((c) => ({
          stage: c.stage,
          cost: costOfSums(c.tokens, price),
        })),
      ),
    };
  }
}
