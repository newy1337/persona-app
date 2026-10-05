export const DEAL_STAGES = [
  { id: 'vbros', label: 'Вброс' },
  { id: 'predloga', label: 'Предлога' },
  { id: 'soglas', label: 'Соглас' },
  { id: 'lead', label: 'Лид' },
  { id: 'deposit', label: 'Депозит' },
  { id: 'archive', label: 'Архив' },
];

export const dealStageLabel = (id) => DEAL_STAGES.find((s) => s.id === id)?.label ?? id ?? '';
