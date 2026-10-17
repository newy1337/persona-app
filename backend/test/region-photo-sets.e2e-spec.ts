import { useTestDatabase } from './database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'region-photo-sets-e2e-'));
process.env.DATA_DIR = dir;
process.env.TG_API_ID = '';
process.env.TG_API_HASH = '';
useTestDatabase('region_photo_sets');

import type { DashboardUser } from '@prisma/client';
import { PrismaService } from '../src/prisma.service';
import { HistoryService } from '../src/shared/history.service';
import { ScopeService } from '../src/shared/scope.service';
import { PhotoLibraryService } from '../src/shared/photo-library.service';
import { RegionGateService } from '../src/shared/region-gate.service';
import { PhotoSetsService } from '../src/modules/photo-sets/photo-sets.service';

describe('photo sets by region: the head runs them, chats keep the set they started on (real database)', () => {
  let prisma: PrismaService,
    history: HistoryService,
    photos: PhotoLibraryService;
  let sets: PhotoSetsService, gate: RegionGateService;
  let head: DashboardUser, manager: DashboardUser, otherHead: DashboardUser;
  let now = 1_000;
  const clock = { now: () => new Date(now * 1000), ts: () => now };

  const user = (
    username: string,
    role: string,
    regionCode: string,
    leadId?: number,
  ) =>
    prisma.dashboardUser.create({
      data: {
        username,
        role,
        regionCode,
        passwordHash: 'x',
        createdAt: 1,
        leadId,
      },
    });
  const stage = (chatId: number, deal_stage: string) =>
    prisma.leadFacts.upsert({
      where: { chatId: BigInt(chatId) },
      create: { chatId: BigInt(chatId), facts: JSON.stringify({ deal_stage }) },
      update: { facts: JSON.stringify({ deal_stage }) },
    });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    for (const slug of ['nadya', 'denis'])
      await prisma.persona.create({
        data: {
          slug,
          name: slug === 'nadya' ? 'Надя' : 'Денис',
          createdAt: 1,
          updatedAt: 1,
        },
      });
    head = await user('head_msk', 'head', 'MSK');
    otherHead = await user('head_spb', 'head', 'SPB');
    manager = await user('mgr_msk', 'manager', 'MSK', head.id);
    const spbManager = await user('mgr_spb', 'manager', 'SPB', otherHead.id);
    await prisma.tgAccount.create({
      data: {
        id: 1,
        phoneE164: '+10000000001',
        personaId: 'nadya',
        addedAt: 1,
        status: 'active',
      },
    });
    await prisma.tgAccount.create({
      data: {
        id: 2,
        phoneE164: '+10000000002',
        personaId: 'nadya',
        addedAt: 1,
        status: 'active',
      },
    });
    await prisma.managerAccount.create({
      data: { userId: manager.id, tgAccountId: 1 },
    });
    await prisma.managerAccount.create({
      data: { userId: spbManager.id, tgAccountId: 2 },
    });
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    photos = new PhotoLibraryService(prisma);
    history = new HistoryService(prisma, clock as any, photos);
    const scope = new ScopeService(prisma, history);
    sets = new PhotoSetsService(
      prisma,
      clock as any,
      history,
      scope,
      {} as any,
      { scoped: () => ({ record: async () => undefined }) } as any,
      photos,
    );
    gate = new RegionGateService(prisma, clock as any);
  });

  it('the head creates sets in his region; managers see them read-only; another region does not see them', async () => {
    const created = await sets.create(head, 'Надя — осень');
    expect(created).toMatchObject({ region_code: 'MSK', can_edit: true });
    await expect(sets.create(manager, 'нельзя')).rejects.toThrow(/хед/);
    const admin = { id: 0, role: 'admin', regionCode: null } as DashboardUser;
    await expect(sets.create(admin, 'общий')).rejects.toThrow(/регион/);
    expect(await sets.create(admin, 'Надя СПб', 'SPB')).toMatchObject({
      region_code: 'SPB',
    });

    const managerView = await sets.list(manager);
    expect(managerView.can_create).toBe(false);
    expect(managerView.items.map((s) => s.id)).toContain(created.id);
    expect(managerView.items.find((s) => s.id === created.id)?.can_edit).toBe(
      false,
    );
    await expect(sets.requireEditable(manager, created.id)).rejects.toThrow(
      /хед/,
    );

    expect((await sets.list(otherHead)).items.map((s) => s.id)).not.toContain(
      created.id,
    );
    await expect(sets.requireVisible(otherHead, created.id)).rejects.toThrow(
      /не найден/,
    );
  });

  it('a new set for the persona goes to new clients only; started chats stay on the old one', async () => {
    const autumn = await sets.create(head, 'Надя — образ 1');
    const winter = await sets.create(head, 'Надя — образ 2');
    const foreign = await sets.create(otherHead, 'Надя Питер');
    await expect(sets.assignRegion(head, 'nadya', foreign.id)).rejects.toThrow(
      /этого региона/,
    );
    await expect(
      sets.assignRegion(manager, 'nadya', autumn.id),
    ).rejects.toThrow(/хед/);

    const view = await sets.assignRegion(head, 'nadya', autumn.id);
    expect(view.personas.find((p) => p.slug === 'nadya')).toMatchObject({
      set_id: autumn.id,
    });
    await history.ensureContact(5001, 1);
    expect((await photos.setForChat(5001))?.id).toBe(autumn.id);

    await sets.assignRegion(head, 'nadya', winter.id);
    await history.ensureContact(5002, 1);
    expect((await photos.setForChat(5002))?.id).toBe(winter.id);
    expect((await photos.setForChat(5001))?.id).toBe(autumn.id);

    // Аккаунт другого региона назначение московского хеда не получает.
    await history.ensureContact(5003, 2);
    expect(await photos.setForChat(5003)).toBeNull();
  });

  it('a set cannot be deleted while assigned or while any of its chats is still going', async () => {
    const set = await sets.create(head, 'Надя — на удаление');
    await sets.assignRegion(head, 'nadya', set.id);
    await history.ensureContact(6001, 1);
    await history.ensureContact(6002, 1);
    await expect(sets.remove(set.id)).rejects.toThrow(/назначен личности/);

    const other = await sets.create(head, 'Надя — новый');
    await sets.assignRegion(head, 'nadya', other.id);
    await expect(sets.remove(set.id)).rejects.toThrow(/идёт 2 диалога/);

    await stage(6001, 'lead');
    await stage(6002, 'vbros');
    await expect(sets.remove(set.id)).rejects.toThrow(/идёт 1 диалог /);
    await stage(6002, 'archive');
    await expect(sets.remove(set.id)).resolves.toMatchObject({
      archived: true,
    });
    expect((await sets.list(head)).items.map((s) => s.id)).not.toContain(
      set.id,
    );
    // Закрытый диалог остаётся на своём (архивном) образе и фото больше не шлёт.
    expect(await photos.setForChat(6001)).toBeNull();
  });

  it('the region stop silences only accounts of that region', async () => {
    expect(await gate.accountStopped(1)).toBe(false);
    await gate.engage('MSK', head.id, 'проверка');
    expect(await gate.accountStopped(1)).toBe(true);
    expect(await gate.accountStopped(2)).toBe(false);
    expect(await gate.accountStopped(null)).toBe(false);
    await gate.clear('MSK');
    expect(await gate.accountStopped(1)).toBe(false);
  });
});
