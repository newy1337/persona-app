import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DashboardUser } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { Role } from '../enums/roles.enum';
import { HistoryService } from './history.service';

export interface ManagerScope {
  user: DashboardUser;
  role: string;
  accountIds: number[];
  isAdmin: boolean;
}

@Injectable()
export class ScopeService {
  constructor(
    private prisma: PrismaService,
    private history: HistoryService,
  ) {}

  async scopeOf(user: DashboardUser): Promise<ManagerScope> {
    const isAdmin = user.role === Role.ADMIN;
    const accountIds = isAdmin
      ? []
      : (
          await this.prisma.managerAccount.findMany({
            where: { userId: user.id },
            select: { tgAccountId: true },
            orderBy: { tgAccountId: 'asc' },
          })
        ).map((r) => r.tgAccountId);
    return { user, role: user.role, accountIds, isAdmin };
  }

  async accountsFilter(user: DashboardUser): Promise<number[] | null> {
    const scope = await this.scopeOf(user);
    return scope.isAdmin ? null : scope.accountIds;
  }

  requireManager(user: DashboardUser): void {
    if (user.role !== Role.ADMIN && user.role !== Role.MANAGER) {
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
