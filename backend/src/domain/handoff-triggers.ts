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

/** Раскладка ЙЦУКЕН: соседние клавиши — частая опечатка. */
const KEYBOARD_ROWS = ['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю'];
const NEIGHBOURS: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  const at = (r: number, c: number) => KEYBOARD_ROWS[r]?.[c];
  KEYBOARD_ROWS.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      // ряды сдвинуты на полклавиши: сверху — c и c+1, снизу — c-1 и c
      const near = [
        at(r, c - 1),
        at(r, c + 1),
        at(r - 1, c),
        at(r - 1, c + 1),
        at(r + 1, c - 1),
        at(r + 1, c),
      ].filter((x): x is string => Boolean(x));
      map.set(ch, new Set(near));
    }),
  );
  return map;
})();
/** Гласные путают между собой («мынеджер», «апиратор», «живои»). */
const VOWELS = new Set([...'аеиоуыэюяй']);

/** Похожие буквы: соседние на клавиатуре, обе гласные или ь/ъ. */
export function confusable(a: string, b: string): boolean {
  if (a === b) return true;
  if (VOWELS.has(a) && VOWELS.has(b)) return true;
  if ((a === 'ь' && b === 'ъ') || (a === 'ъ' && b === 'ь')) return true;
  return NEIGHBOURS.get(a)?.has(b) ?? false;
}

/**
 * Число опечаток между словами, если это правдоподобные опечатки: замена
 * похожей буквы, перестановка соседних и не больше maxIndels пропущенных или
 * лишних букв. Замена непохожей буквы — уже другое слово («позволить» и
 * «позвонить»), её не прощаем, в том числе как пропуск плюс вставку.
 * Больше limit — значит «не подходит» (вернётся limit + 1).
 */
export function typoDistance(
  a: string,
  b: string,
  limit: number,
  maxIndels = 1,
): number {
  if (a === b) return 0;
  const fail = limit + 1;
  if (Math.abs(a.length - b.length) > maxIndels) return fail;
  const n = a.length;
  const m = b.length;
  // d[k][i][j] — правок на префиксах a[0..i), b[0..j) при k пропусках/вставках
  const d = [0, 1].map(() =>
    Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(fail)),
  );
  d[0][0][0] = 0;
  const relax = (k: number, i: number, j: number, v: number) => {
    if (v < d[k][i][j]) d[k][i][j] = v;
  };
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++)
      for (let k = 0; k <= 1; k++) {
        const cur = d[k][i][j];
        if (cur >= fail) continue;
        if (i < n && j < m && confusable(a[i], b[j]))
          relax(k, i + 1, j + 1, cur + (a[i] === b[j] ? 0 : 1));
        if (
          i + 1 < n &&
          j + 1 < m &&
          a[i] !== a[i + 1] &&
          a[i] === b[j + 1] &&
          a[i + 1] === b[j]
        )
          relax(k, i + 2, j + 2, cur + 1);
        if (k < maxIndels) {
          if (i < n) relax(1, i + 1, j, cur + 1);
          if (j < m) relax(1, i, j + 1, cur + 1);
        }
      }
  const best = Math.min(d[0][n][m], d[1][n][m]);
  return best > limit ? fail : best;
}

/**
 * Глагольный хвост после основы: необязательный суффикс «-ива-» (созван|ива|емся),
 * гласная основы и окончание, плюс «-ся/-сь»: позвон|ить, позвон|ю, позвон|ите,
 * созвон|ился, созван|ива|ли|сь.
 */
const VERB_ENDING =
  /^(ива|ыва|ва)?[аеиоуыэюя]?(ть|ти|ю|у|ешь|ет|ем|ете|ют|ут|ишь|ит|им|ите|ят|ат|л|ла|ло|ли|й|йте|те|в|вши)?(ся|сь)?$/;
/** Окончания имени (и уменьшительное «-к-», «-ш-»: менеджер|ка, менеджер|ша). */
const NOUN_ENDING =
  /^(к|ш)?(ами|ями|ого|его|ому|ему|ыми|ими|ой|ей|ий|ый|ая|яя|ое|ее|ые|ие|ую|юю|ом|ем|ам|ям|ах|ях|ов|ев|а|я|о|е|и|ы|у|ю|ь|й)?$/;
const NOUN_SUFFIXES = [
  'ами',
  'ями',
  'ого',
  'его',
  'ому',
  'ему',
  'ыми',
  'ими',
  'ой',
  'ей',
  'ий',
  'ый',
  'ая',
  'яя',
  'ое',
  'ее',
  'ые',
  'ие',
  'ую',
  'юю',
  'ом',
  'ем',
  'ам',
  'ям',
  'ах',
  'ях',
  'ов',
  'ев',
  'а',
  'я',
  'о',
  'е',
  'и',
  'ы',
  'у',
  'ю',
  'ь',
  'й',
];

/** Основа слова фразы и какие окончания к ней подходят. */
export function stemOf(word: string): {
  stem: string;
  endings: (rest: string) => boolean;
} {
  // Фраза-глагол: к основе — только глагольные формы. Уменьшительное «-ка»
  // тут было бы другим словом: «позвон|ка» — не «позвон|ить».
  const verb = /^(.+?)[аеиоуыэюя]?(ть|ти|чь)(ся|сь)?$/.exec(word);
  if (verb && verb[1].length >= 3)
    return { stem: verb[1], endings: (rest) => VERB_ENDING.test(rest) };
  // Фраза-имя («созвон», «менеджер»): падежи, «-ка/-ша» и глагол того же
  // корня — созвон|иться, созвон|имся, созван|ива|емся.
  const suffix = NOUN_SUFFIXES.find(
    (x) => word.endsWith(x) && word.length - x.length >= 3,
  );
  return {
    stem: suffix ? word.slice(0, -suffix.length) : word,
    endings: (rest) => NOUN_ENDING.test(rest) || VERB_ENDING.test(rest),
  };
}

/**
 * Слово клиента подходит под слово фразы, если совпадает целиком, отличается
 * правдоподобными опечатками (см. typoDistance, сколько — allowedTypos) или
 * это то же слово с другим окончанием: «позвоните» для «позвонить»,
 * «менеджерка» для «менеджер». Другое слово с тем же началом — нет:
 * «позвоночник» и «позволить» не подходят под «позвонить». Короткие слова —
 * только точно, иначе «бот» цеплял бы «боты», а «опера» — «оператора».
 */
export function wordMatches(candidate: string, word: string): boolean {
  if (candidate === word) return true;
  const typos = allowedTypos(word);
  if (typos === 0) return false;
  if (typoDistance(candidate, word, typos) <= typos) return true;
  const { stem, endings } = stemOf(word);
  const stemTypos = allowedTypos(stem);
  for (
    let cut = Math.max(1, candidate.length - 9);
    cut <= candidate.length;
    cut++
  ) {
    if (!endings(candidate.slice(cut))) continue;
    // У основы прощаем только замены похожих букв и перестановки: лишняя
    // буква перед окончанием — уже другое слово («позвон|ка» — не «позвон|ить»).
    const head = candidate.slice(0, cut);
    if (head === stem || typoDistance(head, stem, stemTypos, 0) <= stemTypos)
      return true;
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
