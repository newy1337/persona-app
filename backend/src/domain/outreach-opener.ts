import { fillText } from 'src/brain/nastya/config/variables';

/** Запасное название сайта: незаполненный {site} ушёл бы собеседнику
 *  фигурными скобками прямо в первом сообщении. */
export const SITE_FALLBACK = 'сайта знакомств';

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
