/** Разметка кеша промпта — отдельно от клиента: её берут и судьи, и генератор. */
export const CACHE_TTL = '1h' as const;

/** Метка кеша на блок: кеш-префикс заканчивается на нём. */
export const cacheMark = () => ({
  cache_control: { type: 'ephemeral' as const, ttl: CACHE_TTL },
});

/**
 * Начало окна истории: окно сдвигается не на каждое сообщение, а блоками по
 * step. Пока начало не сдвинулось, история — тот же префикс, что и на прошлом
 * ходе, и читается из кеша; в окне от limit до limit+step-1 сообщений.
 */
export function windowStart(total: number, limit: number, step = 10): number {
  if (total <= limit) return 0;
  return Math.floor((total - limit) / step) * step;
}
