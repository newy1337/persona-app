export const statusConfig = {
  cold: { label: 'Холодный', color: '#4A9EFF', bg: 'rgba(74, 158, 255, 0.12)' },
  rapport: { label: 'Сближение', color: '#A78BFA', bg: 'rgba(167, 139, 250, 0.12)' },
  pain: { label: 'Финансы', color: '#00D4FF', bg: 'rgba(0, 212, 255, 0.12)' },
  close: { label: 'Подводка', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.12)' },
  post_lead: { label: 'Лид оформлен', color: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
};

const STAGE_COLORS = ['#4A9EFF', '#A78BFA', '#00D4FF', '#F59E0B', '#10B981', '#EC4899', '#84CC16'];

export function stageColors(index) {
  const color = STAGE_COLORS[(Math.max(1, index || 1) - 1) % STAGE_COLORS.length];
  return { color, bg: `${color}1F` };
}

export function stageFilters(rows) {
  const byId = new Map();
  for (const row of rows || []) {
    const st = row?.stage;
    if (st?.id && !byId.has(st.id)) byId.set(st.id, st);
  }
  return [...byId.values()]
    .sort((a, b) => a.index - b.index)
    .map((st) => ({ key: st.id, label: st.title, color: stageColors(st.index).color }));
}

export const tableFilters = Object.entries(statusConfig).map(([key, { label, color }]) => ({
  key,
  label,
  color,
}));

const HOT_VBROS_PHASES = new Set(['predloga', 'vbros_push', 'handoff']);

export const PRIORITY_COLORS = {
  hot: '#EF4444',
  normal: '#6B7A99',
};

export function priorityColor(vbrosPhase) {
  return HOT_VBROS_PHASES.has(vbrosPhase) ? PRIORITY_COLORS.hot : PRIORITY_COLORS.normal;
}
