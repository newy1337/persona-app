import { dayStamp, slugPart } from './files';
import { PROMPTS_FILE_KIND } from './promptsFile';

export const PERSONA_FILE_KIND = 'nastya.persona';

export function personaFileName(persona, now = new Date()) {
  return `persona-${slugPart(persona?.slug)}-${dayStamp(now)}.json`;
}

const HEADER_KEYS = new Set(['kind', 'version', 'persona', 'exported_at']);

function sectionLooksRight(name, value) {
  if (name === 'beats') return value === null || Array.isArray(value);
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readPersonaFile(text, sectionKeys) {
  let doc;
  try {
    doc = JSON.parse(String(text));
  } catch (e) {
    throw new Error(`файл не разбирается как JSON: ${e.message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('в файле должен быть объект с секциями личности');
  }
  if (doc.kind === PROMPTS_FILE_KIND) {
    throw new Error('это файл промптов — его загружают на вкладке «Промпты»');
  }
  if (doc.kind && doc.kind !== PERSONA_FILE_KIND) {
    throw new Error(`это файл «${doc.kind}», а не личность`);
  }
  const body = doc.sections && typeof doc.sections === 'object' && !Array.isArray(doc.sections) ? doc.sections : doc;

  const known = new Set(sectionKeys);
  const sections = {};
  const skipped = [];
  for (const [name, value] of Object.entries(body)) {
    if (body === doc && HEADER_KEYS.has(name)) continue;
    if (!known.has(name)) skipped.push(name);
    else if (!sectionLooksRight(name, value)) {
      throw new Error(name === 'beats' ? 'секция «beats» — массив' : `секция «${name}» — объект`);
    } else sections[name] = value;
  }
  if (!Object.keys(sections).length) {
    throw new Error('в файле нет ни одной знакомой секции личности');
  }
  return {
    sections,
    skipped,
    from: doc.persona?.name || doc.persona?.slug || null,
    exported_at: doc.exported_at ?? null,
  };
}
