/** Источник трафика лида: откуда номер. Холодку ставит сервис — руками не выбирают. */
export const TRAFFIC_SOURCES = [
  { id: 'base', label: 'Базовики и свой трафик' },
  { id: 'hot_leadgen', label: 'Beboo Bot' },
  { id: 'cold_leadgen', label: 'Холодный лидген' },
];

export const MANUAL_TRAFFIC_SOURCES = TRAFFIC_SOURCES.filter((x) => x.id !== 'cold_leadgen');

export const trafficSourceLabel = (id) =>
  TRAFFIC_SOURCES.find((x) => x.id === id)?.label ?? null;
