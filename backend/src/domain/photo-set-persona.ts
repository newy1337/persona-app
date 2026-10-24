export interface PersonaChoice {
  slug: string;
  name: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');

/** Имя образа начинается с имени (или slug) личности: «Надя — осень» → Надя. */
function nameMatches(setName: string, persona: PersonaChoice): boolean {
  const set = norm(setName);
  return [persona.name, persona.slug].some((raw) => {
    const key = norm(raw);
    if (!key || !set.startsWith(key)) return false;
    const next = set.charAt(key.length);
    return next === '' || !/[\p{L}\p{N}]/u.test(next);
  });
}

/**
 * Личность, к которой сразу привязать выданный образ. Свободные — личности
 * аккаунтов сотрудника, у которых ещё нет образа. Одна такая — она. Иначе —
 * та, чьё имя стоит в начале имени образа, если она одна. Неоднозначно — null:
 * образ уходит в запас, и личность выбирает сам сотрудник.
 */
export function autoPersonaFor(
  setName: string,
  personas: readonly PersonaChoice[],
  taken: ReadonlySet<string>,
): string | null {
  const free = personas.filter((p) => !taken.has(p.slug));
  if (!free.length) return null;
  if (personas.length === 1) return free[0].slug;
  const named = free.filter((p) => nameMatches(setName, p));
  return named.length === 1 ? named[0].slug : null;
}

/** Привязать пачку новых образов по очереди: занятая личность второй раз не выдаётся. */
export function autoPersonas(
  sets: ReadonlyArray<{ id: number; name: string }>,
  personas: readonly PersonaChoice[],
  taken: Iterable<string>,
): Map<number, string | null> {
  const busy = new Set(taken);
  const out = new Map<number, string | null>();
  for (const set of sets) {
    const slug = autoPersonaFor(set.name, personas, busy);
    if (slug) busy.add(slug);
    out.set(set.id, slug);
  }
  return out;
}
