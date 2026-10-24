import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DashboardUser } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { Role, isManagerRole } from '../enums/roles.enum';
import { HistoryService } from './history.service';

export interface ManagerScope {
  user: DashboardUser;
  role: string;
  /** сам пользователь и все его подчинённые по цепочке руководителей */
  userIds: number[];
  accountIds: number[];
  isAdmin: boolean;
}

@Injectable()
export class ScopeService {
  constructor(
    private prisma: PrismaService,
    private history: HistoryService,
  ) {}

  /**
   * Область видимости: менеджер — свои аккаунты, тимлид — аккаунты своих
   * менеджеров, хед — аккаунты менеджеров своих тимлидов. Цепочка собирается
   * по полю «руководитель», глубина не ограничена жёстко, но циклы не зацикливают.
   */
  async scopeOf(user: DashboardUser): Promise<ManagerScope> {
    const isAdmin = user.role === Role.ADMIN;
    if (isAdmin)
      return {
        user,
        role: user.role,
        userIds: [user.id],
        accountIds: [],
        isAdmin,
      };
    // Тимлид и хед видят только свой регион: даже если по старым данным к ним
    // привязан человек из другого региона, он в область не попадает.
    const userIds = await this.teamIds(user.id, user.regionCode);
    const accountIds = (
      await this.prisma.managerAccount.findMany({
        where: { userId: { in: userIds } },
        select: { accountId: true },
        orderBy: { accountId: 'asc' },
      })
    ).map((r) => r.accountId);
    return { user, role: user.role, userIds, accountIds, isAdmin };
  }

  /**
   * Сам пользователь плюс все подчинённые вниз по цепочке руководителей. С
   * регионом в команду входят только люди этого региона и без региона:
   * подчинённый из чужого региона не попадает, и его подчинённые тоже.
   */
  async teamIds(
    userId: number,
    region: string | null = null,
  ): Promise<number[]> {
    const seen = new Set<number>([userId]);
    let frontier = [userId];
    while (frontier.length) {
      const rows = await this.prisma.dashboardUser.findMany({
        where: {
          leadId: { in: frontier },
          ...(region
            ? { OR: [{ regionCode: region }, { regionCode: null }] }
            : {}),
        },
        select: { id: true },
      });
      frontier = rows.map((r) => r.id).filter((id) => !seen.has(id));
      for (const id of frontier) seen.add(id);
    }
    return [...seen];
  }

  async accountsFilter(user: DashboardUser): Promise<number[] | null> {
    const scope = await this.scopeOf(user);
    return scope.isAdmin ? null : scope.accountIds;
  }

  requireManager(user: DashboardUser): void {
    if (user.role !== Role.ADMIN && !isManagerRole(user.role)) {
      throw new ForbiddenException(
        `нужна роль manager (текущая: ${user.role})`,
      );
    }
  }

  requireVoice(user: DashboardUser): void {
    if (user.role !== Role.ADMIN && user.role !== Role.VOICE) {
      throw new ForbiddenException(`нужна роль voice (текущая: ${user.role})`);
    }
  }

  async requireChatOwned(
    user: DashboardUser,
    chatId: number,
  ): Promise<ManagerScope> {
    this.requireManager(user);
    const scope = await this.scopeOf(user);
    if (scope.isAdmin) return scope;
    const owner = await this.history.chatOwnerAccount(chatId);
    if (owner === null || !scope.accountIds.includes(owner)) {
      throw new NotFoundException('чат не найден');
    }
    return scope;
  }
}
