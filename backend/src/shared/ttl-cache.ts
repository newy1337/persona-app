/**
 * Короткий кеш для опросов панели: десятки вкладок спрашивают одно и то же
 * раз в несколько секунд. Одинаковые запросы, пришедшие одновременно, ждут
 * один общий ответ; готовый ответ живёт ttlMs.
 */
export class TtlCache {
  /**
   * В тестах ответы не храним: сценарии меняют базу напрямую и сразу
   * проверяют ответ. Одновременные запросы по-прежнему склеиваются.
   */
  static keep = process.env.NODE_ENV !== 'test';

  private readonly values = new Map<
    string,
    { until: number; value: unknown }
  >();
  private readonly loading = new Map<string, Promise<unknown>>();

  constructor(private readonly maxEntries = 2000) {}

  async get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.values.get(key);
    if (TtlCache.keep && hit && hit.until > now) return hit.value as T;
    const running = this.loading.get(key);
    if (running) return running as Promise<T>;
    const started = load()
      .then((value) => {
        if (this.loading.get(key) === started) {
          if (this.values.size >= this.maxEntries) this.prune(Date.now());
          this.values.set(key, { until: Date.now() + ttlMs, value });
        }
        return value;
      })
      .finally(() => {
        if (this.loading.get(key) === started) this.loading.delete(key);
      });
    this.loading.set(key, started);
    return started;
  }

  /** Забыть всё: после записи, которая меняет ответы. */
  clear(): void {
    this.values.clear();
    this.loading.clear();
  }

  private prune(now: number): void {
    for (const [key, entry] of this.values)
      if (entry.until <= now) this.values.delete(key);
    if (this.values.size >= this.maxEntries) this.values.clear();
  }
}
