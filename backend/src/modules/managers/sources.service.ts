import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { freeCatalogName } from './catalog';
import { MANAGER_ROLES } from 'src/enums/roles.enum';

/** Справочник источников: имя и сколько менеджеров его принимают. */
@Injectable()
export class SourcesService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  async list() {
    const [rows, users] = await Promise.all([
      this.prisma.leadSource.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.dashboardUser.findMany({
        where: { role: { in: [...MANAGER_ROLES] } },
        select: { leadSources: true },
      }),
    ]);
    const count = (name: string) =>
      users.filter((u) =>
        u.leadSources.some((s) => s.toLowerCase() === name.toLowerCase()),
      ).length;
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        managers: count(r.name),
      })),
    };
  }

  async create(rawName: string) {
    const name = await freeCatalogName(
      rawName,
      {
        empty: 'имя источника пустое',
        taken: (existing) => `источник «${existing}» уже есть`,
      },
      (candidate) =>
        this.prisma.leadSource.findFirst({
          where: { name: { equals: candidate, mode: 'insensitive' } },
        }),
    );
    await this.prisma.leadSource.create({
      data: { name, createdAt: this.clock.ts() },
    });
    return this.list();
  }

  /** Удаление снимает источник у менеджеров, чтобы не остался «висячий». */
  async remove(id: number) {
    const row = await this.prisma.leadSource.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('нет такого источника');
    const users = await this.prisma.dashboardUser.findMany({
      where: { leadSources: { has: row.name } },
      select: { id: true, leadSources: true },
    });
    for (const u of users)
      await this.prisma.dashboardUser.update({
        where: { id: u.id },
        data: { leadSources: u.leadSources.filter((s) => s !== row.name) },
      });
    await this.prisma.leadSource.delete({ where: { id } });
    return this.list();
  }
}
