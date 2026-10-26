/**
 * Срезы статистики «про результат», а не про расход на модели: воронка
 * лидов, разрезы по личности / менеджеру / источнику / аккаунту / типу,
 * стоимость результата, тепловая карта активности клиентов и скорость ответов.
 *
 * Когорта — лиды, которым впервые написали в выбранный период
 * (first_contact_at). Дальше по каждому: ответил ли (есть сообщение клиента
 * после нашего первого) и до каких этапов сделки дошёл за всё время
 * (deal_reached в карточке чата). Так у когорты конверсия честная: шаг
 * засчитан, даже если случился уже после периода.
 */

export const FUNNEL_STEPS = [
  { id: 'written', label: 'Написали' },
  { id: 'replied', label: 'Ответили' },
  { id: 'soglas', label: 'Соглас' },
  { id: 'lead', label: 'Лид' },
  { id: 'deposit', label: 'Депозит' },
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number]['id'];
export type FunnelCounts = Record<FunnelStep, number>;

/** Порядок этапов сделки: дошёл до позднего — значит прошёл и ранние. */
const DEAL_ORDER = ['vbros', 'predloga', 'soglas', 'lead', 'deposit'];

export interface CohortLead {
  persona: string | null;
  owner: number | null;
  source: string;
  account: number | null;
  cold: boolean;
  chatId: string | null;
  replied: boolean;
  /** этапы сделки, которых чат лида достиг (ключи deal_reached) */
  reached: readonly string[];
}

export const zeroFunnel = (): FunnelCounts => ({
  written: 0,
  replied: 0,
  soglas: 0,
  lead: 0,
  deposit: 0,
});

/** Самый поздний этап из достигнутых и все до него. */
export function reachedSteps(reached: readonly string[]): Set<string> {
  const top = Math.max(-1, ...reached.map((s) => DEAL_ORDER.indexOf(s)));
  return new Set(DEAL_ORDER.slice(0, top + 1));
}

export function addLead(into: FunnelCounts, lead: CohortLead): void {
  into.written += 1;
  const steps = reachedSteps(lead.reached);
  // Этап сделки без ответа клиента невозможен — такой чат считаем ответившим.
  if (lead.replied || steps.size > 0) into.replied += 1;
  if (steps.has('soglas')) into.soglas += 1;
  if (steps.has('lead')) into.lead += 1;
  if (steps.has('deposit')) into.deposit += 1;
}

export interface SliceRow extends FunnelCounts {
  key: string;
  label: string;
  cost_usd: number;
}

/**
 * Разрез когорты: строки по ключу, в каждой — воронка и деньги на модели по
 * чатам этих лидов. Сортировка — по числу написанных, затем по ключу.
 */
export function sliceBy(
  leads: readonly CohortLead[],
  keyOf: (l: CohortLead) => string,
  labelOf: (key: string) => string,
  costByChat: ReadonlyMap<string, number>,
): SliceRow[] {
  const rows = new Map<string, SliceRow>();
  // Несколько лидов одного чата — деньги чата считаются в строке один раз.
  const counted = new Map<string, Set<string>>();
  for (const l of leads) {
    const key = keyOf(l);
    let row = rows.get(key);
    if (!row) {
      row = { key, label: labelOf(key), cost_usd: 0, ...zeroFunnel() };
      rows.set(key, row);
      counted.set(key, new Set());
    }
    addLead(row, l);
    if (l.chatId && !counted.get(key)!.has(l.chatId)) {
      counted.get(key)!.add(l.chatId);
      row.cost_usd += costByChat.get(l.chatId) ?? 0;
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, cost_usd: round(r.cost_usd) }))
    .sort((a, b) => b.written - a.written || a.key.localeCompare(b.key));
}

/** Сколько стоит один результат: деньги на модели / число лидов на шаге. */
export function costPerStep(
  funnel: FunnelCounts,
  cost: number,
): Record<FunnelStep, number | null> {
  const out = {} as Record<FunnelStep, number | null>;
  for (const s of FUNNEL_STEPS)
    out[s.id] = funnel[s.id] > 0 ? round(cost / funnel[s.id]) : null;
  return out;
}

/**
 * Тепловая карта: строки — дни недели с понедельника, колонки — часы 0–23
 * по Москве. На входе — dow как в Postgres (0 = воскресенье).
 */
export function heatmap(
  cells: readonly { dow: number; hour: number; n: number }[],
): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const c of cells) {
    const row = (Number(c.dow) + 6) % 7;
    const hour = Number(c.hour);
    if (row >= 0 && row < 7 && hour >= 0 && hour < 24)
      grid[row][hour] += Number(c.n);
  }
  return grid;
}

export interface SpeedStat {
  median_s: number | null;
  p90_s: number | null;
  n: number;
}

export const speedOf = (
  row: { median: unknown; p90: unknown; n: unknown } | undefined,
): SpeedStat => ({
  median_s: row?.median == null ? null : Math.round(Number(row.median)),
  p90_s: row?.p90 == null ? null : Math.round(Number(row.p90)),
  n: Number(row?.n ?? 0),
});

const round = (x: number) => Math.round(x * 1e4) / 1e4;
