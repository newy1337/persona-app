/**
 * Распределение входящих лидов между менеджерами.
 *
 * Лид принимает сотрудник нужного региона (если регион прислали), который
 * онлайн, не выбрал суточный лимит и принимает источник, донора и личность лида. Пустой список источников или доноров
 * у менеджера значит «любые». Среди подходящих лид уходит тому, кто сегодня
 * получил меньше всех; при равенстве — кто дольше ждал.
 */
export interface Recipient {
  id: number;
  /** регион сотрудника; лид с регионом уходит только внутрь него */
  region: string | null;
  online: boolean;
  /** лимит в сутки; null — без лимита */
  quota: number | null;
  sources: string[];
  donors: string[];
  /** личности (slug); пусто — любые */
  personas: string[];
  /** сколько входящих получил за сегодня (МСК) */
  todayCount: number;
  /** когда получил последний входящий; null — ещё ни одного */
  lastReceivedAt: number | null;
}

export interface InboundTags {
  source: string | null;
  donor: string | null;
  /** регион из запроса; null только в служебных вызовах — любой */
  region: string | null;
  /** личность лида (slug, если узнали; иначе как прислали); null — не указана */
  persona: string | null;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

const accepts = (list: string[], value: string | null) =>
  list.length === 0 ||
  (value !== null && list.some((x) => norm(x) === norm(value)));

const underQuota = (r: Recipient) => r.quota === null || r.todayCount < r.quota;
const inRegion = (r: Recipient, region: string | null) =>
  region === null || r.region === region;

export function isEligible(r: Recipient, lead: InboundTags): boolean {
  return (
    inRegion(r, lead.region) &&
    r.online &&
    underQuota(r) &&
    accepts(r.sources, lead.source) &&
    accepts(r.donors, lead.donor) &&
    accepts(r.personas, lead.persona)
  );
}

export function pickRecipient(
  list: Recipient[],
  lead: InboundTags,
): Recipient | null {
  const fit = list.filter((r) => isEligible(r, lead));
  if (!fit.length) return null;
  fit.sort(
    (a, b) =>
      a.todayCount - b.todayCount ||
      (a.lastReceivedAt ?? 0) - (b.lastReceivedAt ?? 0) ||
      a.id - b.id,
  );
  return fit[0];
}

/** Почему никто не подошёл — для заметки в лиде и ответа отправителю. */
export function skipReason(list: Recipient[], lead: InboundTags): string {
  const local = list.filter((r) => inRegion(r, lead.region));
  if (!local.length) return `в регионе ${lead.region} никого нет`;
  const online = local.filter((r) => r.online);
  if (!online.length)
    return lead.region
      ? `в регионе ${lead.region} нет менеджеров онлайн`
      : 'нет менеджеров онлайн';
  const bySource = online.filter((r) => accepts(r.sources, lead.source));
  if (!bySource.length)
    return `никто не принимает источник «${lead.source ?? '—'}»`;
  const byDonor = bySource.filter((r) => accepts(r.donors, lead.donor));
  if (!byDonor.length)
    return `никто не принимает донора «${lead.donor ?? '—'}»`;
  const byPersona = byDonor.filter((r) => accepts(r.personas, lead.persona));
  if (!byPersona.length)
    return `никто не принимает личность «${lead.persona ?? '—'}»`;
  if (!byPersona.some(underQuota))
    return 'у подходящих менеджеров исчерпан лимит';
  return 'нет подходящего менеджера';
}
