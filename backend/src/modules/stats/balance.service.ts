import { Injectable, Logger } from '@nestjs/common';
import { appConfig } from 'src/config/app.config';
import { ClockService } from 'src/shared/clock.service';
import { PrismaService } from 'src/prisma.service';

const CACHE_SECONDS = 60;
const TIMEOUT_MS = 8_000;

export interface OpenRouterBalance {
  /** Чей счёт: OpenRouter или NanoGPT (по LLM_PROVIDER). */
  provider?: 'OpenRouter' | 'NanoGPT';
  total: number | null;
  spent: number | null;
  left: number | null;
  today: number | null;
  week: number | null;
  month: number | null;
  days_left: number | null;
  checked_at: number;
  error: string | null;
}

const money = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

@Injectable()
export class BalanceService {
  private readonly log = new Logger(BalanceService.name);
  private cache: OpenRouterBalance | null = null;

  constructor(
    private clock: ClockService,
    private prisma: PrismaService,
  ) {}

  /** Баланс того посредника, через который идут вызовы модели. */
  async current(): Promise<OpenRouterBalance> {
    const now = this.clock.ts();
    if (this.cache && now - this.cache.checked_at < CACHE_SECONDS)
      return this.cache;
    const value =
      appConfig.llmProvider === 'nanogpt'
        ? await this.fetchNanoGpt(now)
        : {
            ...(await this.fetchBalance(now)),
            provider: 'OpenRouter' as const,
          };
    this.cache = value;
    return value;
  }

  /**
   * NanoGPT отдаёт только остаток (POST /api/check-balance). Расход за
   * сутки и неделю берём из нашего учёта вызовов (provider = nanogpt).
   */
  private async fetchNanoGpt(now: number): Promise<OpenRouterBalance> {
    const empty: OpenRouterBalance = {
      provider: 'NanoGPT',
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
    if (!appConfig.nanogptApiKey)
      return { ...empty, error: 'ключ NanoGPT не задан' };
    try {
      const origin = new URL(appConfig.nanogptBaseUrl).origin;
      const res = await fetch(`${origin}/api/check-balance`, {
        method: 'POST',
        headers: { 'x-api-key': appConfig.nanogptApiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { usd_balance?: unknown };
      const left = money(body?.usd_balance);
      const [today, week, month] = await Promise.all(
        [1, 7, 30].map((days) => this.spentSince(now - days * 86400)),
      );
      const perDay = today && today > 1 ? today : money((week ?? 0) / 7);
      return {
        ...empty,
        left,
        today,
        week,
        month,
        days_left:
          left !== null && perDay
            ? Math.round((left / perDay) * 10) / 10
            : null,
      };
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      this.log.warn(`баланс NanoGPT не прочитан: ${message}`);
      return { ...empty, error: 'NanoGPT не ответил' };
    }
  }

  private async spentSince(from: number): Promise<number | null> {
    const sum = await this.prisma.modelUsage.aggregate({
      where: { provider: 'nanogpt', createdAt: { gte: from } },
      _sum: { providerEstimatedCostUsd: true },
    });
    return money(sum._sum.providerEstimatedCostUsd ?? 0);
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
