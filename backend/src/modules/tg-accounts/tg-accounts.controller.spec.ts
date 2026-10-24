import { TgAccountsController } from './tg-accounts.controller';
import { ScopeService } from 'src/shared/scope.service';
import { ManagerAttributionService } from 'src/shared/manager-attribution.service';

describe('Telegram account ownership in the panel', () => {
  let controller: TgAccountsController;
  let users: any[];
  const admin = { id: 1, role: 'admin' } as any;
  const manager = { id: 2, role: 'manager' } as any;

  beforeEach(() => {
    users = [
      {
        id: 2,
        username: 'north',
        regionCode: '0077',
        accounts: [{ accountId: 10 }],
      },
      {
        id: 3,
        username: 'south',
        regionCode: '123',
        accounts: [{ accountId: 20 }],
      },
    ];
    const prisma = {
      dashboardUser: {
        // без where — справочник для подписей; с where.leadId — поиск подчинённых (их нет)
        findMany: jest.fn(async (args?: any) =>
          args?.where?.leadId
            ? users.filter((u) => args.where.leadId.in.includes(u.leadId))
            : users,
        ),
      },
      managerAccount: {
        findMany: jest.fn(async ({ where }) => {
          const ids: number[] =
            typeof where.userId === 'object' ? where.userId.in : [where.userId];
          return users
            .filter((u) => ids.includes(u.id))
            .flatMap((u) => u.accounts);
        }),
      },
    } as any;
    const accounts = {
      list: jest.fn(async () => [{ id: 10 }, { id: 20 }, { id: 30 }]),
    } as any;
    controller = new TgAccountsController(
      accounts,
      null,
      null,
      null,
      new ScopeService(prisma, null),
      new ManagerAttributionService(prisma),
    );
  });

  it('shows the admin the current owner and region, including unassigned accounts', async () => {
    expect(await controller.list(admin)).toEqual([
      { id: 10, manager_id: 2, manager_username: 'north', region_code: '0077' },
      { id: 20, manager_id: 3, manager_username: 'south', region_code: '123' },
      { id: 30, manager_id: null, manager_username: null, region_code: null },
    ]);
    users[0].accounts = [];
    users[1].accounts.push({ accountId: 10 });
    users[1].regionCode = '0456';
    expect((await controller.list(admin))[0]).toEqual({
      id: 10,
      manager_id: 3,
      manager_username: 'south',
      region_code: '0456',
    });
  });

  it('keeps manager visibility scoped to assigned accounts, including after reassignment', async () => {
    expect(await controller.list(manager)).toEqual([
      { id: 10, manager_id: 2, manager_username: 'north', region_code: '0077' },
    ]);
    users[0].accounts = [];
    users[1].accounts.push({ accountId: 10 });
    expect(await controller.list(manager)).toEqual([]);
  });
});
