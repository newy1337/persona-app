import { UnprocessableEntityException } from '@nestjs/common';

const MSK_OFFSET_S = 3 * 3600;
export const DEFAULT_DAYS = 30;

export interface DayRange {
  from: string;
  to: string;
  start: number;
  end: number;
  days: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(ts: number): string {
  const d = new Date((ts + MSK_OFFSET_S) * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function dayStart(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m)
    throw new UnprocessableEntityException(
      `дата «${day}»: нужен формат ГГГГ-ММ-ДД`,
    );
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ts = Date.UTC(y, mo - 1, d) / 1000 - MSK_OFFSET_S;
  if (dayKey(ts) !== day)
    throw new UnprocessableEntityException(`даты «${day}» не существует`);
  return ts;
}

export const addDays = (day: string, n: number): string =>
  dayKey(dayStart(day) + n * 86400);

export function listDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function resolveRange(
  q: { from?: string; to?: string },
  nowTs: number,
): DayRange {
  const today = dayKey(nowTs);
  const to = q.to ?? today;
  dayStart(to);
  const from = q.from ?? addDays(to, -(DEFAULT_DAYS - 1));
  if (from > to) throw new UnprocessableEntityException('«с» позже «по»');
  const days = listDays(from, to);
  if (days.length > 400)
    throw new UnprocessableEntityException('диапазон длиннее 400 дней');
  return { from, to, start: dayStart(from), end: dayStart(to) + 86400, days };
}
