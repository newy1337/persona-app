/**
 * Источник трафика лида: откуда номер. Базовик и горячий лидген выбирает
 * менеджер при добавлении, холодный лидген ставится сам — так приходит
 * холодка (/api/post/cold), горячий — так приходят лиды по /api/post.
 */
export const TRAFFIC_SOURCES = ['base', 'hot_leadgen', 'cold_leadgen'] as const;
export type TrafficSource = (typeof TRAFFIC_SOURCES)[number];

/** Что менеджер выбирает руками: холодку раздаёт сервис, её не выбирают. */
export const MANUAL_TRAFFIC_SOURCES = ['base', 'hot_leadgen'] as const;

export const TRAFFIC_SOURCE_LABELS: Readonly<Record<TrafficSource, string>> = {
  base: 'Базовик',
  hot_leadgen: 'Горячий лидген',
  cold_leadgen: 'Холодный лидген',
};

/** Фильтр статистики: конкретный источник или лиды без отметки (до поля). */
export const TRAFFIC_SOURCE_FILTERS = [...TRAFFIC_SOURCES, 'none'] as const;
