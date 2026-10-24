export function asInt(value: unknown): number {
  if (typeof value === 'number')
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return 0;
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function importance(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(asText(value));
  return Number.isFinite(parsed) ? clamp(Math.trunc(parsed), 1, 5) : 3;
}

export function stringList(
  value: unknown,
  limit: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value.slice(0, limit)) {
    if (typeof item !== 'string') continue;
    const text = item.trim().slice(0, maxLength);
    if (text) result.push(text);
  }
  return result;
}

export function extendUnique(
  target: string[],
  values: unknown,
  maxItemLength: number,
): void {
  if (!Array.isArray(values)) return;
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim().slice(0, maxItemLength);
    if (value && !target.includes(value)) target.push(value);
  }
}

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
