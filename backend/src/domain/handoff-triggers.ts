/**
 * Стоп-фразы: клиент написал одну из них — бот замолкает, чат уходит менеджеру.
 * Список хранится в настройках панели и правится оттуда же.
 */
export const MAX_TRIGGERS = 200;
export const MAX_TRIGGER_LENGTH = 200;

/** Регистр, ё/е и лишние пробелы не должны мешать совпадению. */
export function normalizeTriggerText(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Чистый список: без пустых, без дублей, в исходном написании. */
export function normalizeTriggers(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const text = String(item ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TRIGGER_LENGTH);
    const key = normalizeTriggerText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_TRIGGERS) break;
  }
  return out;
}

/** Первая стоп-фраза, которая встречается в тексте; null — ни одной. */
export function matchTrigger(
  text: string,
  triggers: readonly string[],
): string | null {
  const haystack = normalizeTriggerText(text);
  if (!haystack) return null;
  for (const trigger of triggers) {
    const needle = normalizeTriggerText(trigger);
    if (needle && haystack.includes(needle)) return trigger;
  }
  return null;
}
