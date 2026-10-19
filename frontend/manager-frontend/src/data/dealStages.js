export const DEAL_STAGES = [
  { id: 'vbros', label: 'Вброс' },
  { id: 'predloga', label: 'Предлога' },
  { id: 'soglas', label: 'Соглас' },
  { id: 'lead', label: 'Лид' },
  { id: 'deposit', label: 'Депозит' },
  { id: 'archive', label: 'Архив' },
];

export const dealStageLabel = (id) => DEAL_STAGES.find((s) => s.id === id)?.label ?? id ?? '';

/** Цвета этапов для чипов фильтра: по порядку воронки, архив серый. */
export const DEAL_STAGE_COLORS = {
  vbros: '#4A9EFF',
  predloga: '#A78BFA',
  soglas: '#00D4FF',
  lead: '#F59E0B',
  deposit: '#10B981',
  archive: '#6B7A99',
  none: '#6B7A99',
};

/** Чипы фильтра по этапу: все этапы плюс «Без этапа» (ключ none). */
export const DEAL_STAGE_FILTERS = [...DEAL_STAGES, { id: 'none', label: 'Без этапа' }];

export const matchesDealStage = (row, stage) =>
  !stage || (stage === 'none' ? !row?.deal_stage : row?.deal_stage === stage);
