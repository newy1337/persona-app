import { useTestDatabase } from './database';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

const dir = mkdtempSync(resolve(tmpdir(), 'voicer-calls-e2e-'));
process.env.DATA_DIR = dir;
process.env.JWT_SECRET = 'voicer-test-only';
process.env.SESSION_ENC_KEY = 'ab'.repeat(32);
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-only';
process.env.TG_API_ID = '';
process.env.TG_API_HASH = '';
process.env.VOICER_BOT_TOKEN = '';
process.env.PERSONAS_DIR = resolve(__dirname, 'fixtures/personas');
useTestDatabase('voicer_calls');

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { WebSocket } from 'ws';
import { Api } from 'telegram';
import bigInt from 'big-integer';
import { CallMedia } from '../src/modules/voicer/voicer-call-media';
import { VoicerCallService } from '../src/modules/voicer/voicer-call.service';
import { VoicerCallOutcomeService } from '../src/modules/voicer/voicer-call-outcome.service';
import { callContext } from '../src/shared/call-context';
import { TelegramService } from '../src/modules/telegram/telegram.service';
import { VoicerBotService } from '../src/modules/voicer/voicer-bot.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { RelayWorker } from '../src/modules/telegram/relay.worker';
import { PauseService } from '../src/shared/pause.service';
import { TakeoverReason } from '../src/domain/pause';
import { VoiceEncoderService } from '../src/modules/media/voice-encoder.service';

jest.mock('../src/modules/voicer/voicer-call-media', () => {
  const { EventEmitter } = require('events');
  class Fake extends EventEmitter {
    static instances: any[] = [];
    constructor() {
      super();
      Fake.instances.push(this);
    }
    request = jest.fn(async (op: string) =>
      op === 'init'
        ? {
            hash: Buffer.alloc(32),
            protocol: {
              minLayer: 92,
              maxLayer: 92,
              udpP2p: false,
              udpReflector: true,
              libraryVersions: ['9.0.0'],
            },
          }
        : op === 'exchange'
          ? { gAOrB: Buffer.alloc(256), keyFingerprint: 1n }
          : undefined,
    );
    audio = jest.fn();
    stop = jest.fn();
  }
  return { CallMedia: Fake };
});
describe('Browser calls: authorization, MTProto flow and live socket lifecycle', () => {
  let client: any, calls: VoicerCallService, base: string;
  const sockets: WebSocket[] = [];
  let app: INestApplication, prisma: PrismaService, bot: VoicerBotService;
  let admin: string, manager: string, voice: string, voice2: string;
  let managerId: number, voiceId: number, otherId: number, voiceId2: number;
  let chatAccountId: number;
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
    await app.listen(0);
    for (const job of module.get(SchedulerRegistry).getCronJobs().values())
      job.stop();
    prisma = module.get(PrismaService);
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
    ({ id: otherId } = await createUser('other', 'manager', {
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
    calls = app.get(VoicerCallService);
    base = `ws://127.0.0.1:${app.getHttpServer().address().port}/api/voicer/call/ws`;
    client = {
      addEventHandler: jest.fn(),
      removeEventHandler: jest.fn(),
      getInputEntity: jest.fn(
        async () =>
          new Api.InputPeerUser({ userId: bigInt(444), accessHash: bigInt(1) }),
      ),
      invoke: jest.fn(),
    };
    jest
      .spyOn(app.get(TelegramService), 'callClient')
      .mockImplementation(() => client);
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
  beforeEach(async () => {
    client.invoke.mockImplementation(async (req) => {
      if (req instanceof Api.messages.GetDhConfig)
        return new Api.messages.DhConfig({
          g: 2,
          p: Buffer.alloc(256),
          random: Buffer.alloc(256),
          version: 1,
        });
      if (req instanceof Api.phone.RequestCall)
        return {
          phoneCall: new Api.PhoneCallWaiting({
            id: bigInt(100),
            accessHash: bigInt(200),
            date: 1,
            adminId: bigInt(1),
            participantId: bigInt(444),
            protocol: req.protocol,
          }),
        };
      if (req instanceof Api.phone.ConfirmCall)
        return {
          phoneCall: new Api.PhoneCall({
            id: bigInt(100),
            accessHash: bigInt(200),
            date: 1,
            adminId: bigInt(1),
            participantId: bigInt(444),
            gAOrB: Buffer.alloc(256),
            keyFingerprint: bigInt(1),
            protocol: req.protocol,
            connections: [],
            startDate: 1,
          }),
        };
      return true;
    });
    client.invoke.mockClear();
    client.addEventHandler.mockClear();
    await prisma.tgAccount.update({
      where: { id: chatAccountId },
      data: { status: 'active' },
    });
  });
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await until(async () => (calls as any).live.size === 0);
    await prisma.pendingReply.deleteMany();
    await prisma.tgAccount.update({
      where: { id: chatAccountId },
      data: { status: 'unauthorized' },
    });
    await prisma.voiceTask.deleteMany();
    await prisma.message.deleteMany();
    api.mockClear();
    delete process.env.VOICER_PANEL_URL;
  });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function until(check: () => Promise<boolean> | boolean) {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error('Condition not met');
  }
  async function callTask(extra = {}) {
    const t = await task(manager, {
      kind: 'call',
      chat_id: '444',
      tempo: 'Спокойно',
      instructions: 'Проверить связь',
      ...extra,
    });
    await act(voice, t.id, 'claim');
    return t;
  }
  async function ticket(t, token = voice, expected = 200) {
    return (
      await request(app.getHttpServer())
        .post(`/api/voicer/tasks/${t.id}/call/ticket`)
        .set(auth(token))
        .send({})
        .expect(expected)
    ).body.ticket;
  }
  async function connect(key: string) {
    const socket = new WebSocket(base);
    sockets.push(socket);
    const events: any[] = [],
      audio: Buffer[] = [];
    socket.on('message', (data, binary) =>
      binary
        ? audio.push(Buffer.from(data as Buffer))
        : events.push(JSON.parse(data.toString())),
    );
    await new Promise((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify({ ticket: key }));
    return { socket, events, audio };
  }
  const requests = (ctor) =>
    client.invoke.mock.calls.filter(([req]) => req instanceof ctor);
  it('only the assigned voicer can obtain a single-use call ticket for an active linked task', async () => {
    const t = await callTask();
    for (const token of [manager, admin]) await ticket(t, token, 403);
    await ticket(t, voice2, 404);
    const { events } = await connect(await ticket(t));
    await until(() => events.some((e) => e.status === 'ringing'));
    const req = requests(Api.phone.RequestCall)[0][0];
    expect(String(req.userId.userId)).toBe('444');
    expect(req.protocol.udpP2p).toBe(false);
    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { chatId: 444n } }))
        .pauseState,
    ).toBe('paused');
    await ticket(t, voice, 409);
    expect(requests(Api.phone.RequestCall)).toHaveLength(1);
  });
  it('rejects an expired/replayed ticket without creating a call or exposing a Telegram session', async () => {
    const t = await callTask();
    const key = await ticket(t);
    (calls as any).tickets.get(key).expires = 0;
    const one = await connect(key);
    await until(() => one.events.some((e) => e.status === 'failed'));
    const two = await connect(key);
    await until(() => two.events.some((e) => e.status === 'failed'));
    expect(requests(Api.phone.RequestCall)).toHaveLength(0);
    expect(await prisma.voiceCall.count()).toBe(0);
  });
  it('negotiates a Telegram call, bridges both PCM directions and hangs up when the browser closes', async () => {
    const t = await callTask(),
      { socket, events, audio } = await connect(await ticket(t));
    await until(() => events.some((e) => e.status === 'ringing'));
    const handler = client.addEventHandler.mock.calls[0][0];
    await handler(
      new Api.UpdatePhoneCall({
        phoneCall: new Api.PhoneCallAccepted({
          id: bigInt(100),
          accessHash: bigInt(200),
          date: 1,
          adminId: bigInt(1),
          participantId: bigInt(444),
          gB: Buffer.alloc(256),
          protocol: requests(Api.phone.RequestCall)[0][0].protocol,
        }),
      }),
    );
    expect(requests(Api.phone.ConfirmCall)).toHaveLength(1);
    const media = (CallMedia as any).instances.at(-1);
    expect(media.request.mock.calls.some(([op]) => op === 'connect')).toBe(
      true,
    );
    media.emit('state', 'CONNECTED');
    await until(() => events.some((e) => e.status === 'connected'));
    socket.send(Buffer.alloc(960, 7));
    await until(() => media.audio.mock.calls.length > 0);
    expect(media.audio.mock.calls[0][0]).toHaveLength(960);
    media.emit('audio', Buffer.alloc(960, 8));
    await until(() => audio.length === 1);
    socket.close();
    await until(async () =>
      Boolean((await prisma.voiceCall.findFirstOrThrow()).endedAt),
    );
    expect(requests(Api.phone.DiscardCall)).toHaveLength(1);
    expect(media.stop).toHaveBeenCalled();
    const status = (
      await request(app.getHttpServer())
        .get(`/api/voicer/tasks/${t.id}/call`)
        .set(auth(manager))
        .expect(200)
    ).body;
    expect(status.status).toBe('ended');
    expect(JSON.stringify(status)).not.toMatch(
      /accessHash|session|fingerprint|authKey/,
    );
    await until(
      async () =>
        (await prisma.voiceCall.findFirstOrThrow()).resumeStatus === 'resumed',
    );
    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { chatId: 444n } }))
        .pauseState,
    ).toBe('active');
    const done = await prisma.voiceTask.findUniqueOrThrow({
      where: { id: t.id },
    });
    expect(done.status).toBe('completed');
    expect(done.outcome).toContain('Звонок состоялся');
    const call = await prisma.voiceCall.findFirstOrThrow();
    await app.get(VoicerCallOutcomeService).finalize(call.id);
    expect(
      (await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }))
        .notifyVersion,
    ).toBe(done.notifyVersion);
    expect(
      (await act(voice, t.id, 'call_note', 1, 'Обсудили поездку в горы'))
        .status,
    ).toBe(200);
    expect((await callContext(prisma, 444))[0]).toMatchObject({
      connected: true,
      note: 'Обсудили поездку в горы',
    });
    await prisma.voicerProfile.upsert({
      where: { userId: voiceId },
      create: { userId: voiceId, telegramId: 90001n },
      update: { telegramId: 90001n },
    });
    await bot.deliver(
      await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }),
      90001n,
    );
    expect(
      api.mock.calls.some(
        ([method, p]: any) =>
          method === 'sendMessage' &&
          p.text.includes('Подтверждать звонок не нужно'),
      ),
    ).toBe(true);
  });
  it('revalidates account assignment at connection and during a call', async () => {
    const t = await callTask(),
      key = await ticket(t);
    await prisma.managerAccount.update({
      where: { tgAccountId: chatAccountId },
      data: { userId: otherId },
    });
    try {
      const r = await connect(key);
      await until(() => r.events.some((e) => e.status === 'failed'));
      expect(requests(Api.phone.RequestCall)).toHaveLength(0);
    } finally {
      await prisma.managerAccount.update({
        where: { tgAccountId: chatAccountId },
        data: { userId: managerId },
      });
    }
    const r = await connect(await ticket(t));
    await until(() => r.events.some((e) => e.status === 'ringing'));
    await act(manager, t.id, 'cancel');
    await calls.checkCalls();
    await until(() => r.events.some((e) => e.ended));
    expect(requests(Api.phone.DiscardCall)).toHaveLength(1);
  });
  it('shows a privacy error from Telegram without claiming that the call connected', async () => {
    const baseInvoke = client.invoke.getMockImplementation();
    client.invoke.mockImplementation(async (req) => {
      if (req instanceof Api.phone.RequestCall)
        throw { errorMessage: 'USER_PRIVACY_RESTRICTED' };
      return baseInvoke(req);
    });
    const t = await callTask(),
      r = await connect(await ticket(t));
    await until(() => r.events.some((e) => e.ended));
    expect(r.events.at(-1)).toMatchObject({
      status: 'failed',
      reason: 'Настройки собеседника запрещают этот звонок',
    });
    expect((await prisma.voiceCall.findFirstOrThrow()).connectedAt).toBeNull();
    await until(
      async () =>
        (await prisma.voiceCall.findFirstOrThrow()).resumeStatus === 'resumed',
    );
    expect(
      (await prisma.voiceTask.findUniqueOrThrow({ where: { id: t.id } }))
        .status,
    ).toBe('in_progress');
    expect((await callContext(prisma, 444))[0].connected).toBe(false);
  });

  it('does not remove a manager pause made during the call', async () => {
    const t = await callTask(),
      r = await connect(await ticket(t));
    await until(() => r.events.some((e) => e.status === 'ringing'));
    await app
      .get(PauseService)
      .pause(444, TakeoverReason.MANUAL_TAKEOVER, 'operator:changed', {
        reasonText: 'Менеджер остановил бота',
      });
    r.socket.close();
    await until(
      async () =>
        (await prisma.voiceCall.findFirstOrThrow()).resumeStatus === 'kept',
    );
    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { chatId: 444n } }))
        .pauseActor,
    ).toBe('operator:changed');
    expect((await prisma.voiceCall.findFirstOrThrow()).followupStatus).toBe(
      'skipped',
    );
  });
  it('rejects a voice-recording task and unlinked call before starting any Telegram call', async () => {
    const v = await task();
    await act(voice, v.id, 'claim');
    await ticket(v, voice, 404);
    await act(voice, v.id, 'release');
    const t = await callTask({
      chat_id: undefined,
      contact_ref: '@placeholder',
    });
    await ticket(t, voice, 400);
    expect(client.invoke).not.toHaveBeenCalled();
  });
  it('keeps the bot paused for the entire call, even when an earlier timed pause expires', async () => {
    const pause = app.get(PauseService);
    await pause.pause(444, TakeoverReason.PERSONA_AWAY, 'brain', { until: 1 });
    const t = await callTask(),
      r = await connect(await ticket(t));
    await until(() => r.events.some((e) => e.status === 'ringing'));
    const contact = await prisma.contact.findUniqueOrThrow({
      where: { chatId: 444n },
    });
    expect(contact.pausedUntil).toBeNull();
    expect(contact.pauseReason).toMatch(/^human_takeover/);
    await request(app.getHttpServer())
      .post('/api/conversations/444/resume')
      .set(auth(manager))
      .send({})
      .expect(409);
    expect((await act(voice, t.id, 'complete', 1, 'Завершено')).status).toBe(
      409,
    );
    expect((await act(voice, t.id, 'release')).status).toBe(409);
    await pause.autoResumeDue();
    expect((await pause.status(444)).status).toBe('paused');
    r.socket.close();
    await until(() => (calls as any).live.size === 0);
    await request(app.getHttpServer())
      .post('/api/conversations/444/resume')
      .set(auth(manager))
      .send({})
      .expect(200);
  });
  it('buffers early Telegram signaling until the matching call is confirmed and the media engine is ready', async () => {
    const invoke = client.invoke.getMockImplementation();
    let returnCall: () => void = () => {};
    client.invoke.mockImplementation(async (req) => {
      if (req instanceof Api.phone.RequestCall)
        await new Promise<void>((resolve) => {
          returnCall = resolve;
        });
      return invoke(req);
    });
    const t = await callTask(),
      r = await connect(await ticket(t));
    await until(() => requests(Api.phone.RequestCall).length > 0);
    const handler = client.addEventHandler.mock.calls[0][0],
      media = (CallMedia as any).instances.at(-1);
    const accepted = new Api.UpdatePhoneCall({
      phoneCall: new Api.PhoneCallAccepted({
        id: bigInt(100),
        accessHash: bigInt(200),
        date: 1,
        adminId: bigInt(1),
        participantId: bigInt(444),
        gB: Buffer.alloc(256),
        protocol: requests(Api.phone.RequestCall)[0][0].protocol,
      }),
    });
    await handler(
      new Api.UpdatePhoneCallSignalingData({
        phoneCallId: bigInt(999),
        data: Buffer.from('foreign'),
      }),
    );
    await handler(
      new Api.UpdatePhoneCallSignalingData({
        phoneCallId: bigInt(100),
        data: Buffer.from('early'),
      }),
    );
    await handler(accepted);
    expect(
      media.request.mock.calls.filter(
        ([op]) => op === 'signal' || op === 'connect',
      ),
    ).toHaveLength(0);
    returnCall();
    await until(() =>
      media.request.mock.calls.some(([op]) => op === 'connect'),
    );
    await until(() => media.request.mock.calls.some(([op]) => op === 'signal'));
    const ops = media.request.mock.calls.map(([op]) => op);
    expect(ops.indexOf('signal')).toBeGreaterThan(ops.indexOf('connect'));
    expect(
      media.request.mock.calls
        .filter(([op]) => op === 'signal')
        .map(([, data]) => data.toString()),
    ).toEqual(['early']);
    media.emit('state', 'CONNECTED');
    await until(() => r.events.some((e) => e.status === 'connected'));
  });
  it('discards a late dial response and keeps the account reserved until that request settles', async () => {
    const invoke = client.invoke.getMockImplementation();
    let returnCall: () => void = () => {};
    client.invoke.mockImplementation(async (req) => {
      if (req instanceof Api.phone.RequestCall)
        await new Promise<void>((resolve) => {
          returnCall = resolve;
        });
      return invoke(req);
    });
    const t = await callTask(),
      r = await connect(await ticket(t));
    await until(() => requests(Api.phone.RequestCall).length > 0);
    try {
      r.socket.close();
      await until(
        async () =>
          (await prisma.voiceCall.findFirstOrThrow()).status === 'ending',
      );
      await ticket(t, voice, 409);
      await request(app.getHttpServer())
        .post('/api/conversations/444/resume')
        .set(auth(manager))
        .send({})
        .expect(409);
    } finally {
      returnCall();
    }
    await until(() => (calls as any).live.size === 0);
    expect(requests(Api.phone.RequestCall)).toHaveLength(1);
    expect(requests(Api.phone.DiscardCall)).toHaveLength(1);
    expect(
      r.events.some((e) => e.status === 'connected' || e.status === 'ringing'),
    ).toBe(false);
    await ticket(t);
  });
});
