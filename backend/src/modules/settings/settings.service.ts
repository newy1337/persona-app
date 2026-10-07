import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { normalizeTriggers } from 'src/domain/handoff-triggers';

export interface AppSettingsView {
  initiative_enabled: boolean;
  proactive_max_per_day: number;
  quiet_start: string;
  quiet_end: string;
  custom_prompt: string;
  pause_on_manual_message: boolean;
  /** стоп-фразы клиента: бот замолкает, чат уходит менеджеру */
  handoff_triggers: string[];
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  private cache: { until: number; value: AppSettingsView } | null = null;
  private static readonly CACHE_MS = 2000;

  /** Настройки читает каждый прогноз и каждый ответ; пара секунд кеша снимает это с базы. */
  async get(): Promise<AppSettingsView> {
    if (this.cache && this.cache.until > Date.now()) return this.cache.value;
    const value = await this.read();
    this.cache = { until: Date.now() + SettingsService.CACHE_MS, value };
    return value;
  }

  private async read(): Promise<AppSettingsView> {
    const row = await this.prisma.appSettings.findUnique({ where: { id: 1 } });
    const extra = this.parseExtra(row?.customPrompt);
    return {
      initiative_enabled: row ? Boolean(row.initiativeEnabled) : true,
      proactive_max_per_day: clamp(row?.proactiveMaxPerDay ?? 1, 1, 2),
      quiet_start: row?.quietStart ?? '23:00',
      quiet_end: row?.quietEnd ?? '08:00',
      custom_prompt: extra.prompt,
      pause_on_manual_message: extra.pauseOnManual,
      handoff_triggers: extra.triggers,
    };
  }

  private parseExtra(raw: string | null | undefined): {
    prompt: string;
    pauseOnManual: boolean;
    triggers: string[];
  } {
    if (!raw) return { prompt: '', pauseOnManual: false, triggers: [] };
    try {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && 'prompt' in data) {
        return {
          prompt: String(data.prompt ?? ''),
          pauseOnManual: Boolean(data.pause_on_manual_message),
          triggers: normalizeTriggers(data.handoff_triggers),
        };
      }
    } catch {}
    return { prompt: raw, pauseOnManual: false, triggers: [] };
  }

  async update(patch: Partial<AppSettingsView>): Promise<AppSettingsView> {
    const current = await this.get();
    const next = { ...current, ...patch };
    const data = {
      initiativeEnabled: next.initiative_enabled ? 1 : 0,
      proactiveMaxPerDay: clamp(Number(next.proactive_max_per_day) || 1, 1, 2),
      quietStart: next.quiet_start,
      quietEnd: next.quiet_end,
      customPrompt: JSON.stringify({
        prompt: next.custom_prompt,
        pause_on_manual_message: next.pause_on_manual_message,
        handoff_triggers: normalizeTriggers(next.handoff_triggers),
      }),
      updatedAt: this.clock.ts(),
    };
    await this.prisma.appSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
    this.cache = null;
    return this.get();
  }

  async usageSummary(days = 7) {
    const end = this.clock.ts();
    const since = end - days * 86400;
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT provider, model, stage, COUNT(*)::float8 AS requests,
             SUM(input_tokens)::float8 AS input_tokens,
             SUM(output_tokens)::float8 AS output_tokens,
             SUM(cached_tokens)::float8 AS cached_tokens,
             SUM(provider_estimated_cost_usd)::float8 AS provider_estimated_cost_usd,
             AVG(elapsed_ms)::float8 AS average_elapsed_ms
      FROM model_usage WHERE created_at >= ${since} AND created_at <= ${end}
      GROUP BY provider, model, stage ORDER BY provider, model, stage`;
    return {
      days,
      since,
      rows: rows.map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [
            k,
            typeof v === 'bigint' ? Number(v) : v,
          ]),
        ),
      ),
    };
  }
}
