import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from 'src/prisma.service';
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

  async list() {
    const users = await this.prisma.dashboardUser.findMany({
      orderBy: { id: 'asc' },
      include: {
        accounts: {
          select: { tgAccountId: true },
          orderBy: { tgAccountId: 'asc' },
        },
        voicer: { select: { id: true, username: true } },
        voiceProfile: { select: { telegramId: true, telegramUsername: true } },
      },
    });
    return {
      roles: [...ROLES].sort(),
      items: users.map((u) => ({
        user_id: u.id,
        username: u.username,
        role: u.role,
        region_code: u.regionCode,
        voicer_id: u.voicerId ?? null,
        voicer_username: u.voicer?.username ?? null,
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

  async create(dto: CreateManagerDto) {
    await this.validateVoicer(dto.role, dto.voicer_id);
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
          regionCode: dto.region_code ?? null,
          role: dto.role,
          voicerId: dto.voicer_id ?? null,
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
    return { ...(await this.list()), created_user_id: createdId };
  }

  async update(userId: number, dto: UpdateManagerDto) {
    const user = await this.prisma.dashboardUser.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('нет такой учётки');
    await this.validateVoicer(dto.role ?? user.role, dto.voicer_id);
    const data: {
      role?: string;
      passwordHash?: string;
      passwordEncrypted?: string;
      regionCode?: string | null;
      voicerId?: number | null;
    } = {};
    if (dto.voicer_id !== undefined) data.voicerId = dto.voicer_id;
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
