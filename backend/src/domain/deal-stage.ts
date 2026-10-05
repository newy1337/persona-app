/**
 * Этап сделки: ставит менеджер руками, как статус в CRM. Отдельно от стадий
 * воронки, которые ведёт мозг. Хранится в карточке лида, каждая смена пишется
 * событием deal_stage_set — по ним считается статистика по дням.
 */
export const DEAL_STAGES = [
  'vbros',
  'predloga',
  'soglas',
  'lead',
  'deposit',
  'archive',
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_STAGE_LABELS: Readonly<Record<DealStage, string>> = {
  vbros: 'Вброс',
  predloga: 'Предлога',
  soglas: 'Соглас',
  lead: 'Лид',
  deposit: 'Депозит',
  archive: 'Архив',
};

export const DEAL_STAGE_KEY = 'deal_stage';
export const DEAL_NOTE_KEY = 'deal_note';
export const DEAL_STAGE_TS_KEY = 'deal_stage_ts';
/** когда чат впервые дошёл до каждого этапа воронки: {vbros: ts, ...} — назад не откатывается */
export const DEAL_REACHED_KEY = 'deal_reached';
export const DEAL_STAGE_EVENT = 'deal_stage_set';
/** чат впервые дошёл до этапа — по этим событиям считается статистика */
export const DEAL_REACHED_EVENT = 'deal_stage_reached';
export const MAX_DEAL_NOTE = 500;

/** Этапы воронки по порядку; архив стоит отдельно и в воронку не входит. */
export const FUNNEL_STAGES: readonly DealStage[] = DEAL_STAGES.filter(
  (s) => s !== 'archive',
);

/**
 * Какие этапы считаются пройденными при выставлении этапа: все до него
 * включительно. Менеджер может перепрыгнуть со «вброса» на «лид» — предлога
 * и соглас тоже пройдены. Архив ничего не проходит.
 */
export function stagesReachedBy(stage: DealStage): DealStage[] {
  const idx = FUNNEL_STAGES.indexOf(stage);
  return idx < 0 ? [] : FUNNEL_STAGES.slice(0, idx + 1);
}

export function isDealStage(value: unknown): value is DealStage {
  return (
    typeof value === 'string' &&
    (DEAL_STAGES as readonly string[]).includes(value)
  );
}

/** Архив без причины не принимаем: иначе статистика по архиву бесполезна. */
export function dealNoteError(stage: DealStage, note: string): string | null {
  if (stage === 'archive' && !note.trim()) return 'для архива нужна причина';
  if (note.length > MAX_DEAL_NOTE)
    return `причина длиннее ${MAX_DEAL_NOTE} символов`;
  return null;
}
