import { PersonaService } from './persona.service';

function fixture(mode = 'bio') {
  const p: any = Object.create(PersonaService.prototype);
  const row = {
    id: 1,
    enabled: true,
    updatedAt: 1,
    persona: '{"biography":"Родом из Перми, живу в Мадриде"}',
    rhythm: JSON.stringify({ timezone: 'Europe/Moscow', timezone_mode: mode }),
  };
  Object.assign(p, {
    materialise: (r) => ({
      enabled: r.enabled,
      updatedAt: r.updatedAt,
      rhythm: JSON.parse(r.rhythm),
      config: {},
    }),
    clock: { ts: () => 100 },
    locations: {
      resolve: jest.fn(async () => ({
        status: 'resolved',
        timezone: 'Europe/Madrid',
      })),
    },
    prisma: { persona: { updateMany: jest.fn(async () => ({ count: 1 })) } },
  });
  return { p, row };
}
it('new biography resolves current location and updates scheduling and dialogue together', async () => {
  const { p, row } = fixture();
  const loaded = await p.withCurrentLocation(row, {});
  expect(loaded.rhythm.timezone).toBe('Europe/Madrid');
  expect(loaded.config.timeZone).toBe('Europe/Madrid');
  expect(loaded.updatedAt).toBe(100);
  expect(p.locations.resolve).toHaveBeenCalledWith('persona', row.persona);
  expect(p.prisma.persona.updateMany.mock.calls[0][0].where).toMatchObject({
    updatedAt: 1,
    persona: row.persona,
    rhythm: row.rhythm,
  });
});
it('explicit timezone choice remains authoritative over biography', async () => {
  const { p, row } = fixture('manual');
  const loaded = await p.withCurrentLocation(row, {});
  expect(loaded.rhythm.timezone).toBe('Europe/Moscow');
  expect(p.locations.resolve).not.toHaveBeenCalled();
});
it('ambiguous biography exposes a reason to stop instead of using Moscow as a fact', async () => {
  const { p, row } = fixture();
  p.locations.resolve.mockResolvedValue({ status: 'unknown' });
  expect((await p.withCurrentLocation(row, {})).locationIssue).toContain(
    'текущее место',
  );
  expect(p.prisma.persona.updateMany).not.toHaveBeenCalled();
});
it('a simultaneous manual timezone choice is preserved', async () => {
  const { p, row } = fixture();
  p.prisma.persona.updateMany.mockResolvedValue({ count: 0 });
  p.prisma.persona.findUnique = async () => ({
    ...row,
    updatedAt: 2,
    rhythm: JSON.stringify({
      timezone: 'Asia/Bangkok',
      timezone_mode: 'manual',
    }),
  });
  expect((await p.withCurrentLocation(row, {})).rhythm.timezone).toBe(
    'Asia/Bangkok',
  );
});
