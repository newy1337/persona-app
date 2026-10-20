import { ForbiddenException, Injectable } from '@nestjs/common';
import type { DashboardUser } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { Role } from 'src/enums/roles.enum';

/** Настройки регионов для входящих лидов: сейчас — принимать ли перезабив. */
@Injectable()
export class RegionSettingsService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  private view(region: string, row?: { acceptReassigned: boolean } | null) {
    return {
      region_code: region,
      accept_reassigned: row?.acceptReassigned ?? false,
    };
  }

  /** Админ — все регионы с настройками; хед и тимлид — свой. */
  async list(user: DashboardUser) {
    if (user.role === Role.ADMIN) {
      const rows = await this.prisma.regionSetting.findMany({
        orderBy: { regionCode: 'asc' },
      });
      return { items: rows.map((r) => this.view(r.regionCode, r)) };
    }
    if (!user.regionCode) return { items: [] };
    const row = await this.prisma.regionSetting.findUnique({
      where: { regionCode: user.regionCode },
    });
    return {
      items: [this.view(user.regionCode, row)],
      can_manage: user.role === Role.HEAD,
    };
  }

  /** Переключить перезабив: хед — только своему региону, админ — любому. */
  async setAcceptReassigned(
    user: DashboardUser,
    region: string,
    accept: boolean,
  ) {
    if (user.role !== Role.ADMIN && user.regionCode !== region)
      throw new ForbiddenException('можно менять только свой регион');
    const now = this.clock.ts();
    const row = await this.prisma.regionSetting.upsert({
      where: { regionCode: region },
      create: {
        regionCode: region,
        acceptReassigned: accept,
        updatedAt: now,
        updatedById: user.id,
      },
      update: {
        acceptReassigned: accept,
        updatedAt: now,
        updatedById: user.id,
      },
    });
    return this.view(region, row);
  }
}
