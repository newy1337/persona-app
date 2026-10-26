// Проверка документов личности перед сохранением: то, что бот молча
// проглотит, но поведёт себя не так, как задумано. Сохранять не мешает —
// предупреждения показываются над кнопкой «Сохранить».

const ids = (list) => (Array.isArray(list) ? list.map((x) => x?.id).filter((x) => x !== undefined && x !== null && x !== '') : []);

function duplicates(list) {
  const seen = new Set();
  const out = new Set();
  for (const id of list) {
    if (seen.has(id)) out.add(id);
    seen.add(id);
  }
  return [...out];
}

function goals(doc) {
  const out = [];
  const slotIds = ids(doc.slots);
  for (const d of duplicates(ids(doc.stages))) out.push(`Цели: этап «${d}» встречается дважды`);
  for (const d of duplicates(slotIds)) out.push(`Цели: тема «${d}» встречается дважды`);
  const known = new Set(slotIds);
  for (const stage of Array.isArray(doc.stages) ? doc.stages : []) {
    for (const slot of Array.isArray(stage?.ask_slots) ? stage.ask_slots : []) {
      if (!known.has(slot)) out.push(`Цели: этап «${stage.id ?? '?'}» спрашивает тему «${slot}», а такой темы нет`);
    }
  }
  for (const slot of Array.isArray(doc.slots) ? doc.slots : []) {
    if (slot && !String(slot.topic ?? '').trim()) out.push(`Цели: у темы «${slot.id ?? '?'}» нет названия (topic)`);
  }
  return out;
}

function storylines(doc) {
  const out = [];
  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  for (const d of duplicates(ids(lines))) out.push(`Сюжеты: линия «${d}» встречается дважды`);
  for (const d of duplicates(ids(doc.episodes))) out.push(`Сюжеты: случай «${d}» встречается дважды`);
  for (const line of lines) {
    if (!Array.isArray(line?.beats) || line.beats.length === 0) out.push(`Сюжеты: у линии «${line?.id ?? '?'}» нет шагов — бот её не расскажет`);
    else if (line.beats.some((b) => !String(b ?? '').trim())) out.push(`Сюжеты: у линии «${line.id ?? '?'}» есть пустой шаг`);
  }
  return out;
}

function beats(doc) {
  const out = [];
  const list = Array.isArray(doc) ? doc : [];
  for (const d of duplicates(ids(list))) out.push(`Биты: «${d}» встречается дважды`);
  list.forEach((b, i) => {
    const name = b?.id ?? `№${i + 1}`;
    if (!b?.id) out.push(`Биты: у бита ${name} нет id`);
    if (!String(b?.title ?? '').trim()) out.push(`Биты: у бита «${name}» нет названия`);
    if (b?.day !== undefined && !(Number.isFinite(Number(b.day)) && Number(b.day) >= 0)) out.push(`Биты: у бита «${name}» день не число`);
    if (b?.scope !== undefined && !['measured', 'out_of_scope', 'external_ssot'].includes(b.scope)) out.push(`Биты: у бита «${name}» неизвестный вид «${b.scope}»`);
  });
  return out;
}

const CHECKS = { goals, storylines, beats };

/** Предупреждения для документа раздела; пусто — всё в порядке. */
export function validateSection(section, doc) {
  const check = CHECKS[section];
  if (!check || doc == null || typeof doc !== 'object') return [];
  try {
    return check(doc);
  } catch {
    return [];
  }
}
