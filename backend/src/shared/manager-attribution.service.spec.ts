import {
  ManagerAttributionService,
  UNASSIGNED_MANAGER,
} from './manager-attribution.service';

describe('Manager and region attribution', () => {
  it('uses the current account owner, falls back to the lead creator and preserves region strings', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 1,
        username: 'first',
        regionCode: '0077',
        accounts: [{ tgAccountId: 10 }],
      },
      {
        id: 2,
        username: 'second',
        regionCode: '123',
        accounts: [{ tgAccountId: 20 }],
      },
    ]);
    const service = new ManagerAttributionService({
      dashboardUser: { findMany },
    } as any);
    const directory = await service.directory();
    expect(directory.forAccount(10)).toEqual({
      manager_id: 1,
      manager_username: 'first',
      region_code: '0077',
    });
    expect(directory.forLead(20, 1).manager_username).toBe('second');
    expect(directory.forLead(null, 1).region_code).toBe('0077');
    expect(directory.forAccount(null)).toEqual(UNASSIGNED_MANAGER);
    expect(directory.forLead(null, null)).toEqual(UNASSIGNED_MANAGER);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: 'manager' } }),
    );
    expect(JSON.stringify(findMany.mock.calls)).not.toMatch(/password/);
    findMany.mockResolvedValue([
      {
        id: 2,
        username: 'second',
        regionCode: '4567',
        accounts: [{ tgAccountId: 10 }],
      },
    ]);
    expect((await service.directory()).forAccount(10)).toEqual({
      manager_id: 2,
      manager_username: 'second',
      region_code: '4567',
    });
  });
});
