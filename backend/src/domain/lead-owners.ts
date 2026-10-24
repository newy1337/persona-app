/**
 * Чьи лиды аккаунт вправе писать. Лид владельца-менеджера идёт с аккаунта,
 * закреплённого за ним. Аккаунты закрепляются только за менеджерами, а лид
 * может достаться тимлиду или хеду (например, по раздаче входящих), поэтому
 * лиды руководителей уходят с аккаунтов их подчинённых: владелец подходит,
 * если это менеджер аккаунта или кто-то выше него по цепочке руководителей.
 */
export function allowedOwners(
  linkedUserIds: number[],
  users: Array<{ id: number; leadId: number | null }>,
): Set<number> {
  const leadOf = new Map(users.map((u) => [u.id, u.leadId]));
  const allowed = new Set<number>();
  for (const start of linkedUserIds) {
    let id: number | null | undefined = start;
    // Защита от цикла в данных: идём вверх, пока встречаем новых.
    while (id != null && !allowed.has(id)) {
      allowed.add(id);
      id = leadOf.get(id);
    }
  }
  return allowed;
}
