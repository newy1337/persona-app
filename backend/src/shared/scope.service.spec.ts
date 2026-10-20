import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ScopeService } from './scope.service';
import { PrismaService } from '../prisma.service';
import { HistoryService } from './history.service';

const admin: any = { id: 1, role: 'admin' };
const manager: any = { id: 2, role: 'manager' };
const voice: any = { id: 3, role: 'voice' };

describe('ScopeService', () => {
  let service: ScopeService;
  const prisma = {
    managerAccount: { findMany: jest.fn() },
    // подчинённых нет: область видимости менеджера — только его аккаунты
    dashboardUser: { findMany: jest.fn(async () => []) },
  };
  const history = { chatOwnerAccount: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.managerAccount.findMany.mockResolvedValue([
      { tgAccountId: 10 },
      { tgAccountId: 11 },
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ScopeService,
        { provide: PrismaService, useValue: prisma },
        { provide: HistoryService, useValue: history },
      ],
    }).compile();
    service = moduleRef.get(ScopeService);
  });

  it('admin has no filter, manager gets the strict list', async () => {
    expect(await service.accountsFilter(admin)).toBeNull();
    expect(await service.accountsFilter(manager)).toEqual([10, 11]);
    prisma.managerAccount.findMany.mockResolvedValue([]);
    expect(await service.accountsFilter(manager)).toEqual([]);
  });

  it('тимлид и хед видят только свой регион, даже при старых связях между регионами', async () => {
    // 1 хед 111 → 2 тимлид 111 → {3 менеджер 111, 4 менеджер 222 (старая связь), 5 без региона};
    // 1 → 6 тимлид 222 (старая связь) → 7 менеджер 111 под чужим тимлидом
    const people = [
      { id: 1, regionCode: '111', leadId: null },
      { id: 2, regionCode: '111', leadId: 1 },
      { id: 3, regionCode: '111', leadId: 2 },
      { id: 4, regionCode: '222', leadId: 2 },
      { id: 5, regionCode: null, leadId: 2 },
      { id: 6, regionCode: '222', leadId: 1 },
      { id: 7, regionCode: '111', leadId: 6 },
    ];
    prisma.dashboardUser.findMany.mockImplementation((async ({ where }: any) =>
      people
        .filter((p) => where.leadId.in.includes(p.leadId))
        .filter((p) =>
          where.OR
            ? where.OR.some((c: any) => c.regionCode === p.regionCode)
            : true,
        )
        .map((p) => ({ id: p.id }))) as any);
    expect((await service.teamIds(1, '111')).sort()).toEqual([1, 2, 3, 5]);
    // без региона (старое поведение) цепочка целиком
    expect((await service.teamIds(1)).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // аккаунты считаются по ограниченной команде
    prisma.managerAccount.findMany.mockImplementation((async ({ where }: any) =>
      where.userId.in.map((id: number) => ({ tgAccountId: id * 10 }))) as any);
    const head: any = { id: 1, role: 'head', regionCode: '111' };
    expect(await service.accountsFilter(head)).toEqual([10, 20, 30, 50]);
    prisma.dashboardUser.findMany.mockImplementation((async () => []) as any);
  });

  it('role gates', () => {
    expect(() => service.requireManager(voice)).toThrow(ForbiddenException);
    expect(() => service.requireVoice(manager)).toThrow(ForbiddenException);
    expect(() => service.requireVoice(admin)).not.toThrow();
  });

  it('chat ownership is 404 for foreign or ownerless chats (fail-closed)', async () => {
    history.chatOwnerAccount.mockResolvedValue(10);
    await expect(service.requireChatOwned(manager, 5)).resolves.toMatchObject({
      accountIds: [10, 11],
    });
    history.chatOwnerAccount.mockResolvedValue(99);
    await expect(service.requireChatOwned(manager, 5)).rejects.toThrow(
      NotFoundException,
    );
    history.chatOwnerAccount.mockResolvedValue(null);
    await expect(service.requireChatOwned(manager, 5)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.requireChatOwned(admin, 5)).resolves.toMatchObject({
      isAdmin: true,
    });
  });
});
