import { Injectable, Logger } from '@nestjs/common';
import { appConfig } from 'src/config/app.config';
import { ClockService } from 'src/shared/clock.service';

/** Ответ OpenRouter не меняется каждую секунду, а панель опрашивает часто. */
const CACHE_SECONDS = 60;
/** Дольше этого не ждём: баланс — справка, из-за неё страница стоять не должна. */
const TIMEOUT_MS = 8_000;

export interface OpenRouterBalance {
  /** Сколько куплено всего, долларов. */
  total: number | null;
  /** Сколько потрачено за всё время. */
  spent: number | null;
  /** Остаток — то, ради чего сюда смотрят. */
  left: number | null;
  today: number | null;
  week: number | null;
  month: number | null;
  /** На сколько дней хватит при сегодняшнем расходе; null — считать не из чего. */
  days_left: number | null;
  checked_at: number;
  error: string | null;
}

const money = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/**
 * Баланс ключа OpenRouter для панели.
 *
 * Ключ остаётся на сервере: наружу уходят только деньги. Ответ держим минуту —
 * страница статистики обновляется чаще, чем меняется баланс.
 */
@Injectable()
export class BalanceService {
  private readonly log = new Logger(BalanceService.name);
  private cache: OpenRouterBalance | null = null;

  constructor(private clock: ClockService) {}

  async openRouter(): Promise<OpenRouterBalance> {
    const now = this.clock.ts();
    if (this.cache && now - this.cache.checked_at < CACHE_SECONDS)
      return this.cache;
    const value = await this.fetchBalance(now);
    this.cache = value;
    return value;
  }

  private async fetchBalance(now: number): Promise<OpenRouterBalance> {
    const empty: OpenRouterBalance = {
      total: null,
      spent: null,
      left: null,
      today: null,
      week: null,
      month: null,
      days_left: null,
      checked_at: now,
      error: null,
    };
    if (!appConfig.openrouterApiKey)
      return { ...empty, error: 'ключ OpenRouter не задан' };

    try {
      const [credits, key] = await Promise.all([
        this.get('/credits'),
        this.get('/auth/key'),
      ]);
      const total = money(credits?.total_credits);
      const spent = money(credits?.total_usage ?? key?.usage);
      const left =
        total !== null && spent !== null
          ? Math.round((total - spent) * 100) / 100
          : null;
      const today = money(key?.usage_daily);
      const perDay =
        today && today > 1 ? today : money((key?.usage_weekly ?? 0) / 7);
      return {
        total,
        spent,
        left,
        today,
        week: money(key?.usage_weekly),
        month: money(key?.usage_monthly),
        days_left:
          left !== null && perDay
            ? Math.round((left / perDay) * 10) / 10
            : null,
        checked_at: now,
        error: null,
      };
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      this.log.warn(`баланс OpenRouter не прочитан: ${message}`);
      return { ...empty, error: 'OpenRouter не ответил' };
    }
  }

  private async get(path: string): Promise<Record<string, any> | null> {
    const res = await fetch(`${appConfig.openrouterBaseUrl}${path}`, {
      headers: { Authorization: `Bearer ${appConfig.openrouterApiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Record<string, any> };
    return body?.data ?? null;
  }
}
