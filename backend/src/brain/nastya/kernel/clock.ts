const dates = new Map<string, Intl.DateTimeFormat>();
const clocks = new Map<string, Intl.DateTimeFormat>();

/** ISO calendar day (YYYY-MM-DD) of `at` in the character's timezone. */
export function characterDate(at: Date = new Date(), timeZone = 'UTC'): string {
  if (!dates.has(timeZone))
    dates.set(
      timeZone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    );
  return dates.get(timeZone)!.format(at);
}

/** Wall-clock [hour, minute] of `at` in the character's timezone. */
export function characterClock(
  at: Date = new Date(),
  timeZone = 'UTC',
): [number, number] {
  if (!clocks.has(timeZone))
    clocks.set(
      timeZone,
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    );
  const [hour, minute] = clocks.get(timeZone)!.format(at).split(':');
  return [Number(hour), Number(minute)];
}

/** Whole days between two ISO calendar days; negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

/** ISO calendar day `days` after `date` (negative shifts backwards). */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** True when `value` is a well-formed ISO calendar day. */
export function isIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

/** Parses an ISO calendar day, or returns "" when the value is not one. */
export function parseDate(value: unknown): string {
  return isIsoDate(value) ? value : '';
}
