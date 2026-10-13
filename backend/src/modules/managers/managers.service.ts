import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from 'src/prisma.service';
import type { DashboardUser } from '@prisma/client';
import { ClockService } from 'src/shared/clock.service';
import { Role, ROLES } from 'src/enums/roles.enum';
import { CreateManagerDto, UpdateManagerDto } from './dto/manager.dto';
import { CryptoService } from 'src/shared/crypto.service';

@Injectable()
export class ManagersService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private crypto: CryptoService,
  ) {}

  async list(viewer: DashboardUser | null = null) {
    const users = await this.prisma.dashboardUser.findMany({
      orderBy: { id: 'asc' },
      include: {
        accounts: {
          select: { tgAccountId: true },
          orderBy: { tgAccountId: 'asc' },
        },
        voicer: { select: { id: true, username: true } },
        lead: { select: { id: true, username: true } },
        voiceProfile: { select: { telegramId: true, telegramUsername: true } },
      },
    });
    // Хед видит только свой регион: людей, которыми руководит, и себя.
    const visible =
      viewer && viewer.role === Role.HEAD
        ? users.filter(
            (u) =>
              u.regionCode === viewer.regionCode &&
              [Role.MANAGER, Role.TEAMLEAD, Role.HEAD].includes(u.role as Role),
          )
        : users;
    return {
      roles: [...ROLES].sort(),
      items: visible.map((u) => ({
        user_id: u.id,
        username: u.username,
        role: u.role,
        region_code: u.regionCode,
        voicer_id: u.voicerId ?? null,
        voicer_username: u.voicer?.username ?? null,
        lead_id: u.leadId ?? null,
        lead_username: u.lead?.username ?? null,
        telegram_linked: Boolean(u.voiceProfile?.telegramId),
        telegram_username: u.voiceProfile?.telegramUsername ?? null,
        password_available: Boolean(u.passwordEncrypted),
        account_ids: u.accounts.map((a) => a.tgAccountId),
      })),
    };
  }

  private async validateVoicer(role: string, id: number | null | undefined) {
    if (id == null) return;
    if (role !== Role.MANAGER)
      throw new UnprocessableEntityException(
        'Войсер назначается только менеджеру',
      );
    if (
      (await this.prisma.dashboardUser.findUnique({ where: { id } }))?.role !==
      Role.VOICE
    ) {
      throw new UnprocessableEntityException('Выберите учётку с ролью войсера');
    }
  }

  /** Хед региона: один на регион, к нему автоматически цепляются тимлиды региона. */
  private async regionHead(
    region: string | null,
    exceptId: number | null = null,
  ) {
    if (!region) return null;
    return this.prisma.dashboardUser.findFirst({
      where: {
        role: Role.HEAD,
        regionCode: region,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true, username: true },
    });
  }

  private async assertRegionFree(
    region: string | null,
    exceptId: number | null,
  ) {
    const other = await this.regionHead(region, exceptId);
    if (other)
      throw new UnprocessableEntityException(
        `В регионе ${region} уже есть хед: ${other.username}`,
      );
  }

  /**
   * Руководитель менеджера — тимлид того же региона, а без тимлида — хед
   * региона. У тимлида руководитель не выбирается: это хед региона, он
   * подставляется сам. У остальных его нет.
   */
  private async managerLead(
    role: string,
    region: string | null,
    id: number | null | undefined,
    selfId: number | null = null,
  ): Promise<number | null> {
    if (role === Role.TEAMLEAD)
      return (await this.regionHead(region, selfId))?.id ?? null;
    if (role !== Role.MANAGER) {
      if (id != null)
        throw new UnprocessableEntityException(
          'Руководитель назначается только менеджеру',
        );
      return null;
    }
    // Менеджер без тимлида подчиняется хеду региона напрямую.
    if (id == null) return (await this.regionHead(region, selfId))?.id ?? null;
    if (id === selfId)
      throw new UnprocessableEntityException(
        'Нельзя быть руководителем самому себе',
      );
    const lead = await this.prisma.dashboardUser.findUnique({ where: { id } });
    if (lead?.role !== Role.TEAMLEAD)
      throw new UnprocessableEntityException(
        'Руководителем менеджера может быть только тимлид',
      );
    if (!region || lead.regionCode !== region)
      throw new UnprocessableEntityException(
        'Тимлид должен быть из того же региона',
      );
    return id;
  }

  /**
   * Хед региона получил регион: тимлиды региона и менеджеры без тимлида — его,
   * подчинённые из других регионов отцепляются.
   */
  private async attachRegionToHead(headId: number, region: string | null) {
    await this.prisma.dashboardUser.updateMany({
      where: {
        leadId: headId,
        ...(region ? { regionCode: { not: region } } : {}),
      },
      data: { leadId: null },
    });
    if (region)
      await this.prisma.dashboardUser.updateMany({
        where: { role: Role.TEAMLEAD, regionCode: region },
        data: { leadId: headId },
      });
    await this.attachOrphansToHead(region);
  }

  /** Менеджеры региона без руководителя подчиняются хеду региона. */
  private async attachOrphansToHead(region: string | null) {
    const head = await this.regionHead(region);
    if (!head) return;
    await this.prisma.dashboardUser.updateMany({
      where: { role: Role.MANAGER, regionCode: region, leadId: null },
      data: { leadId: head.id },
    });
  }

  /** Тимлид сменил регион: его менеджеры из другого региона уходят к своему хеду. */
  private async detachForeignManagers(leadId: number, region: string | null) {
    const foreign = await this.prisma.dashboardUser.findMany({
      where: { leadId, ...(region ? { regionCode: { not: region } } : {}) },
      select: { regionCode: true },
    });
    await this.prisma.dashboardUser.updateMany({
      where: { leadId, ...(region ? { regionCode: { not: region } } : {}) },
      data: { leadId: null },
    });
    for (const code of new Set(foreign.map((u) => u.regionCode)))
      await this.attachOrphansToHead(code);
  }

  async create(dto: CreateManagerDto) {
    await this.validateVoicer(dto.role, dto.voicer_id);
    const region = dto.region_code ?? null;
    if (dto.role === Role.HEAD) await this.assertRegionFree(region, null);
    const leadId = await this.managerLead(dto.role, region, dto.lead_id);
    const password = dto.password ?? randomBytes(12).toString('base64url');
    const passwordHash = await argon2.hash(password);
    const passwordEncrypted = this.crypto.encrypt(password);
    let createdId: number;
    try {
      const created = await this.prisma.dashboardUser.create({
        data: {
          username: dto.username,
          passwordHash,
          passwordEncrypted,
          regionCode: region,
          role: dto.role,
          voicerId: dto.voicer_id ?? null,
          leadId,
          createdAt: this.clock.ts(),
        },
      });
      createdId = created.id;
    } catch (e) {
      const taken = String(e?.code) === 'P2002';
      throw new ConflictException(
        taken
          ? `логин '${dto.username}' уже занят`
          : `не удалось создать пользователя (${e?.name})`,
      );
    }
    if (dto.role === Role.HEAD)
      await this.attachRegionToHead(createdId, region);
    return { ...(await this.list()), created_user_id: createdId };
  }

  async update(
    userId: number,
    dto: UpdateManagerDto,
    viewer: DashboardUser | null = null,
  ) {
    const user = await this.prisma.dashboardUser.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('нет такой учётки');
    // Хед правит только руководителя у менеджеров своего региона.
    if (viewer && viewer.role !== Role.ADMIN) {
      const allowed = ['lead_id'];
      const extra = Object.keys(dto).filter((k) => !allowed.includes(k));
      if (
        viewer.role !== Role.HEAD ||
        user.role !== Role.MANAGER ||
        !viewer.regionCode ||
        user.regionCode !== viewer.regionCode ||
        extra.length
      )
        throw new ForbiddenException(
          'Хед может только назначать тимлида менеджерам своего региона',
        );
    }
    const nextRole = dto.role ?? user.role;
    const nextRegion =
      dto.region_code !== undefined ? dto.region_code : user.regionCode;
    if (nextRole === Role.HEAD) await this.assertRegionFree(nextRegion, userId);
    await this.validateVoicer(dto.role ?? user.role, dto.voicer_id);
    const data: {
      role?: string;
      passwordHash?: string;
      passwordEncrypted?: string;
      regionCode?: string | null;
      voicerId?: number | null;
      leadId?: number | null;
    } = {};
    if (dto.voicer_id !== undefined) data.voicerId = dto.voicer_id;
    // Руководитель считается от роли и региона: хед — никого, тимлид — хед
    // региона, менеджер — тимлид своего региона (если задан и подходит).
    const roleOrRegionChanged =
      nextRole !== user.role || nextRegion !== user.regionCode;
    if (dto.lead_id !== undefined || roleOrRegionChanged) {
      const requested =
        dto.lead_id !== undefined
          ? dto.lead_id
          : nextRole === user.role && nextRegion === user.regionCode
            ? user.leadId
            : null;
      data.leadId = await this.managerLead(
        nextRole,
        nextRegion,
        requested,
        userId,
      );
    }
    if (dto.role !== undefined && dto.role !== Role.MANAGER)
      data.voicerId = null;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.region_code !== undefined) data.regionCode = dto.region_code;
    if (dto.password !== undefined) {
      data.passwordHash = await argon2.hash(dto.password);
      data.passwordEncrypted = this.crypto.encrypt(dto.password);
    }
    await this.prisma.$transaction(async (tx) => {
      if (dto.role !== undefined && dto.role !== user.role)
        await this.ensureNoActiveTasks(userId, tx);
      if (dto.account_ids !== undefined) {
        if (
          (dto.role ?? user.role) !== Role.MANAGER &&
          dto.account_ids.length
        ) {
          throw new UnprocessableEntityException(
            'Аккаунты закрепляются только за менеджером',
          );
        }
        await this.requireAccounts(tx, dto.account_ids);
      }
      if (
        user.role === Role.VOICE &&
        dto.role !== undefined &&
        dto.role !== Role.VOICE
      ) {
        await tx.dashboardUser.updateMany({
          where: { voicerId: userId },
          data: { voicerId: null },
        });
        await tx.voicerProfile.deleteMany({ where: { userId } });
      }
      // Был тимлидом или хедом и роль сменилась — подчинённые остаются без руководителя.
      if (
        dto.role !== undefined &&
        dto.role !== user.role &&
        (user.role === Role.TEAMLEAD || user.role === Role.HEAD)
      )
        await tx.dashboardUser.updateMany({
          where: { leadId: userId },
          data: { leadId: null },
        });
      if (Object.keys(data).length)
        await tx.dashboardUser.update({ where: { id: userId }, data });
      if (dto.role !== undefined && dto.role !== Role.MANAGER)
        await tx.managerAccount.deleteMany({ where: { userId } });
      if (dto.account_ids !== undefined) {
        await tx.managerAccount.deleteMany({ where: { userId } });
        for (const acc of new Set(dto.account_ids)) {
          await tx.managerAccount.deleteMany({ where: { tgAccountId: acc } });
          await tx.managerAccount.create({
            data: { userId, tgAccountId: acc },
          });
        }
      }
    });
    if (nextRole === Role.HEAD)
      await this.attachRegionToHead(userId, nextRegion);
    if (nextRole === Role.TEAMLEAD)
      await this.detachForeignManagers(userId, nextRegion);
    // Бывшие подчинённые (и сам пользователь после смены роли) без
    // руководителя уходят к хеду своего региона.
    for (const code of new Set([user.regionCode, nextRegion]))
      await this.attachOrphansToHead(code);
    return this.list();
  }

  async credentials(userId: number) {
    const user = await this.prisma.dashboardUser.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('нет такой учётки');
    return {
      user_id: user.id,
      username: user.username,
      region_code: user.regionCode,
      password: user.passwordEncrypted
        ? this.crypto.decrypt(user.passwordEncrypted)
        : null,
    };
  }

  async regeneratePassword(userId: number) {
    await this.update(userId, {
      password: randomBytes(12).toString('base64url'),
    });
    return this.credentials(userId);
  }

  private async resolveOwner(userId: number | null | undefined) {
    if (userId == null) return;
    const target = await this.prisma.dashboardUser.findUnique({
      where: { id: userId },
    });
    if (!target) throw new NotFoundException('нет такой учётки');
    if (target.role !== Role.MANAGER) {
      throw new UnprocessableEntityException(
        `«${target.username}» — ${target.role}, а не менеджер: аккаунты закрепляются только за менеджерами`,
      );
    }
  }

  async setAccountOwner(
    tgAccountId: number,
    userId: number | null | undefined,
  ) {
    return this.setOwnerBulk([tgAccountId], userId);
  }

  async setOwnerBulk(
    tgAccountIds: number[],
    userId: number | null | undefined,
  ) {
    await this.resolveOwner(userId);
    const ids = [...new Set(tgAccountIds)];
    await this.prisma.$transaction(async (tx) => {
      await this.requireAccounts(tx, ids);
      await tx.managerAccount.deleteMany({
        where: { tgAccountId: { in: ids } },
      });
      if (userId != null)
        await tx.managerAccount.createMany({
          data: ids.map((tgAccountId) => ({ userId, tgAccountId })),
        });
    });
    return this.list();
  }

  private async requireAccounts(tx: Prisma.TransactionClient, ids: number[]) {
    if (
      (await tx.tgAccount.count({
        where: { id: { in: [...new Set(ids)] } },
      })) !== new Set(ids).size
    ) {
      throw new NotFoundException(
        'Один из Telegram-аккаунтов больше не существует. Обновите список',
      );
    }
  }

  private async ensureNoActiveTasks(
    userId: number,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    if (
      await db.voiceTask.count({
        where: {
          OR: [{ managerId: userId }, { voicerId: userId }],
          status: {
            in: [
              'queued',
              'in_progress',
              'delivering',
              'delivery_error',
              'delivery_review',
            ],
          },
        },
      })
    ) {
      throw new ConflictException(
        'Сначала завершите или отмените активные задания войсера',
      );
    }
  }

  async remove(userId: number, byUserId: number) {
    if (userId === byUserId)
      throw new ConflictException('нельзя удалить самого себя');
    const target = await this.prisma.dashboardUser.findUnique({
      where: { id: userId },
    });
    if (!target) throw new NotFoundException('нет такой учётки');
    await this.prisma.$transaction(async (tx) => {
      await this.ensureNoActiveTasks(userId, tx);
      await tx.dashboardUser.delete({ where: { id: userId } });
    });
    return this.list();
  }
}
