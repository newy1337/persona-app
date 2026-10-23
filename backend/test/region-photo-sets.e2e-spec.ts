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
  const now = 1_000;
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
    await prisma.tgAccount.create({
      data: {
        id: 4,
        phoneE164: '+10000000004',
        personaId: 'denis',
        addedAt: 1,
        status: 'active',
      },
    });
    await prisma.managerAccount.create({
      data: { userId: manager.id, tgAccountId: 4 },
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
    gate = new RegionGateService(prisma, clock as any);
    photos = new PhotoLibraryService(prisma, gate);
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

  it('хед назначает учётке несколько образов, сотрудник привязывает их к личностям; новый образ на ту же личность — только для новых собеседников', async () => {
    const autumn = await sets.create(head, 'Надя — образ 1');
    const winter = await sets.create(head, 'Надя — образ 2');
    const city = await sets.create(head, 'Денис — город');
    const foreign = await sets.create(otherHead, 'Надя Питер');
    await expect(
      sets.assignStaff(head, manager.id, [autumn.id, foreign.id]),
    ).rejects.toThrow(/этого региона/);
    await expect(
      sets.assignStaff(manager, manager.id, [autumn.id]),
    ).rejects.toThrow(/хед/);
    await expect(
      sets.assignStaff(otherHead, manager.id, [foreign.id]),
    ).rejects.toThrow(/не найден/);

    // Хед назначает три образа одной учётке: одна строка. Образы встают на
    // личность по имени сами; вторая «Надя» — в запас, Надя уже занята.
    await history.ensureContact(5001, 1);
    expect(await photos.setForChat(5001)).toBeNull();
    const view = await sets.assignStaff(head, manager.id, [
      autumn.id,
      winter.id,
      city.id,
    ]);
    expect(view.rows.filter((r) => r.user_id === manager.id)).toHaveLength(1);
    const row = view.rows.find((r) => r.user_id === manager.id)!;
    expect(row.sets.map((x) => [x.set_id, x.persona_slug])).toEqual([
      [autumn.id, 'nadya'],
      [winter.id, null],
      [city.id, 'denis'],
    ]);
    expect(row.personas.map((x) => x.slug)).toEqual(['denis', 'nadya']);

    // Сотрудник может привязать и сам (здесь — то же, что подставилось).
    await expect(
      sets.choosePersona(manager, autumn.id, 'nobody'),
    ).rejects.toThrow(/нет аккаунтов этой личности/);
    await expect(
      sets.choosePersona(manager, foreign.id, 'nadya'),
    ).rejects.toThrow(/не назначен/);
    await sets.choosePersona(manager, autumn.id, 'nadya');
    const mine = await sets.choosePersona(manager, city.id, 'denis');
    expect(mine.sets.map((x) => [x.set_name, x.persona_name])).toEqual([
      ['Надя — образ 1', 'Надя'],
      ['Надя — образ 2', null],
      ['Денис — город', 'Денис'],
    ]);
    await history.ensureContact(5002, 1);
    await history.ensureContact(5003, 4);
    expect((await photos.setForChat(5002))?.id).toBe(autumn.id);
    expect((await photos.setForChat(5003))?.id).toBe(city.id);
    // Диалог, начатый до привязки, закрепляется при первом обращении после неё.
    expect((await photos.setForChat(5001))?.id).toBe(autumn.id);

    // «Образ 2» на ту же Надю: он забирает новых собеседников, «образ 1»
    // уходит в запас, начатые на нём диалоги остаются на нём.
    const after = await sets.choosePersona(manager, winter.id, 'nadya');
    expect(after.sets.map((x) => [x.set_id, x.persona_slug])).toEqual([
      [autumn.id, null],
      [winter.id, 'nadya'],
      [city.id, 'denis'],
    ]);
    await history.ensureContact(5004, 1);
    expect((await photos.setForChat(5004))?.id).toBe(winter.id);
    expect((await photos.setForChat(5002))?.id).toBe(autumn.id);
    expect((await photos.setForChat(5001))?.id).toBe(autumn.id);
    expect((await photos.setForChat(5003))?.id).toBe(city.id);

    // В списке образов видно, кому назначен и на какой личности.
    const list = await sets.list(head);
    expect(list.items.find((x) => x.id === autumn.id)?.assigned_to).toEqual([
      { user_id: manager.id, username: 'mgr_msk', persona: null },
    ]);
    expect(list.items.find((x) => x.id === winter.id)?.assigned_to).toEqual([
      { user_id: manager.id, username: 'mgr_msk', persona: 'Надя' },
    ]);

    // Хед снимает «город»: Денис без образа для новых, начатый диалог остаётся.
    await sets.assignStaff(head, manager.id, [autumn.id, winter.id]);
    await history.ensureContact(5005, 4);
    expect(await photos.setForChat(5005)).toBeNull();
    expect((await photos.setForChat(5003))?.id).toBe(city.id);
    // Оставшиеся образы сохранили привязку.
    expect(
      (await sets.mine(manager)).sets.map((x) => [x.set_id, x.persona_slug]),
    ).toEqual([
      [autumn.id, null],
      [winter.id, 'nadya'],
    ]);

    // Снять все — образов нет; сотруднику без назначения образа нет.
    await sets.assignStaff(head, manager.id, []);
    expect((await sets.mine(manager)).sets).toEqual([]);
    await history.ensureContact(5006, 1);
    expect(await photos.setForChat(5006)).toBeNull();
    await history.ensureContact(5007, 2);
    expect(await photos.setForChat(5007)).toBeNull();
  });

  it('двадцать образов на одну учётку — можно', async () => {
    const many = [];
    for (let i = 0; i < 20; i++)
      many.push((await sets.create(head, `Пачка ${i}`)).id);
    const view = await sets.assignStaff(head, manager.id, many);
    expect(view.rows.find((r) => r.user_id === manager.id)!.sets).toHaveLength(
      20,
    );
    await sets.assignStaff(head, manager.id, []);
  });

  it('a set cannot be deleted while assigned or while any of its chats is still going', async () => {
    const set = await sets.create(head, 'Надя — на удаление');
    await sets.assignStaff(head, manager.id, [set.id]);
    await sets.choosePersona(manager, set.id, 'nadya');
    await history.ensureContact(6001, 1);
    await history.ensureContact(6002, 1);
    await expect(sets.remove(set.id)).rejects.toThrow(/назначен сотрудникам/);

    const other = await sets.create(head, 'Надя — новый');
    await sets.assignStaff(head, manager.id, [other.id]);
    await sets.choosePersona(manager, other.id, 'nadya');
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

  it('the region stop switches off photo sets of that region only; chats keep their set for later', async () => {
    const set = await sets.create(head, 'Надя — стоп');
    await sets.assignStaff(head, manager.id, [set.id]);
    await sets.choosePersona(manager, set.id, 'nadya');
    await history.ensureContact(7001, 1);
    expect((await photos.setForChat(7001))?.id).toBe(set.id);

    await gate.engage('MSK', head.id);
    expect(await gate.photosOff(1)).toBe(true);
    expect(await gate.photosOff(2)).toBe(false);
    expect(await photos.setForChat(7001)).toBeNull();
    // Новый собеседник во время стопа всё равно закрепляется за образом.
    await history.ensureContact(7002, 1);
    expect(await photos.setForChat(7002)).toBeNull();

    await gate.clear('MSK');
    expect((await photos.setForChat(7001))?.id).toBe(set.id);
    expect((await photos.setForChat(7002))?.id).toBe(set.id);
  });
});
