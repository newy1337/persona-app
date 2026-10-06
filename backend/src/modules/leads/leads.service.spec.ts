import { LeadsService } from './leads.service';

describe('LeadsService.list: paging and total', () => {
  const row = (id: number) => ({
    id,
    phoneE164: `+7900000000${id}`,
    status: 'pending',
    ownerUserId: 1,
    assignedAccountId: null,
    preferredAccountId: null,
  });

  function setup(found: any[] = [row(3), row(2)], total = 57) {
    const prisma = {
      phoneNumber: {
        // markReplied asks for contacted leads first; the page query has orderBy.
        findMany: jest.fn(async (args: any) => (args.orderBy ? found : [])),
        count: jest.fn(async (_args: any) => total),
        groupBy: jest.fn(async () => [
          { status: 'pending', _count: { _all: 50 } },
          { status: 'queued', _count: { _all: 7 } },
        ]),
      },
      tgAccount: { findMany: jest.fn(async () => []) },
      persona: { findMany: jest.fn(async () => []) },
      message: { findMany: jest.fn(async () => []) },
    };
    const attribution = { directory: jest.fn(async () => undefined) };
    const service = new LeadsService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      attribution as any,
    );
    const pageArgs = () =>
      prisma.phoneNumber.findMany.mock.calls
        .map(([args]) => args)
        .find((args) => args.orderBy);
    return { prisma, service, pageArgs };
  }

  it('defaults stay take 200 / skip 0', async () => {
    const { service, pageArgs } = setup();
    await service.list(null, {});
    expect(pageArgs()).toMatchObject({
      take: 200,
      skip: 0,
      orderBy: { id: 'desc' },
    });
  });

  it('skip / take follow offset / limit', async () => {
    const { service, pageArgs } = setup();
    await service.list(null, { limit: 25, offset: 50 });
    expect(pageArgs()).toMatchObject({ take: 25, skip: 50 });
  });

  it('total is counted with the same where as the page (status + search + scope)', async () => {
    const { service, prisma, pageArgs } = setup();
    const scope = { userId: 9, accounts: [4, 5] };
    const out = await service.list(scope, {
      status: 'queued',
      q: ' @Oleg ',
      limit: 25,
      offset: 25,
    });
    const where = pageArgs().where;
    expect(prisma.phoneNumber.count).toHaveBeenCalledTimes(1);
    expect(prisma.phoneNumber.count).toHaveBeenCalledWith({ where });
    expect(where.AND[0]).toEqual({
      OR: [{ ownerUserId: 9 }, { assignedAccountId: { in: [4, 5] } }],
    });
    expect(where.AND[1]).toEqual({ status: 'queued' });
    expect(where.AND[2].OR).toContainEqual({
      usernameKey: { contains: 'oleg' },
    });
    expect(out.total).toBe(57);
  });

  it('keeps items and counts next to total', async () => {
    const { service } = setup([row(3), row(2)], 2);
    const out = await service.list(null, {});
    expect(out.items.map((x) => x.id)).toEqual([3, 2]);
    expect(out.total).toBe(2);
    expect(out.counts).toMatchObject({ pending: 50, queued: 7, total: 57 });
  });
});
