export const NAME_RX = /^[\p{L}_][\p{L}\p{N}_]{0,39}$/u;
const PLACEHOLDER_RX = /\{([\p{L}_][\p{L}\p{N}_]{0,39})\}/gu;

export const SECTION_LABELS = {
  prompts: 'Промпты',
  rhythm: 'Ритм',
  persona: 'Карточка',
  goals: 'Цели',
  storylines: 'Сюжеты',
  dayConfig: 'День',
  beats: 'Биты',
};

export function rowsFromDoc(doc) {
  const d = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  return Object.keys(d)
    .filter((key) => !key.startsWith('_'))
    .map((key) => ({ key, value: String(d[key] ?? ''), note: typeof d[`_${key}`] === 'string' ? d[`_${key}`] : '' }));
}

export function docFromRows(rows) {
  const doc = {};
  for (const row of rows) {
    const key = String(row.key ?? '').trim();
    if (!key) continue;
    doc[key] = String(row.value ?? '');
    if (String(row.note ?? '').trim()) doc[`_${key}`] = String(row.note).trim();
  }
  return doc;
}

export function rowErrors(rows, builtins = {}) {
  const seen = new Map();
  return rows.map((row) => {
    const key = String(row.key ?? '').trim();
    if (!key) return String(row.value ?? '').trim() ? 'нужно имя' : null;
    if (!NAME_RX.test(key)) return 'буквы, цифры и «_», не с цифры';
    if (key in builtins) return `встроенная: ${builtins[key]}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count > 1 ? 'такое имя уже есть' : null;
  });
}

export function usages(sections) {
  const out = new Map();
  const walk = (node, section) => {
    if (typeof node === 'string') {
      for (const m of node.matchAll(PLACEHOLDER_RX)) {
        if (!out.has(m[1])) out.set(m[1], new Set());
        out.get(m[1]).add(section);
      }
    } else if (Array.isArray(node)) node.forEach((x) => walk(x, section));
    else if (node && typeof node === 'object') Object.values(node).forEach((x) => walk(x, section));
  };
  for (const [section, doc] of Object.entries(sections || {})) {
    if (section === 'variables') continue;
    walk(doc, section);
  }
  return out;
}
