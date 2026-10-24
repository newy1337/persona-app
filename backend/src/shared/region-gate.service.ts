import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ClockService } from './clock.service';

const STOPS_TTL_MS = 5_000;
const REGION_TTL_MS = 60_000;

export interface RegionStopView {
  region_code: string;
  reason: string | null;
  actor_id: number | null;
  created_at: number;
}

/**
 * Стоп региона: хед выключает образы своего региона. Бот и менеджеры этого
 * региона не отправляют фото из образов, запросы фото идут по прежней схеме —
 * как у аккаунта без образа. Остальная автоматика работает как обычно.
 * Регион аккаунта — регион его менеджера. Проверка идёт на каждом ответе
 * бота, поэтому оба справочника кешируются.
 */
@Injectable()
export class RegionGateService {
  private stops: { at: number; regions: Set<string> } | null = null;
  private regions = new Map<number, { at: number; region: string | null }>();

  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  async list(): Promise<RegionStopView[]> {
    const rows = await this.prisma.regionStop.findMany({
      orderBy: { regionCode: 'asc' },
    });
    return rows.map((r) => ({
      region_code: r.regionCode,
      reason: r.reason,
      actor_id: r.actorId,
      created_at: r.createdAt,
    }));
  }

  async status(region: string): Promise<RegionStopView | null> {
    return (await this.list()).find((r) => r.region_code === region) ?? null;
  }

  async engage(region: string, actorId: number, reason?: string | null) {
    await this.prisma.regionStop.upsert({
      where: { regionCode: region },
      create: {
        regionCode: region,
        actorId,
        reason: reason?.trim() || null,
        createdAt: this.clock.ts(),
      },
      update: {},
    });
    this.stops = null;
  }

  async clear(region: string) {
    await this.prisma.regionStop.deleteMany({ where: { regionCode: region } });
    this.stops = null;
  }

  private async stoppedRegions(): Promise<Set<string>> {
    const now = Date.now();
    if (this.stops && now - this.stops.at < STOPS_TTL_MS)
      return this.stops.regions;
    const rows = await this.prisma.regionStop.findMany({
      select: { regionCode: true },
    });
    this.stops = { at: now, regions: new Set(rows.map((r) => r.regionCode)) };
    return this.stops.regions;
  }

  async regionOfAccount(accountId: number): Promise<string | null> {
    const now = Date.now();
    const cached = this.regions.get(accountId);
    if (cached && now - cached.at < REGION_TTL_MS) return cached.region;
    const link = await this.prisma.managerAccount.findUnique({
      where: { accountId: accountId },
      select: { user: { select: { regionCode: true } } },
    });
    const region = link?.user.regionCode ?? null;
    this.regions.set(accountId, { at: now, region });
    return region;
  }

  /** Образы региона этого аккаунта выключены. */
  async photosOff(accountId: number | null | undefined) {
    if (accountId == null) return false;
    const stopped = await this.stoppedRegions();
    if (!stopped.size) return false;
    const region = await this.regionOfAccount(accountId);
    return region !== null && stopped.has(region);
  }
}
