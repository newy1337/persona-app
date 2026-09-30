import { dayStamp, slugPart } from './files';

export const PROMPTS_FILE_KIND = 'nastya.prompts';
export const PROMPTS_FILE_VERSION = 1;

export function promptsFileName(persona, now = new Date()) {
  return `prompts-${slugPart(persona?.slug)}-${dayStamp(now)}.json`;
}

export function buildPromptsFile(persona, prompts, keys, now = new Date()) {
  const texts = {};
  for (const key of keys) texts[key] = String(prompts?.[key] ?? '');
  return {
    kind: PROMPTS_FILE_KIND,
    version: PROMPTS_FILE_VERSION,
    persona: { slug: persona?.slug ?? null, name: persona?.name ?? null },
    exported_at: now.toISOString(),
    prompts: texts,
  };
}

export function readPromptsFile(text, keys) {
  let doc;
  try {
    doc = JSON.parse(String(text));
  } catch (e) {
    throw new Error(`файл не разбирается как JSON: ${e.message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('в файле должен быть объект с текстами промптов');
  }
  if (doc.kind && doc.kind !== PROMPTS_FILE_KIND) {
    throw new Error(`это файл «${doc.kind}», а не промпты личности`);
  }
  const body = doc.prompts && typeof doc.prompts === 'object' && !Array.isArray(doc.prompts) ? doc.prompts : doc;

  const known = new Set(keys);
  const prompts = {};
  const skipped = [];
  for (const [key, value] of Object.entries(body)) {
    if (key === 'kind' || key === 'version' || key === 'persona' || key === 'exported_at') continue;
    if (!known.has(key)) {
      skipped.push(key);
    } else if (typeof value === 'string') {
      prompts[key] = value;
    } else {
      skipped.push(key);
    }
  }
  if (!Object.keys(prompts).length) {
    throw new Error('в файле нет ни одного знакомого текста промпта');
  }
  return {
    prompts,
    skipped,
    from: doc.persona?.name || doc.persona?.slug || null,
    exported_at: doc.exported_at ?? null,
  };
}
