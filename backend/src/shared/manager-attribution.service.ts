import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Role } from '../enums/roles.enum';

export interface ManagerAttribution {
  manager_id: number | null;
  manager_username: string | null;
  region_code: string | null;
}

export const UNASSIGNED_MANAGER: ManagerAttribution = {
  manager_id: null,
  manager_username: null,
  region_code: null,
};

export interface ManagerDirectory {
  forAccount(accountId: number | null): ManagerAttribution;
  forLead(
    accountId: number | null,
    creatorId: number | null,
  ): ManagerAttribution;
}

@Injectable()
export class ManagerAttributionService {
  constructor(private prisma: PrismaService) {}

  async directory(): Promise<ManagerDirectory> {
    const users = await this.prisma.dashboardUser.findMany({
      where: { role: Role.MANAGER },
      select: {
        id: true,
        username: true,
        regionCode: true,
        accounts: { select: { tgAccountId: true } },
      },
    });
    const byAccount = new Map<number, ManagerAttribution>();
    const byUser = new Map<number, ManagerAttribution>();
    for (const user of users) {
      const view = {
        manager_id: user.id,
        manager_username: user.username,
        region_code: user.regionCode,
      };
      byUser.set(user.id, view);
      for (const account of user.accounts)
        byAccount.set(account.tgAccountId, view);
    }
    return {
      forAccount: (id) => byAccount.get(id) ?? { ...UNASSIGNED_MANAGER },
      forLead: (accountId, creatorId) =>
        byAccount.get(accountId) ??
        byUser.get(creatorId) ?? { ...UNASSIGNED_MANAGER },
    };
  }
}
