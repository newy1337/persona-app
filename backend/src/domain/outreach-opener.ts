import { fillText } from 'src/brain/config/variables';

/** Запасное название сайта: незаполненный {site} ушёл бы собеседнику
 *  фигурными скобками прямо в первом сообщении. */
export const SITE_FALLBACK = 'сайта знакомств';

/**
 * Пул первых сообщений: варианты в одном тексте, разделитель — строка «---».
 * Пустые варианты не считаются; без разделителя — один вариант, как раньше.
 */
export function openerVariants(prompt: string): string[] {
  return prompt
    .split(/^[ \t]*---[ \t]*$/m)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Случайный вариант из пула: каждому лиду — свой. */
export function pickOpener(
  prompt: string,
  random: () => number = Math.random,
): string {
  const variants = openerVariants(prompt);
  if (!variants.length) return prompt.trim();
  return variants[
    Math.min(variants.length - 1, Math.floor(random() * variants.length))
  ];
}

/** Первое сообщение лиду: имя личности и сайт подставляются здесь. */
export const openerText = (
  prompt: string,
  variables: Record<string, string>,
  site: string,
): string => fillText(prompt, { ...variables, site: site || SITE_FALLBACK });

export const datingSiteOf = (personaCard: Record<string, any>): string =>
  String(personaCard?.dating_site ?? 'beboo');

export function leadSlots(
  lead: {
    firstName?: string | null;
    city?: string | null;
    age?: number | null;
  },
  datingSite = 'beboo',
): Record<string, string> {
  return {
    dating_site: datingSite,
    ...(lead.firstName ? { name: lead.firstName } : {}),
    ...(lead.age ? { age: String(lead.age) } : {}),
    ...(lead.city ? { location: lead.city } : {}),
  };
}
