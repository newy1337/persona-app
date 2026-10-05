import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
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
import { normalizeModel } from './prices';
import {
  DEAL_REACHED_EVENT,
  DEAL_STAGES,
  DEAL_STAGE_EVENT,
  DEAL_STAGE_LABELS,
} from 'src/domain/deal-stage';

const zeroStages = (): Record<string, number> =>
  Object.fromEntries(DEAL_STAGES.map((s) => [s, 0]));

const TOP_CHATS = 12;
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
  async dealStages(query: { from?: string; to?: string }) {
    const range = resolveRange(query, this.clock.ts());
    const moves = await this.stageEvents(range);
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
    const reached = zeroStages();
    const rows = await this.prisma.$queryRaw<{ stage: string; n: bigint }[]>`
      SELECT k.stage, COUNT(*) AS n
      FROM pinned_facts p, jsonb_object_keys(COALESCE(p.facts::jsonb->'deal_reached', '{}'::jsonb)) AS k(stage)
      GROUP BY 1`;
    for (const r of rows)
      if (r.stage in reached) reached[r.stage] = Number(r.n);
    const archived = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM pinned_facts WHERE facts::jsonb->>'deal_stage' = 'archive'`;
    reached.archive = Number(archived[0]?.n ?? 0);
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

  /**
   * События за период в виде (день, этап, чат): воронка — по первому
   * достижению этапа, архив — по отправке в архив, не чаще раза в день на чат.
   */
  private async stageEvents(
    range: DayRange,
  ): Promise<{ day: string; stage: string; chatId: bigint }[]> {
    const events = await this.prisma.funnelEvent.findMany({
      where: {
        eventType: { in: [DEAL_REACHED_EVENT, DEAL_STAGE_EVENT] },
        chatId: { not: null },
        ts: { gte: range.start, lt: range.end },
      },
      select: { chatId: true, eventType: true, eventMeta: true, ts: true },
      orderBy: { ts: 'asc' },
    });
    const out: { day: string; stage: string; chatId: bigint }[] = [];
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
      if (!stage || !(DEAL_STAGES as readonly string[]).includes(stage))
        continue;
      const day = dayKey(e.ts);
      const key = `${stage}:${String(e.chatId)}:${stage === 'archive' ? day : ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ day, stage, chatId: e.chatId! });
    }
    return out;
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

    const total = bucket();
    const byDay = new Map<string, Bucket>(range.days.map((d) => [d, bucket()]));
    const byModel = new Map<string, Bucket>();
    const byStage = new Map<string, Bucket>();
    const byPersona = new Map<string, Bucket>();
    const byChat = new Map<string, Bucket>();
    const unpriced = new Set<string>();

    for (const u of rows) {
      u.model = normalizeModel(u.model);
      const p = price(u.model);
      if (!p) unpriced.add(u.model);
      add(total, u, p);
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
    return {
      range: { from: range.from, to: range.to, days: range.days },
      by_manager: [...ids]
        .map((id) => {
          const talk = messages.byManager.get(id);
          const days = spendDays.get(id) ?? new Map<string, Bucket>();
          return {
            manager_id: id === NO_MANAGER ? null : Number(id),
            username: owners.titles.get(id) ?? `#${id}`,
            ...view(spend.get(id) ?? bucket()),
            chats: chats.get(id)?.size ?? 0,
            messages_in: talk?.in ?? 0,
            messages_out: talk?.out ?? 0,
            manual_share: talk?.out
              ? Math.round((talk.manual / talk.out) * 1000) / 1000
              : 0,
            leads_uploaded: leads.get(id)?.uploaded ?? 0,
            leads_valid: leads.get(id)?.valid ?? 0,
            leads_replied: leads.get(id)?.replied ?? 0,
            active_chats: talk?.chats.size ?? 0,
            stages: stages.get(id)?.total ?? zeroStages(),
            days: range.days
              .map((day) => {
                const talkDay = talk?.byDay.get(day);
                const leadDay = leads.get(id)?.byDay.get(day);
                const stageDay = stages.get(id)?.byDay.get(day);
                return {
                  day,
                  stages: stageDay ?? zeroStages(),
                  ...view(days.get(day) ?? bucket()),
                  messages_in: talkDay?.in ?? 0,
                  messages_out: talkDay?.out ?? 0,
                  manual_share: talkDay?.out
                    ? Math.round((talkDay.manual / talkDay.out) * 1000) / 1000
                    : 0,
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
        })
        .sort(
          (a, b) => b.cost_usd - a.cost_usd || b.messages_out - a.messages_out,
        ),
    };
  }

  private async leadFunnel(range: DayRange): Promise<Map<string, LeadCounts>> {
    const rows = await this.prisma.phoneNumber.findMany({
      where: { insertedAt: { gte: range.start, lt: range.end } },
      select: {
        ownerUserId: true,
        telegramUserId: true,
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
      if (row.telegramUserId !== null) {
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
    for (const m of await this.stageEvents(range)) {
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
        select: { userId: true, tgAccountId: true },
      }),
      this.prisma.dashboardUser.findMany({
        select: { id: true, username: true },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u.username]));
    const managerByAccount = new Map(
      links.map((l) => [l.tgAccountId, String(l.userId)]),
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
