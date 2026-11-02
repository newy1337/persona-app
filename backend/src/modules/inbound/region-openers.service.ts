import { ForbiddenException, Injectable } from '@nestjs/common';
import type { DashboardUser, RegionOpener } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { Role } from 'src/enums/roles.enum';
import { mergePrompts } from 'src/brain/config/prompts';
import { openerVariants } from 'src/domain/outreach-opener';

const json = (text: string | null | undefined): Record<string, unknown> => {
  try {
    const v = JSON.parse(text ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

/**
 * Первые сообщения по регионам: хед задаёт пул для личностей своего региона,
 * админ — для любого. Пустой пул региона — уходит общий пул личности.
 */
@Injectable()
export class RegionOpenersService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  /** Регион, который пользователь смотрит: хед — свой, админ — выбранный или первый. */
  private async regionFor(
    user: DashboardUser,
    requested?: string | null,
  ): Promise<{ region: string | null; regions: string[] }> {
    if (user.role !== Role.ADMIN)
      return { region: user.regionCode ?? null, regions: [] };
    const rows = await this.prisma.dashboardUser.findMany({
      where: { regionCode: { not: null } },
      select: { regionCode: true },
      distinct: ['regionCode'],
      orderBy: { regionCode: 'asc' },
    });
    const regions = rows.map((r) => r.regionCode!).filter(Boolean);
    const region =
      requested && regions.includes(requested)
        ? requested
        : (requested ?? regions[0] ?? null);
    return { region, regions };
  }

  async list(user: DashboardUser, requested?: string | null) {
    const { region, regions } = await this.regionFor(user, requested);
    const [personas, own] = await Promise.all([
      this.prisma.persona.findMany({
        where: { enabled: true },
        select: { slug: true, name: true, prompts: true },
        orderBy: { name: 'asc' },
      }),
      region
        ? this.prisma.regionOpener.findMany({ where: { regionCode: region } })
        : Promise.resolve([] as RegionOpener[]),
    ]);
    const bySlug = new Map(own.map((r) => [r.personaSlug, r] as const));
    return {
      region,
      regions,
      can_manage: user.role === Role.ADMIN || user.role === Role.HEAD,
      items: personas.map((p) => {
        const row = bySlug.get(p.slug);
        return {
          slug: p.slug,
          name: p.name,
          /** общий пул личности — уходит, пока регион не задал свой */
          default_text: mergePrompts(json(p.prompts)).opener,
          text: row?.text ?? '',
          updated_at: row?.updatedAt ?? null,
        };
      }),
    };
  }

  /** Пул региона для личности; пустой текст — вернуться к общему пулу. */
  async update(
    user: DashboardUser,
    region: string,
    slug: string,
    text: string,
  ) {
    if (user.role !== Role.ADMIN && user.regionCode !== region)
      throw new ForbiddenException('можно менять только свой регион');
    const persona = await this.prisma.persona.findUnique({
      where: { slug },
      select: { enabled: true },
    });
    if (!persona) throw new ForbiddenException(`личности «${slug}» нет`);
    const now = this.clock.ts();
    const where = {
      regionCode_personaSlug: { regionCode: region, personaSlug: slug },
    };
    if (!openerVariants(text).length) {
      await this.prisma.regionOpener.deleteMany({
        where: { regionCode: region, personaSlug: slug },
      });
      return { region, slug, text: '', variants: 0 };
    }
    const row = await this.prisma.regionOpener.upsert({
      where,
      create: {
        regionCode: region,
        personaSlug: slug,
        text,
        updatedAt: now,
        updatedById: user.id,
      },
      update: { text, updatedAt: now, updatedById: user.id },
    });
    return {
      region,
      slug,
      text: row.text,
      variants: openerVariants(row.text).length,
    };
  }
}
