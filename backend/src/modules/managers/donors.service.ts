import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { freeCatalogName } from './catalog';

/** Доноры — справочник, как кампании: имя и сколько менеджеров его принимают. */
@Injectable()
export class DonorsService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  async list() {
    const rows = await this.prisma.donor.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { managers: true } } },
    });
    return {
      items: rows.map((d) => ({
        id: d.id,
        name: d.name,
        managers: d._count.managers,
      })),
    };
  }

  async create(rawName: string) {
    const name = await freeCatalogName(
      rawName,
      {
        empty: 'имя донора пустое',
        taken: (existing) => `донор «${existing}» уже есть`,
      },
      (candidate) =>
        this.prisma.donor.findFirst({
          where: { name: { equals: candidate, mode: 'insensitive' } },
        }),
    );
    await this.prisma.donor.create({
      data: { name, createdAt: this.clock.ts() },
    });
    return this.list();
  }

  async remove(id: number) {
    const donor = await this.prisma.donor.findUnique({ where: { id } });
    if (!donor) throw new NotFoundException('нет такого донора');
    await this.prisma.donor.delete({ where: { id } });
    return this.list();
  }
}
