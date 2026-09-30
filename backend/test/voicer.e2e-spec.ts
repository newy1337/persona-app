import { useTestDatabase } from './database';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

const dir = mkdtempSync(resolve(tmpdir(), 'voicer-e2e-'));
process.env.DATA_DIR = dir;
process.env.JWT_SECRET = 'voicer-test-only';
process.env.SESSION_ENC_KEY = 'ab'.repeat(32);
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-only';
process.env.TG_API_ID = '';
process.env.TG_API_HASH = '';
process.env.VOICER_BOT_TOKEN = '';
process.env.PERSONAS_DIR = resolve(__dirname, 'fixtures/personas');
useTestDatabase('voicer');

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { VoicerService } from '../src/modules/voicer/voicer.service';
import { VoicerBotService } from '../src/modules/voicer/voicer-bot.service';
import { randomUUID } from 'crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import { RelayWorker } from '../src/modules/telegram/relay.worker';
import { HistoryService } from '../src/shared/history.service';
import { ClockService } from '../src/shared/clock.service';
import { VoicerDeliveryService } from '../src/modules/voicer/voicer-delivery.service';
import { VoiceEncoderService } from '../src/modules/media/voice-encoder.service';

describe('Voicer workflow against a real migrated database', () => {
  let app: INestApplication,
    prisma: PrismaService,
    service: VoicerService,
    bot: VoicerBotService;
  let admin: string,
    manager: string,
    other: string,
    voice: string,
    voice2: string;
  let managerId: number, voiceId: number, otherId: number, voiceId2: number;
  let chatAccountId: number;
  const unassignedAccounts: number[] = [];
  async function unassignedChat() {
    const account = await prisma.tgAccount.create({
      data: { phoneE164: '+10000000666', personaId: 'nastya', addedAt: 1 },
    });
    unassignedAccounts.push(account.id);
    await prisma.contact.createMany({
      data: [
        { chatId: 666n, accountId: account.id },
        { chatId: 667n, accountId: account.id },
      ],
    });
    await prisma.message.createMany({
      data: [
        { chatId: 666n, role: 'user', text: 'Выбранный диалог', ts: 1 },
        { chatId: 667n, role: 'user', text: 'Другой диалог аккаунта', ts: 1 },
      ],
    });
    return account;
  }
  let seq = 100;
  const api = jest.fn<Promise<any>, [string, any]>(async (method) =>
    method === 'getMe'
      ? { username: 'test_bot' }
      : method === 'getWebhookInfo'
        ? {}
        : { message_id: ++seq },
  );
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  async function createUser(username: string, role: string, extra = {}) {
    const r = await request(app.getHttpServer())
      .post('/api/managers')
      .set(auth(admin))
      .send({
        username,
        role,
        password: 'test-password-123',
        ...(role === 'manager' ? { region_code: '0077' } : {}),
        ...extra,
      })
      .expect(200);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'test-password-123' })
      .expect(200);
    return { id: r.body.created_user_id, token: login.body.tokens.accessToken };
  }
  const payload = (extra = {}) => ({
    kind: 'voice',
    voice_mode: 'library',
    persona_slug: 'nastya',
    title: 'Для Димы · Доброе утро',
    contact_label: 'Дима',
    script: 'Доброе утро!',
    emotion: 'С улыбкой',
    ...extra,
  });
  async function task(token = manager, extra = {}) {
    return (
      await request(app.getHttpServer())
        .post('/api/voicer/tasks')
        .set(auth(token))
        .send(payload(extra))
        .expect(200)
    ).body;
  }
  async function act(
    token: string,
    id: number,
    action: string,
    revision = 1,
    note = '',
  ) {
    return request(app.getHttpServer())
      .post(`/api/voicer/tasks/${id}/action`)
      .set(auth(token))
      .send({ action, revision, note });
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(VoiceEncoderService)
      .useValue({
        probe: jest.fn(async () => ({
          codec: 'opus',
          format: 'ogg',
          channels: 1,
          duration: 2,
        })),
        prepare: jest.fn(async (path) => ({
          path,
          temporary: false,
          duration: 2,
        })),
        cleanup: jest.fn(),
      })
      .overrideProvider(RelayWorker)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    for (const job of module.get(SchedulerRegistry).getCronJobs().values())
      job.stop();
    prisma = module.get(PrismaService);
    service = module.get(VoicerService);
    bot = module.get(VoicerBotService);
    jest.spyOn(bot, 'api').mockImplementation(api);
    bot.username = 'test_bot';
    admin = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'admin', password: 'test-admin-only' })
    ).body.tokens.accessToken;
    ({ id: voiceId, token: voice } = await createUser('voice', 'voice'));
    ({ id: voiceId2, token: voice2 } = await createUser('voice2', 'voice'));
    ({ id: managerId, token: manager } = await createUser(
      'manager',
      'manager',
      { voicer_id: voiceId },
    ));
    ({ id: otherId, token: other } = await createUser('other', 'manager', {
      voicer_id: voiceId2,
    }));
    const account = await prisma.tgAccount.create({
      data: {
        phoneE164: '+10000000444',
        personaId: 'nastya',
        addedAt: 1,
        manager: { create: { userId: managerId } },
      },
    });
    chatAccountId = account.id;
    await prisma.contact.createMany({
      data: [
        { chatId: 444n, accountId: account.id, managerSeenTs: 17 },
        { chatId: 445n, accountId: account.id },
      ],
    });
    await prisma.leadFacts.create({
      data: {
        chatId: 444n,
        facts: JSON.stringify({ name: 'Дима', city: 'Казань' }),
      },
    });
    const foreign = await prisma.tgAccount.create({
      data: {
        phoneE164: '+10000000555',
        personaId: 'nastya',
        addedAt: 1,
        manager: { create: { userId: otherId } },
      },
    });
    await prisma.contact.create({
      data: { chatId: 555n, accountId: foreign.id },
    });
  });
  afterEach(async () => {
    await prisma.pendingReply.deleteMany();
    await prisma.tgAccount.update({
      where: { id: chatAccountId },
      data: { status: 'unauthorized' },
    });
    await prisma.voiceTask.deleteMany();
    await prisma.message.deleteMany();
    await prisma.contact.deleteMany({
      where: { accountId: { in: unassignedAccounts } },
    });
    await prisma.tgAccount.deleteMany({
      where: { id: { in: unassignedAccounts } },
    });
    unassignedAccounts.length = 0;
    api.mockClear();
    delete process.env.VOICER_PANEL_URL;
  });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('assigns a voicer on manager creation and rejects wrong roles', async () => {
    const r = await request(app.getHttpServer())
      .get('/api/managers')
      .set(auth(admin))
      .expect(200);
    expect(r.body.items.find((u) => u.user_id === managerId)).toMatchObject({
      voicer_id: voiceId,
      voicer_username: 'voice',
    });
    await request(app.getHttpServer())
      .put(`/api/managers/${managerId}`)
      .set(auth(admin))
      .send({ voicer_id: otherId })
      .expect(422);
    await request(app.getHttpServer())
      .put(`/api/managers/${managerId}`)
      .set(auth(manager))
      .send({ voicer_id: voiceId2 })
      .expect(403);
  });

  it('snapshots full biography and takes the manager assignment server-side', async () => {
    const t = await task(manager, { manager_id: otherId, voicer_id: voiceId2 });
    expect(t).toMatchObject({
      managerId,
      voicerId: voiceId,
      status: 'queued',
      revision: 1,
    });
    expect(t.biography.length).toBeGreaterThan(100);
    const detail = await request(app.getHttpServer())
      .get(`/api/voicer/tasks/${t.id}`)
      .set(auth(voice))
      .expect(200);
    expect(detail.body.biography).toBe(t.biography);
    expect(JSON.stringify(t)).not.toMatch(/passwordHash|telegramId|botChatId/);
  });

  it('isolates tasks, profiles, library and the legacy unassigned queue', async () => {
    const t = await task();
    for (const token of [other, voice2]) {
      await request(app.getHttpServer())
        .get(`/api/voicer/tasks/${t.id}`)
        .set(auth(token))
        .expect(404);
      expect((await act(token, t.id, 'claim')).status).toBe(404);
      const list = await request(app.getHttpServer())
        .get('/api/voicer/tasks')
        .set(auth(token))
        .expect(200);
      expect(list.body.total).toBe(0);
    }
    await request(app.getHttpServer()).get('/api/voicer/tasks').expect(401);
    await request(app.getHttpServer())
      .post('/api/voicer/tasks')
      .set(auth(voice))
      .send(payload())
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/voicer/users/${voiceId}/link`)
      .set(auth(manager))
      .send({})
      .expect(403);
  });

  it('requires complete instructions and validates conversation ownership', async () => {
    for (const extra of [
      { script: '' },
      { emotion: '' },
      { title: '   ' },
      { chat_id: '1234' },
      { kind: 'call' },
    ]) {
      const r = await request(app.getHttpServer())
        .post('/api/voicer/tasks')
        .set(auth(manager))
        .send(payload(extra));
      expect([400, 404]).toContain(r.status);
    }
    expect(await prisma.voiceTask.count()).toBe(0);
  });

  it('uses expiring one-time links and prevents Telegram account reuse', async () => {
    const link = (
      await request(app.getHttpServer())
        .post(`/api/voicer/users/${voiceId}/link`)
        .set(auth(voice))
        .send({})
        .expect(200)
    ).body.url.split('bind_')[1];
    expect(
      (await prisma.voicerProfile.findUnique({ where: { userId: voiceId } }))
        ?.linkHash,
    ).not.toContain(link);
    await service.bind(link, 90001n, 'recording_artist');
    await expect(service.bind(link, 90002n, null)).rejects.toThrow();
    const second = await service.link(
      await prisma.dashboardUser.findUniqueOrThrow({ where: { id: voiceId2 } }),
      voiceId2,
      'test_bot',
    );
    await expect(
      service.bind(second.url.split('bind_')[1], 90001n, null),
    ).rejects.toThrow('уже связан');
    await prisma.voicerProfile.update({
      where: { userId: voiceId2 },
      data: { linkExpiresAt: 1 },
    });
    await expect(
      service.bind(second.url.split('bind_')[1], 90002n, null),
    ).rejects.toThrow('истекла');
  });

  it('allows only one active task per voicer even for simultaneous claims', async () => {
    const a = await task(),
      b = await task();
    const results = await Promise.all([
      act(voice, a.id, 'claim'),
      act(voice, b.id, 'claim'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.voiceTask.count({ where: { status: 'in_progress' } }),
    ).toBe(1);
  });

  it('stores one recording per Telegram message and revision, with scoped file access', async () => {
    const t = await task();
    expect((await act(voice, t.id, 'claim')).status).toBe(200);
    const user = await prisma.dashboardUser.findUniqueOrThrow({
      where: { id: voiceId },
    });
    const id = await service.record(
      user,
      t.id,
      1,
      90001n,
      777,
      Buffer.from('test-encoder-input'),
    );
    expect(
      await service.record(
        user,
        t.id,
        1,
        90001n,
        777,
        Buffer.from('test-encoder-input'),
      ),
    ).toBe(id);
    expect(await prisma.voiceRecording.count()).toBe(1);
    const completed = await prisma.voiceTask.findUniqueOrThrow({
      where: { id: t.id },
    });
    expect(completed.status).toBe('completed');
    for (const token of [other, voice2])
      await request(app.getHttpServer())
        .get(`/api/voicer/recordings/${id}/file`)
        .set(auth(token))
        .expect(404);
    await request(app.getHttpServer())
      .get(`/api/voicer/recordings/${id}/file`)
      .set(auth(manager))
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/voicer/recordings/${id}`)
      .set(auth(manager))
      .send({ title: 'Утро для Димы' })
      .expect(200);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/voicer/recordings?q=Утро')
          .set(auth(manager))
      ).body.items[0].title,
    ).toBe('Утро для Димы');
    expect(
      (await act(manager, t.id, 'revise', 1, 'Медленнее, пожалуйста')).status,
    ).toBe(200);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/voicer/recordings')
          .set(auth(manager))
      ).body.items[0].current,
    ).toBe(false);
    expect((await act(voice, t.id, 'claim', 1)).status).toBe(409);
    expect((await act(voice, t.id, 'claim', 2)).status).toBe(200);
    await service.record(
      user,
      t.id,
      2,
      90001n,
      778,
      Buffer.from('new-test-encoder-input'),
    );
    expect(await prisma.voiceRecording.count()).toBe(2);
  });

  it('rejects stale/cancelled uploads without creating files or recordings', async () => {
    const t = await task();
    await act(voice, t.id, 'claim');
    await act(manager, t.id, 'cancel');
    const user = await prisma.dashboardUser.findUniqueOrThrow({
      where: { id: voiceId },
    });
    await expect(
      service.record(user, t.id, 1, 90001n, 779, Buffer.from('test')),
    ).rejects.toThrow('изменилось');
    expect(await prisma.voiceRecording.count()).toBe(0);
  });

  it('sends full call biography and records manual call outcome', async () => {
    const t = await task(manager, {
      kind: 'call',
      contact_ref: '@synthetic_contact',
      tempo: 'Спокойно',
      instructions: 'Обсудить организационные вопросы',
    });
    const raw = await prisma.voiceTask.findUniqueOrThrow({
      where: { id: t.id },
    });
    await bot.deliver(raw, 90001n);
    const doc = api.mock.calls.find(
      ([method]) => method === 'sendDocument',
    )?.[1] as FormData;
    expect(await (doc.get('document') as Blob).text()).toContain(raw.biography);
    expect((await act(voice, t.id, 'claim')).status).toBe(200);
    expect(
      (await act(voice, t.id, 'complete', 1, 'Договорились созвониться завтра'))
        .status,
    ).toBe(200);
    expect(
      (await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }))
        .outcome,
    ).toContain('завтра');
  });

  it('does not bind or reveal briefs in groups or to unassigned users', async () => {
    await bot.handle({
      message: {
        chat: { id: -5, type: 'group' },
        from: { id: 90001 },
        text: '/tasks',
      },
    });
    expect(api).not.toHaveBeenCalled();
    const t = await task();
    await bot.handle({
      callback_query: {
        id: 'x',
        from: { id: 90002 },
        message: { chat: { id: 90002, type: 'private' } },
        data: `vw:bio:${t.id}:1`,
      },
    });
    expect(api.mock.calls.some(([method]) => method === 'sendDocument')).toBe(
      false,
    );
  });

  it('requires audio to reply to the selected task and acknowledges a persisted duplicate', async () => {
    const t = await task();
    await act(voice, t.id, 'claim');
    const user = await prisma.dashboardUser.findUniqueOrThrow({
      where: { id: voiceId },
    });
    await bot.handle({
      message: {
        message_id: 800,
        chat: { id: 90001, type: 'private' },
        from: { id: 90001 },
        voice: { file_id: 'test' },
      },
    });
    expect(
      api.mock.calls.some(
        ([method, p]: any) =>
          method === 'sendMessage' && p.text.includes('ОТВЕТОМ'),
      ),
    ).toBe(true);
    await service.record(user, t.id, 1, 90001n, 801, Buffer.from('test'));
    await bot.handle({
      message: {
        message_id: 801,
        chat: { id: 90001, type: 'private' },
        from: { id: 90001 },
        voice: { file_id: 'test' },
      },
    });
    expect(
      api.mock.calls.some(
        ([method, p]: any) =>
          method === 'sendMessage' && p.text.includes('уже сохранена'),
      ),
    ).toBe(true);
  });

  it('routes a Telegram voice reply through the complete assigned-task workflow', async () => {
    const t = await task();
    await bot.handle({
      callback_query: {
        id: 'claim',
        from: { id: 90001 },
        message: { chat: { id: 90001, type: 'private' } },
        data: `vw:claim:${t.id}:1`,
      },
    });
    const raw = await prisma.voiceTask.findUniqueOrThrow({
      where: { id: t.id },
    });
    expect(raw.status).toBe('in_progress');
    expect(raw.botMessageId).toBeTruthy();
    const download = jest
      .spyOn(bot as any, 'download')
      .mockResolvedValue(Buffer.from('synthetic-encoded-audio'));
    await bot.handle({
      message: {
        message_id: 805,
        chat: { id: 90001, type: 'private' },
        from: { id: 90001 },
        voice: { file_id: 'synthetic' },
        reply_to_message: { message_id: raw.botMessageId },
      },
    });
    expect(await prisma.voiceRecording.count({ where: { taskId: t.id } })).toBe(
      1,
    );
    expect(
      (await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }))
        .status,
    ).toBe('completed');
    expect(
      api.mock.calls.some(
        ([method, p]: any) =>
          method === 'sendMessage' &&
          p.text.includes(`Задание #${t.id} выполнено`),
      ),
    ).toBe(true);
    download.mockRestore();
  });

  it('keeps pending tasks assigned to the original voicer and releases a claimed task', async () => {
    const old = await task();
    await request(app.getHttpServer())
      .put(`/api/managers/${managerId}`)
      .set(auth(admin))
      .send({ voicer_id: voiceId2 })
      .expect(200);
    const newer = await task();
    expect(newer.voicerId).toBe(voiceId2);
    expect((await act(voice2, old.id, 'claim')).status).toBe(404);
    expect((await act(voice, old.id, 'claim')).status).toBe(200);
    expect((await act(voice, old.id, 'release')).status).toBe(200);
    expect(
      (await prisma.voiceTask.findUniqueOrThrow({ where: { id: old.id } }))
        .status,
    ).toBe('queued');
    await request(app.getHttpServer())
      .put(`/api/managers/${managerId}`)
      .set(auth(admin))
      .send({ voicer_id: voiceId })
      .expect(200);
  });

  it('persists notification retry state and update offset across service instances', async () => {
    const t = await task();
    await prisma.voicerBotState.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: { nextUpdateId: 0 },
    });
    (bot as any).token = 'test-token';
    api.mockImplementation(async (method: string, p: any) => {
      if (method === 'getUpdates')
        return p.offset === 0 ? [{ update_id: 41 }] : [];
      if (method === 'sendMessage')
        throw Object.assign(new Error('unavailable'), { code: 403 });
      return { message_id: ++seq };
    });
    await bot.tick();
    expect(
      (await prisma.voicerBotState.findUniqueOrThrow({ where: { id: 1 } }))
        .nextUpdateId,
    ).toBe(42);
    const row = await prisma.voiceTask.findUniqueOrThrow({
      where: { id: t.id },
    });
    expect(row.notifyError).toContain('заблокирован');
    expect(row.notifyAfter).toBeGreaterThan(0);
    const recreated = new VoicerService(
      prisma,
      (service as any).clock,
      (service as any).scope,
      (service as any).encoder,
      (service as any).delivery,
    );
    expect(
      (
        await recreated.task(
          await prisma.dashboardUser.findUniqueOrThrow({
            where: { id: managerId },
          }),
          t.id,
        )
      ).status,
    ).toBe('queued');
    (bot as any).token = '';
    api.mockImplementation(async () => ({ message_id: ++seq }));
  });

  it('exposes chat only for calls to the assigned voicer, without marking seen', async () => {
    await prisma.message.createMany({
      data: [
        { chatId: 444n, ts: 100, role: 'user', text: 'Привет' },
        {
          chatId: 444n,
          ts: 101,
          role: 'assistant',
          author: 'operator:web',
          text: 'Ответ менеджера',
        },
        {
          chatId: 444n,
          ts: 102,
          role: 'assistant',
          author: 'llm',
          text: 'Ответ бота',
        },
        {
          chatId: 444n,
          ts: 103,
          role: 'system',
          text: 'private internal context',
        },
      ],
    });
    for (const kind of ['voice', 'call']) {
      const t = await task(manager, {
        chat_id: '444',
        kind,
        contact_ref: '@test',
        tempo: 'Спокойно',
        instructions: 'Поговорить',
      });
      for (const token of [
        ...(kind === 'call' ? [voice] : []),
        manager,
        admin,
      ]) {
        const r = await request(app.getHttpServer())
          .get(`/api/voicer/tasks/${t.id}/conversation`)
          .set(auth(token))
          .expect(200);
        expect(r.body.items.map((m) => m.text)).toEqual([
          'Привет',
          'Ответ менеджера',
          'Ответ бота',
        ]);
        expect(JSON.stringify(r.body)).not.toMatch(
          /filePath|inboundPayload|sessionEncrypted/,
        );
      }
      for (const token of [other, voice2])
        await request(app.getHttpServer())
          .get(`/api/voicer/tasks/${t.id}/conversation`)
          .set(auth(token))
          .expect(404);
      await request(app.getHttpServer())
        .get(`/api/voicer/tasks/${t.id}/conversation`)
        .expect(401);
      await act(voice, t.id, 'claim');
      await request(app.getHttpServer())
        .get(`/api/voicer/tasks/${t.id}/conversation`)
        .set(auth(voice))
        .expect(kind === 'call' ? 200 : 404);
      await act(voice, t.id, 'release');
    }
    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { chatId: 444n } }))
        .managerSeenTs,
    ).toBe(17);
    await request(app.getHttpServer())
      .get('/api/conversations/444')
      .set(auth(voice))
      .expect(403);
  });

  it('does not let a permanently rejected bot update block the entire queue', async () => {
    await prisma.voicerBotState.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: { nextUpdateId: 0 },
    });
    (bot as any).token = 'test-token';
    const handle = jest
      .spyOn(bot, 'handle')
      .mockImplementation(async (update) => {
        if (update.update_id === 51)
          throw Object.assign(new Error('recipient blocked bot'), {
            code: 403,
          });
      });
    api.mockImplementation(async (method) =>
      method === 'getUpdates'
        ? [{ update_id: 51 }, { update_id: 52 }]
        : { message_id: ++seq },
    );
    try {
      await bot.tick();
      expect(handle).toHaveBeenCalledWith({ update_id: 52 });
      expect(
        (await prisma.voicerBotState.findUniqueOrThrow({ where: { id: 1 } }))
          .nextUpdateId,
      ).toBe(53);
    } finally {
      handle.mockRestore();
      (bot as any).token = '';
      api.mockImplementation(async () => ({ message_id: ++seq }));
    }
  });

  it('does not delete a manager or voicer while a voice delivery still needs resolution', async () => {
    const t = await task();
    for (const status of ['delivering', 'delivery_error', 'delivery_review']) {
      await prisma.voiceTask.update({ where: { id: t.id }, data: { status } });
      for (const id of [managerId, voiceId]) {
        await request(app.getHttpServer())
          .delete(`/api/managers/${id}`)
          .set(auth(admin))
          .expect(409);
        await request(app.getHttpServer())
          .put(`/api/managers/${id}`)
          .set(auth(admin))
          .send({ role: 'admin' })
          .expect(409);
      }
    }
  });

  it('pages tied timestamps with large message IDs and returns new, edited and deleted messages on refresh', async () => {
    const t = await task(manager, {
      kind: 'call',
      contact_ref: '@test',
      tempo: 'Спокойно',
      instructions: 'Поговорить',
      chat_id: '444',
    });
    await prisma.message.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        id: 20000 + i,
        chatId: 444n,
        ts: 100,
        role: 'user',
        text: `message-${i}`,
      })),
    });
    const url = `/api/voicer/tasks/${t.id}/conversation`;
    const first = (
      await request(app.getHttpServer()).get(url).set(auth(voice)).expect(200)
    ).body;
    expect(first.items).toHaveLength(100);
    expect(first.next_before).toBe(20005);
    const older = (
      await request(app.getHttpServer())
        .get(`${url}?before=${first.next_before}`)
        .set(auth(voice))
        .expect(200)
    ).body;
    expect(older.items.map((m) => m.id)).toEqual([
      20000, 20001, 20002, 20003, 20004,
    ]);
    expect(older.next_before).toBeNull();
    await prisma.message.update({
      where: { id: 20104 },
      data: { text: 'Исправлено', editedAt: 200 },
    });
    await prisma.message.update({
      where: { id: 20103 },
      data: { deletedAt: 201 },
    });
    await prisma.message.create({
      data: {
        chatId: 444n,
        ts: 300,
        role: 'assistant',
        text: 'Новое во время звонка',
      },
    });
    const fresh = (
      await request(app.getHttpServer()).get(url).set(auth(voice)).expect(200)
    ).body;
    expect(fresh.items.at(-1).text).toBe('Новое во время звонка');
    expect(fresh.items.find((m) => m.id === 20104).text).toBe('Исправлено');
    expect(fresh.items.find((m) => m.id === 20103)).toMatchObject({
      text: '',
      has_file: false,
      deletedAt: 201,
    });
    for (const cursor of ['-1', 'foo', '999999'])
      await request(app.getHttpServer())
        .get(`${url}?before=${cursor}`)
        .set(auth(voice))
        .expect(400);
  });

  it('revokes conversation access after cancellation, account reassignment or a persona change', async () => {
    const t = await task(manager, {
        kind: 'call',
        contact_ref: '@test',
        tempo: 'Спокойно',
        instructions: 'Поговорить',
        chat_id: '444',
      }),
      url = `/api/voicer/tasks/${t.id}/conversation`;
    await prisma.managerAccount.update({
      where: { tgAccountId: chatAccountId },
      data: { userId: otherId },
    });
    await request(app.getHttpServer()).get(url).set(auth(voice)).expect(404);
    await prisma.managerAccount.update({
      where: { tgAccountId: chatAccountId },
      data: { userId: managerId },
    });
    await prisma.tgAccount.update({
      where: { id: chatAccountId },
      data: { personaId: 'different-persona' },
    });
    await request(app.getHttpServer()).get(url).set(auth(voice)).expect(404);
    await prisma.tgAccount.update({
      where: { id: chatAccountId },
      data: { personaId: 'nastya' },
    });
    await act(manager, t.id, 'cancel');
    await request(app.getHttpServer()).get(url).set(auth(voice)).expect(404);
  });

  it('serves a current scoped call brief and does not expose deleted memory evidence or engine internals', async () => {
    const t = await task(manager, {
      kind: 'call',
      chat_id: '444',
      tempo: 'Спокойно',
      instructions: 'Обсудить увлечения',
    });
    const m = await prisma.message.create({
      data: { chatId: 444n, role: 'user', text: 'Люблю горы', ts: 200 },
    });
    await prisma.brainState.upsert({
      where: { chatId: 444n },
      create: { chatId: 444n, updatedAt: 200, stateJson: '{}' },
      update: {},
    });
    try {
      await prisma.brainState.update({
        where: { chatId: 444n },
        data: {
          stateJson: JSON.stringify({
            character: { slots: { name: 'Дима', hobby: 'Походы' } },
            memories: [
              {
                kind: 'preference',
                text: 'Любит горы',
                status: 'active',
                source_message_ids: [m.id],
              },
            ],
            judge: { guidance: 'private-engine-instruction' },
          }),
        },
      });
      const url = `/api/voicer/tasks/${t.id}/brief`;
      const r = await request(app.getHttpServer())
        .get(url)
        .set(auth(voice))
        .expect(200)
        .expect('cache-control', 'private, no-store');
      expect(JSON.stringify(r.body)).toContain('Пхукете');
      expect(JSON.stringify(r.body)).toContain('Походы');
      expect(r.body.interlocutor.preferences[0].text).toBe('Любит горы');
      expect(JSON.stringify(r.body)).not.toContain(
        'private-engine-instruction',
      );
      for (const token of [other, voice2])
        await request(app.getHttpServer())
          .get(url)
          .set(auth(token))
          .expect(404);
      await prisma.message.update({
        where: { id: m.id },
        data: { deletedAt: 201 },
      });
      const changed = (
        await request(app.getHttpServer()).get(url).set(auth(voice)).expect(200)
      ).body;
      expect(changed.interlocutor.preferences).toEqual([]);
      expect(changed.recent).toEqual([]);
      await act(manager, t.id, 'cancel');
      await request(app.getHttpServer()).get(url).set(auth(voice)).expect(404);
      const recording = await task();
      await request(app.getHttpServer())
        .get(`/api/voicer/tasks/${recording.id}/brief`)
        .set(auth(voice))
        .expect(404);
    } finally {
      await prisma.brainState.deleteMany({ where: { chatId: 444n } });
    }
  });

  it('restricts attachments to the task conversation, excluding deleted files and filesystem escapes', async () => {
    mkdirSync(`${dir}/media`, { recursive: true });
    writeFileSync(`${dir}/media/example.ogg`, 'test-audio');
    writeFileSync(`${dir}/secret.txt`, 'never expose');
    symlinkSync(`${dir}/secret.txt`, `${dir}/media/escape.txt`);
    const t = await task(manager, {
      kind: 'call',
      contact_ref: '@test',
      tempo: 'Спокойно',
      instructions: 'Поговорить',
      chat_id: '444',
    });
    const make = (
      chatId: bigint,
      filePath: string,
      deletedAt: number | null = null,
    ) =>
      prisma.message.create({
        data: {
          chatId,
          filePath,
          deletedAt,
          ts: 1,
          role: 'user',
          text: '',
          mediaKind: 'voice',
        },
      });
    const good = await make(444n, `${dir}/media/example.ogg`);
    const url = (id: number) =>
      `/api/voicer/tasks/${t.id}/conversation/files/${id}`;
    await request(app.getHttpServer())
      .get(url(good.id))
      .set(auth(voice))
      .expect(200)
      .expect('cache-control', 'private, no-store');
    await request(app.getHttpServer())
      .get(url(good.id))
      .set(auth(voice2))
      .expect(404);
    for (const m of [
      await make(445n, `${dir}/media/example.ogg`),
      await make(444n, `${dir}/media/example.ogg`, 9),
      await make(444n, `${dir}/secret.txt`),
      await make(444n, `${dir}/media/escape.txt`),
    ]) {
      await request(app.getHttpServer())
        .get(url(m.id))
        .set(auth(voice))
        .expect(404);
    }
  });

  it('scopes the conversation chooser to the selected manager and persona', async () => {
    const own = (
      await request(app.getHttpServer())
        .get(
          `/api/voicer/conversations?manager_id=${otherId}&persona=nastya&q=Дима`,
        )
        .set(auth(manager))
        .expect(200)
    ).body;
    expect(own.items.map((i) => i.chat_id)).toEqual(['444']);
    const adminOther = (
      await request(app.getHttpServer())
        .get(`/api/voicer/conversations?manager_id=${otherId}`)
        .set(auth(admin))
        .expect(200)
    ).body;
    expect(adminOther.items.map((i) => i.chat_id)).toEqual(['555']);
    await request(app.getHttpServer())
      .get('/api/voicer/conversations')
      .set(auth(voice))
      .expect(403);
  });

  it('links a queued task to an owned conversation but forbids changing the chat during work', async () => {
    const t = await task(manager, {
        kind: 'call',
        contact_ref: '@test',
        tempo: 'Спокойно',
        instructions: 'Поговорить',
      }),
      url = `/api/voicer/tasks/${t.id}/conversation`;
    expect(
      (await request(app.getHttpServer()).get(url).set(auth(voice)).expect(200))
        .body.chat_id,
    ).toBeNull();
    await request(app.getHttpServer())
      .put(url)
      .set(auth(voice))
      .send({ chat_id: '444' })
      .expect(403);
    await request(app.getHttpServer())
      .put(url)
      .set(auth(manager))
      .send({ chat_id: '555' })
      .expect(404);
    await request(app.getHttpServer())
      .put(url)
      .set(auth(other))
      .send({ chat_id: '555' })
      .expect(404);
    await request(app.getHttpServer())
      .put(url)
      .set(auth(manager))
      .send({ chat_id: '444' })
      .expect(200);
    await act(voice, t.id, 'claim');
    await request(app.getHttpServer())
      .put(url)
      .set(auth(manager))
      .send({ chat_id: '445' })
      .expect(409);
  });

  it('includes authenticated cabinet links in queued and active call/voice bot messages', async () => {
    process.env.VOICER_PANEL_URL = 'https://test.example';
    for (const kind of ['voice', 'call']) {
      const t = await task(manager, {
        chat_id: '444',
        kind,
        contact_ref: '@test',
        tempo: 'Спокойно',
        instructions: 'Поговорить',
      });
      await bot.deliver(
        await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }),
        90001n,
      );
      let sent = api.mock.calls
        .filter(([method]) => method === 'sendMessage')
        .at(-1)![1];
      expect(
        JSON.stringify(sent.reply_markup).includes(
          `https://test.example/voice?task=${t.id}&view=chat`,
        ),
      ).toBe(kind === 'call');
      await act(voice, t.id, 'claim');
      await bot.deliver(
        await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }),
        90001n,
      );
      sent = api.mock.calls
        .filter(([method]) => method === 'sendMessage')
        .at(-1)![1];
      expect(
        JSON.stringify(sent).includes(
          `https://test.example/voice?task=${t.id}&view=chat`,
        ),
      ).toBe(kind === 'call');
      if (kind === 'voice') expect(sent.reply_markup.force_reply).toBe(true);
      await act(voice, t.id, 'release');
    }
  });

  it('allows an admin to queue voice and call tasks from an unassigned chat without reassigning the account', async () => {
    const account = await unassignedChat();
    for (const kind of ['voice', 'call']) {
      const t = await task(admin, {
        manager_id: managerId,
        kind,
        chat_id: '666',
        contact_ref: '@example',
        tempo: 'Спокойно',
        instructions: 'Поговорить',
      });
      const row = await prisma.voiceTask.findUniqueOrThrow({
        where: { id: t.id },
      });
      expect(row).toMatchObject({
        chatGrantAccountId: account.id,
        chatGrantedById: expect.any(Number),
        managerId,
        voicerId: voiceId,
      });
      expect(t).not.toHaveProperty('chatGrantedById');
      for (const token of [...(kind === 'call' ? [voice] : []), manager]) {
        const r = await request(app.getHttpServer())
          .get(`/api/voicer/tasks/${t.id}/conversation`)
          .set(auth(token))
          .expect(200);
        expect(r.body.items.map((m) => m.text)).toEqual(['Выбранный диалог']);
      }
      const foreignMessage = await prisma.message.findFirstOrThrow({
        where: { chatId: 667n },
      });
      await request(app.getHttpServer())
        .get(
          `/api/voicer/tasks/${t.id}/conversation/files/${foreignMessage.id}`,
        )
        .set(auth(voice))
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/voicer/tasks/${t.id}/conversation`)
        .set(auth(voice2))
        .expect(404);
      await request(app.getHttpServer())
        .get('/api/conversations/666')
        .set(auth(manager))
        .expect(404);
      await act(voice, t.id, 'claim');
      await request(app.getHttpServer())
        .get(`/api/voicer/tasks/${t.id}/conversation`)
        .set(auth(voice))
        .expect(kind === 'call' ? 200 : 404);
      await act(voice, t.id, 'release');
    }
    expect(
      await prisma.managerAccount.findUnique({
        where: { tgAccountId: account.id },
      }),
    ).toBeNull();
  });

  it('shows unassigned chats only to admins and rejects forged manager grants', async () => {
    const account = await unassignedChat();
    const url = `/api/voicer/conversations?manager_id=${managerId}&persona=nastya`;
    const visible = (
      await request(app.getHttpServer()).get(url).set(auth(admin)).expect(200)
    ).body.items;
    expect(visible.find((i) => i.chat_id === '666')).toMatchObject({
      unassigned: true,
    });
    const hidden = (
      await request(app.getHttpServer()).get(url).set(auth(manager)).expect(200)
    ).body.items;
    expect(hidden.some((i) => i.chat_id === '666' || i.chat_id === '667')).toBe(
      false,
    );
    await request(app.getHttpServer())
      .post('/api/voicer/tasks')
      .set(auth(manager))
      .send(
        payload({
          chat_id: '666',
          chatGrantAccountId: account.id,
          chatGrantedById: 1,
        }),
      )
      .expect(404);
    const wrongOwner = await request(app.getHttpServer())
      .post('/api/voicer/tasks')
      .set(auth(admin))
      .send(payload({ manager_id: managerId, chat_id: '555' }))
      .expect(400);
    expect(wrongOwner.body.message).toContain('Выберите этого менеджера');
  });

  it('lets an admin link an unassigned chat and revokes its grant when another manager receives the account', async () => {
    const account = await unassignedChat(),
      t = await task(manager, {
        kind: 'call',
        contact_ref: '@test',
        tempo: 'Спокойно',
        instructions: 'Поговорить',
      });
    const url = `/api/voicer/tasks/${t.id}/conversation`;
    await request(app.getHttpServer())
      .put(url)
      .set(auth(manager))
      .send({ chat_id: '666' })
      .expect(404);
    await request(app.getHttpServer())
      .put(url)
      .set(auth(admin))
      .send({ chat_id: '666' })
      .expect(200);
    await request(app.getHttpServer()).get(url).set(auth(voice)).expect(200);
    await prisma.managerAccount.create({
      data: { userId: otherId, tgAccountId: account.id },
    });
    await request(app.getHttpServer()).get(url).set(auth(voice)).expect(404);
    await request(app.getHttpServer()).get(url).set(auth(manager)).expect(404);
  });

  it('does not invent an admin grant when a previously owned account becomes unassigned', async () => {
    const t = await task(manager, {
      kind: 'call',
      contact_ref: '@test',
      tempo: 'Спокойно',
      instructions: 'Поговорить',
      chat_id: '444',
    });
    await prisma.managerAccount.delete({
      where: { tgAccountId: chatAccountId },
    });
    try {
      await request(app.getHttpServer())
        .get(`/api/voicer/tasks/${t.id}/conversation`)
        .set(auth(voice))
        .expect(404);
    } finally {
      await prisma.managerAccount.create({
        data: { userId: managerId, tgAccountId: chatAccountId },
      });
    }
  });
  async function recorded(mode: 'once' | 'library' = 'once', extra = {}) {
    const t = await task(manager, {
      voice_mode: mode,
      ...(mode === 'once' ? { chat_id: '444' } : {}),
      ...extra,
    });
    await act(voice, t.id, 'claim');
    const actor = await prisma.dashboardUser.findUniqueOrThrow({
      where: { id: voiceId },
    });
    const id = await service.record(
      actor,
      t.id,
      1,
      999n,
      ++seq,
      Buffer.from('synthetic recording, encoder mocked'),
    );
    return { t, id, actor };
  }
  function deliveryWorker(fail = false) {
    const telegram = {
      sendMedia: jest.fn(async (_chat: number, _options: any) => {
        await _options.beforeSend?.();
        if (fail) throw Error('uncertain Telegram timeout');
        return ++seq;
      }),
    };
    const brain = {
      noteOperatorQueued: jest.fn(),
      noteOperatorMessage: jest.fn(),
    };
    const worker = new RelayWorker(
      app.get(HistoryService),
      app.get(ClockService),
      {} as any,
      { pause: jest.fn(), autoResumeDue: jest.fn() } as any,
      telegram as any,
      brain as any,
      app.get(VoicerDeliveryService),
    );
    return { worker, telegram, brain };
  }
  it('keeps library recordings reusable and notifies only their manager and admins, including after restart', async () => {
    const { t, id } = await recorded('library');
    for (const token of [admin, manager, voice]) {
      const active = await request(app.getHttpServer())
        .get('/api/voicer/tasks?status=active')
        .set(auth(token))
        .expect(200);
      expect(active.body.items.map((i) => i.id)).not.toContain(t.id);
      for (const status of ['completed', 'ready', 'all']) {
        const done = await request(app.getHttpServer())
          .get(`/api/voicer/tasks?status=${status}`)
          .set(auth(token))
          .expect(200);
        expect(done.body.items).toEqual([
          expect.objectContaining({ id: t.id, status: 'completed' }),
        ]);
      }
    }
    await bot.handle({
      message: {
        chat: { id: 90001, type: 'private' },
        from: { id: 90001 },
        text: '/tasks',
      },
    });
    expect(
      api.mock.calls.some(
        ([method, p]: any) =>
          method === 'sendMessage' &&
          p.text.includes('Активных заданий пока нет'),
      ),
    ).toBe(true);
    expect(await prisma.pendingReply.count()).toBe(0);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/voicer/recordings')
          .set(auth(manager))
      ).body.items.map((i) => i.id),
    ).toContain(id);
    for (const token of [admin, manager]) {
      const notices = (
        await request(app.getHttpServer())
          .get('/api/voicer/notices')
          .set(auth(token))
          .expect(200)
      ).body;
      expect(notices.unread).toBe(1);
      expect(notices.items[0].text).toContain('Голосовое готово');
      expect(notices.items[0].taskId).toBe(t.id);
    }
    const unrelated = (
      await request(app.getHttpServer())
        .get('/api/voicer/notices')
        .set(auth(other))
    ).body;
    expect(unrelated.unread).toBe(0);
    const mine = (
      await request(app.getHttpServer())
        .get('/api/voicer/notices')
        .set(auth(manager))
    ).body.items[0];
    await request(app.getHttpServer())
      .post(`/api/voicer/notices/${mine.id}/read`)
      .set(auth(other))
      .send({})
      .expect(200);
    expect(
      (await prisma.voiceNotice.findUniqueOrThrow({ where: { id: mine.id } }))
        .readAt,
    ).toBeNull();
    await request(app.getHttpServer())
      .post(`/api/voicer/notices/${mine.id}/read`)
      .set(auth(manager))
      .send({})
      .expect(200);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/voicer/notices')
          .set(auth(manager))
      ).body.unread,
    ).toBe(0);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/voicer/notices')
          .set(auth(admin))
      ).body.unread,
    ).toBe(1);
  });

  it('delivers one-time audio once, remembers its text without sending a caption, and confirms only after transport', async () => {
    await prisma.tgAccount.update({
      where: { id: chatAccountId },
      data: { status: 'active' },
    });
    const { t, id, actor } = await recorded();
    const recording = await prisma.voiceRecording.findUniqueOrThrow({
      where: { id },
    });
    expect(
      await service.record(
        actor,
        t.id,
        1,
        999n,
        recording.telegramMessageId,
        Buffer.from('duplicate'),
      ),
    ).toBe(id);
    expect(await prisma.pendingReply.count()).toBe(1);
    expect(
      (await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }))
        .status,
    ).toBe('delivering');
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/voicer/recordings')
          .set(auth(manager))
      ).body.items,
    ).toHaveLength(0);
    const { worker, telegram, brain } = deliveryWorker();
    await worker.tick();
    await worker.tick();
    await app.get(VoicerDeliveryService).reconcile();
    expect(telegram.sendMedia).toHaveBeenCalledTimes(1);
    expect(telegram.sendMedia.mock.calls[0]).toEqual([
      444,
      expect.objectContaining({
        kind: 'voice',
        caption: '',
        accountId: chatAccountId,
        source: recording.filePath,
      }),
    ]);
    expect(brain.noteOperatorMessage).toHaveBeenCalledWith(444);
    expect(
      (await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }))
        .status,
    ).toBe('sent');
    expect(
      await prisma.voiceNotice.count({ where: { userId: managerId } }),
    ).toBe(1);
    expect(
      (
        await prisma.voiceNotice.findFirstOrThrow({
          where: { userId: managerId },
        })
      ).text,
    ).toContain('Голосовое отправлено');
    await request(app.getHttpServer())
      .post(`/api/voicer/recordings/${id}/send`)
      .set(auth(manager))
      .send({ chat_id: '445', request_id: randomUUID() })
      .expect(400);
  });

  it('requires a one-time recipient and prevents quietly changing it after authorization', async () => {
    await request(app.getHttpServer())
      .post('/api/voicer/tasks')
      .set(auth(manager))
      .send(payload({ voice_mode: 'once' }))
      .expect(400);
    const t = await task(manager, { voice_mode: 'once', chat_id: '444' });
    await request(app.getHttpServer())
      .put(`/api/voicer/tasks/${t.id}/conversation`)
      .set(auth(manager))
      .send({ chat_id: '445' })
      .expect(409);
  });

  it('stops before Telegram when the account is unavailable, retains the file and safely retries with one outbox row', async () => {
    const { t } = await recorded();
    const { worker, telegram } = deliveryWorker();
    await worker.tick();
    expect(telegram.sendMedia).not.toHaveBeenCalled();
    expect(
      (await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }))
        .status,
    ).toBe('delivery_error');
    expect(
      (
        await prisma.voiceNotice.findFirstOrThrow({
          where: { userId: managerId },
        })
      ).text,
    ).toContain('не подключён');
    await prisma.tgAccount.update({
      where: { id: chatAccountId },
      data: { status: 'active' },
    });
    await act(manager, t.id, 'retry_delivery').then((r) =>
      expect(r.status).toBe(200),
    );
    await worker.tick();
    expect(telegram.sendMedia).toHaveBeenCalledTimes(1);
    expect(await prisma.pendingReply.count()).toBe(1);
    expect(
      (await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }))
        .status,
    ).toBe('sent');
  });

  it('does not duplicate uncertain one-time audio after restart or manual retry', async () => {
    await prisma.tgAccount.update({
      where: { id: chatAccountId },
      data: { status: 'active' },
    });
    const { t } = await recorded();
    const { worker, telegram } = deliveryWorker(true);
    await worker.tick();
    await worker.onModuleInit();
    await worker.tick();
    expect(telegram.sendMedia).toHaveBeenCalledTimes(1);
    expect(
      (await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }))
        .status,
    ).toBe('delivery_review');
    expect((await act(manager, t.id, 'retry_delivery')).status).toBe(409);
    await app.get(HistoryService).acknowledgeManualReview(444);
    await app.get(VoicerDeliveryService).reconcile();
    expect(
      (await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }))
        .status,
    ).toBe('delivery_closed');
    await worker.tick();
    expect(telegram.sendMedia).toHaveBeenCalledTimes(1);
  });

  it('can cancel a failed recording that never reached Telegram, without allowing a later retry', async () => {
    const { t } = await recorded(),
      { worker, telegram } = deliveryWorker();
    await worker.tick();
    expect((await act(manager, t.id, 'cancel')).status).toBe(200);
    expect((await act(manager, t.id, 'retry_delivery')).status).toBe(409);
    await worker.tick();
    expect(telegram.sendMedia).not.toHaveBeenCalled();
  });

  it('allows library reuse in two owned chats and deduplicates concurrent repeated clicks', async () => {
    const { id } = await recorded('library');
    const send = (chat: string, key: string, token = manager) =>
      request(app.getHttpServer())
        .post(`/api/voicer/recordings/${id}/send`)
        .set(auth(token))
        .send({ chat_id: chat, request_id: key });
    const key = randomUUID();
    const results = await Promise.all([send('444', key), send('444', key)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0].body.id).toBe(results[1].body.id);
    expect((await send('444', randomUUID())).body.id).toBe(results[0].body.id);
    expect((await send('445', randomUUID())).status).toBe(200);
    expect((await send('555', randomUUID())).status).toBe(404);
    expect((await send('444', randomUUID(), voice)).status).toBe(403);
    expect((await send('444', randomUUID(), other)).status).toBe(404);
    expect(await prisma.pendingReply.count()).toBe(2);
    await prisma.tgAccount.update({
      where: { id: chatAccountId },
      data: { status: 'active' },
    });
    const { worker, telegram } = deliveryWorker();
    await worker.tick();
    expect(telegram.sendMedia).toHaveBeenCalledTimes(2);
    expect(telegram.sendMedia.mock.calls[0][1].source).toBe(
      telegram.sendMedia.mock.calls[1][1].source,
    );
    expect((await send('444', randomUUID())).body.id).not.toBe(
      results[0].body.id,
    );
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/voicer/send-targets')
          .set(auth(manager))
      ).body.items
        .map((i) => i.chat_id)
        .sort(),
    ).toEqual(['444', '445']);
  });

  it('rechecks ownership at delivery time and restricts admin grants to their specific one-time task', async () => {
    const account = await unassignedChat();
    await prisma.tgAccount.update({
      where: { id: account.id },
      data: { status: 'active' },
    });
    const t = await task(admin, {
      manager_id: managerId,
      voice_mode: 'once',
      chat_id: '666',
    });
    await act(voice, t.id, 'claim');
    await service.record(
      await prisma.dashboardUser.findUniqueOrThrow({ where: { id: voiceId } }),
      t.id,
      1,
      999n,
      ++seq,
      Buffer.from('audio'),
    );
    const { worker, telegram } = deliveryWorker();
    await worker.tick();
    expect(telegram.sendMedia.mock.calls[0][0]).toBe(666);
    const library = await recorded('library');
    await request(app.getHttpServer())
      .post(`/api/voicer/recordings/${library.id}/send`)
      .set(auth(manager))
      .send({ chat_id: '666', request_id: randomUUID() })
      .expect(404);
    const queued = await recorded();
    await prisma.contact.update({
      where: { chatId: 444n },
      data: { accountId: account.id },
    });
    try {
      await worker.tick();
      expect(telegram.sendMedia).toHaveBeenCalledTimes(1);
      expect(
        (
          await prisma.voiceTask.findUniqueOrThrow({
            where: { id: queued.t.id },
          })
        ).status,
      ).toBe('delivery_error');
    } finally {
      await prisma.contact.update({
        where: { chatId: 444n },
        data: { accountId: chatAccountId },
      });
    }
  });

  it('recovers a missing outbox as a visible review without recreating or sending it', async () => {
    const { t } = await recorded();
    await prisma.pendingReply.deleteMany();
    await app.get(VoicerDeliveryService).reconcile();
    await app.get(VoicerDeliveryService).reconcile();
    expect(await prisma.pendingReply.count()).toBe(0);
    expect(
      (await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }))
        .status,
    ).toBe('delivery_review');
    expect(
      await prisma.voiceNotice.count({ where: { userId: managerId } }),
    ).toBe(1);
  });
});
