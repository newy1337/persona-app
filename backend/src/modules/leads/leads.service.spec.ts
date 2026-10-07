import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListLeadsQuery } from './dto/lead.dto';
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

describe('LeadsService.list: deal stage and filters', () => {
  const row = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    phoneE164: `+7900000000${id}`,
    status: 'contacted',
    ownerUserId: 1,
    assignedAccountId: null,
    preferredAccountId: null,
    telegramUserId: null,
    ...extra,
  });

  function setup(
    opts: {
      found?: any[];
      total?: number;
      cards?: Array<{ chatId: bigint; facts: string }>;
      stageChats?: Array<{ chat_id: bigint }>;
    } = {},
  ) {
    const found = opts.found ?? [row(2), row(1)];
    const prisma = {
      phoneNumber: {
        findMany: jest.fn(async (args: any) => (args.orderBy ? found : [])),
        count: jest.fn(async (_args: any) => opts.total ?? found.length),
        groupBy: jest.fn(async (_args: any) => [
          { status: 'pending', _count: { _all: 50 } },
          { status: 'contacted', _count: { _all: 7 } },
        ]),
      },
      leadFacts: { findMany: jest.fn(async (_args: any) => opts.cards ?? []) },
      $queryRaw: jest.fn(async (_sql: any) => opts.stageChats ?? []),
      tgAccount: { findMany: jest.fn(async () => []) },
      persona: { findMany: jest.fn(async () => []) },
      message: { findMany: jest.fn(async () => []) },
    };
    const service = new LeadsService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      { directory: jest.fn(async () => undefined) } as any,
    );
    const pageArgs = () =>
      prisma.phoneNumber.findMany.mock.calls
        .map(([args]) => args)
        .find((args) => args.orderBy);
    return { prisma, service, pageArgs };
  }

  it('attaches deal_stage / deal_note to the page rows with one query', async () => {
    const { service, prisma } = setup({
      found: [
        row(3, { telegramUserId: 700n }),
        row(2, { telegramUserId: 800n }),
        row(1),
      ],
      cards: [
        {
          chatId: 700n,
          facts: JSON.stringify({ deal_stage: 'lead', deal_note: 'ждёт' }),
        },
        { chatId: 800n, facts: '{"name":"Оля"}' },
      ],
    });
    const out = await service.list(null, {});
    expect(prisma.leadFacts.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.leadFacts.findMany).toHaveBeenCalledWith({
      where: { chatId: { in: [700n, 800n] } },
    });
    expect(out.items.map((x) => [x.id, x.deal_stage, x.deal_note])).toEqual([
      [3, 'lead', 'ждёт'],
      [2, null, null],
      [1, null, null],
    ]);
    // без фильтра по этапу сырой запрос не нужен
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('a page without dialogues does not ask for the cards at all', async () => {
    const { service, prisma } = setup();
    const out = await service.list(null, {});
    expect(prisma.leadFacts.findMany).not.toHaveBeenCalled();
    expect(out.items.every((x) => x.deal_stage === null)).toBe(true);
  });

  it('several statuses narrow page and total with the same where', async () => {
    const { service, prisma, pageArgs } = setup({ total: 11 });
    const out = await service.list(null, { status: 'contacted, replied' });
    const where = pageArgs().where;
    expect(where.AND[1]).toEqual({ status: { in: ['contacted', 'replied'] } });
    expect(prisma.phoneNumber.count).toHaveBeenCalledWith({ where });
    expect(out.total).toBe(11);
  });

  it('unknown status -> 400', async () => {
    const { service, prisma } = setup();
    await expect(
      service.list(null, { status: 'contacted,bogus' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.phoneNumber.findMany).not.toHaveBeenCalled();
  });

  it('stage filter: one parameterised raw query, then telegramUserId IN (…)', async () => {
    const { service, prisma, pageArgs } = setup({
      total: 2,
      stageChats: [{ chat_id: 700n }, { chat_id: 800n }],
    });
    const scope = { userId: 9, accounts: [4] };
    const out = await service.list(scope, {
      deal_stage: 'lead,deposit',
      status: 'replied',
      limit: 25,
      offset: 25,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual(['lead', 'deposit']);
    expect(sql.sql).not.toContain('deposit');
    expect(sql.sql).toContain("->>'deal_stage' IN (");
    expect(sql.sql).not.toContain('COALESCE');

    const where = pageArgs().where;
    // область видимости остаётся в том же where
    expect(where.AND[0]).toEqual({
      OR: [{ ownerUserId: 9 }, { assignedAccountId: { in: [4] } }],
    });
    expect(where.AND[1]).toEqual({ status: 'replied' });
    expect(where.AND[3]).toEqual({ telegramUserId: { in: [700n, 800n] } });
    expect(pageArgs()).toMatchObject({ take: 25, skip: 25 });
    expect(prisma.phoneNumber.count).toHaveBeenCalledWith({ where });
    expect(out.total).toBe(2);
  });

  it('stage filter "none": dialogue without a stage, combinable with named stages', async () => {
    const { service, prisma } = setup({ stageChats: [] });
    await service.list(null, { deal_stage: 'none' });
    let sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual([]);
    expect(sql.sql).toContain(
      "COALESCE(p.facts::jsonb->>'deal_stage', '') = ''",
    );
    expect(sql.sql).toContain('FROM contacts c');

    await service.list(null, { deal_stage: 'none,archive' });
    sql = prisma.$queryRaw.mock.calls[1][0];
    expect(sql.values).toEqual(['archive']);
    expect(sql.sql).toContain(' OR ');
  });

  it('stage filter that matches no chat gives an empty IN, not "no filter"', async () => {
    const { service, pageArgs } = setup({ stageChats: [] });
    await service.list(null, { deal_stage: 'deposit' });
    expect(pageArgs().where.AND[3]).toEqual({ telegramUserId: { in: [] } });
  });

  it('unknown stage -> 400, nothing is queried', async () => {
    const { service, prisma } = setup();
    await expect(
      service.list(null, { deal_stage: 'lead,nope' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.phoneNumber.findMany).not.toHaveBeenCalled();
  });

  it('counts ignore the filters: grouped by scope only', async () => {
    const { service, prisma } = setup({
      total: 1,
      stageChats: [{ chat_id: 700n }],
    });
    const scope = { userId: 9, accounts: [] };
    const out = await service.list(scope, {
      status: 'replied',
      deal_stage: 'lead',
      q: 'оля',
    });
    expect(prisma.phoneNumber.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { OR: [{ ownerUserId: 9 }] },
      _count: { _all: true },
    });
    expect(out.total).toBe(1);
    expect(out.counts).toMatchObject({ pending: 50, contacted: 7, total: 57 });
  });
});

describe('ListLeadsQuery: status and deal_stage lists', () => {
  const errorsOf = (query: Record<string, unknown>) =>
    validateSync(plainToInstance(ListLeadsQuery, query)).map((e) => e.property);

  it('accepts one value, several values and none', () => {
    expect(errorsOf({})).toEqual([]);
    expect(errorsOf({ status: 'queued' })).toEqual([]);
    expect(errorsOf({ status: 'contacted,replied' })).toEqual([]);
    expect(errorsOf({ deal_stage: 'none,lead,archive' })).toEqual([]);
  });

  it('rejects unknown and empty values', () => {
    expect(errorsOf({ status: 'contacted,bogus' })).toEqual(['status']);
    expect(errorsOf({ status: '' })).toEqual(['status']);
    expect(errorsOf({ deal_stage: 'nope' })).toEqual(['deal_stage']);
    expect(errorsOf({ deal_stage: ['lead'] })).toEqual(['deal_stage']);
  });
});
