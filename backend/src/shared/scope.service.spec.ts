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
  const prisma = { managerAccount: { findMany: jest.fn() } };
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
