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
  'archive',
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_STAGE_LABELS: Readonly<Record<DealStage, string>> = {
  vbros: 'Вброс',
  predloga: 'Предлога',
  soglas: 'Соглас',
  lead: 'Лид',
  archive: 'Архив',
};

export const DEAL_STAGE_KEY = 'deal_stage';
export const DEAL_NOTE_KEY = 'deal_note';
export const DEAL_STAGE_TS_KEY = 'deal_stage_ts';
export const DEAL_STAGE_EVENT = 'deal_stage_set';
export const MAX_DEAL_NOTE = 500;

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
