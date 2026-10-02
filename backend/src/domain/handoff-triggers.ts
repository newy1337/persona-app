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

const WORD = /[\p{L}\p{N}]+/gu;

export function triggerWords(text: string): string[] {
  return normalizeTriggerText(text).match(WORD) ?? [];
}

/** Сколько опечаток прощаем слову из фразы: коротким — ни одной. */
export function allowedTypos(word: string): number {
  if (word.length < 5) return 0;
  if (word.length < 7) return 1;
  return 2;
}

/** Расстояние Левенштейна с ранним выходом, когда предел уже превышен. */
export function editDistance(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Слово клиента подходит под слово фразы, если совпадает целиком, с опечатками
 * в пределах allowedTypos, или начинается с него (другое окончание:
 * «менеджерка» для «менеджер»), тоже с опечатками. Короткие слова — только
 * точно, иначе «опера» цепляла бы «оператора».
 */
export function wordMatches(candidate: string, word: string): boolean {
  if (candidate === word) return true;
  const typos = allowedTypos(word);
  if (typos === 0) return false;
  if (editDistance(candidate, word, typos) <= typos) return true;
  if (candidate.length > word.length) {
    const head = candidate.slice(0, word.length);
    return editDistance(head, word, typos) <= typos;
  }
  return false;
}

/** Фраза найдена, если её слова идут подряд среди слов сообщения. */
export function phraseMatches(
  words: readonly string[],
  phrase: readonly string[],
): boolean {
  if (!phrase.length || phrase.length > words.length) return false;
  for (let start = 0; start + phrase.length <= words.length; start++) {
    let ok = true;
    for (let k = 0; k < phrase.length; k++) {
      if (!wordMatches(words[start + k], phrase[k])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Первая стоп-фраза, которая встречается в тексте; null — ни одной.
 * Сравнение по словам: слова фразы должны идти в сообщении подряд, каждое —
 * точно, с опечатками в пределах allowedTypos или с другим окончанием.
 * Голой подстроки нет намеренно: иначе «бот» находился бы внутри «работа».
 */
export function matchTrigger(
  text: string,
  triggers: readonly string[],
): string | null {
  const words = triggerWords(text);
  if (!words.length) return null;
  for (const trigger of triggers) {
    const phrase = triggerWords(trigger);
    if (phrase.length && phraseMatches(words, phrase)) return trigger;
  }
  return null;
}
