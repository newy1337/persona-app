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
