import { useTestDatabase } from './database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'photo-library-e2e-'));
process.env.DATA_DIR = dir;
process.env.TG_API_ID = '';
process.env.TG_API_HASH = '';
useTestDatabase('photo_library');

import sharp from 'sharp';
import { PrismaService } from '../src/prisma.service';
import { HistoryService } from '../src/shared/history.service';
import { BrainStateService } from '../src/brain/brain-state.service';
import { ReplyScheduleService } from '../src/brain/reply-schedule.service';
import { NastyaBrainService } from '../src/brain/nastya-brain.service';
import { PhotoLibraryService } from '../src/shared/photo-library.service';
import { PhotoSetsService } from '../src/modules/photo-sets/photo-sets.service';
import { DEFAULT_RHYTHM } from '../src/brain/nastya/config/rhythm';
import { mergePrompts } from '../src/brain/nastya/config/prompts';
import { cityPlace } from '../src/brain/nastya/kernel/location';
import { judgeDialogue } from '../src/brain/nastya/judge/plan';
import { generateDraft } from '../src/brain/nastya/llm/generate';
import { reviewReply } from '../src/brain/nastya/judge/review';
import { checkCancelled } from '../src/shared/cancellation';
jest.mock('../src/brain/nastya/judge/plan', () => ({
  judgeDialogue: jest.fn(),
}));
jest.mock('../src/brain/nastya/llm/generate', () => ({
  generateDraft: jest.fn(),
}));
jest.mock('../src/brain/nastya/judge/review', () => ({
  reviewReply: jest.fn(),
}));

describe('photo library: the bot shows a photo from the assigned set (real database, no Telegram or model)', () => {
  let prisma: PrismaService,
    history: HistoryService,
    memory: BrainStateService,
    schedule: ReplyScheduleService,
    photos: PhotoLibraryService;
  let now: number, brain: NastyaBrainService, transport: any, pause: any;
  let setId: number, catId: number, cafeId: number;
  const chatId = 99001;
  const clock = { now: () => new Date(now * 1000), ts: () => now };
  const settings: any = {
    get: async () => ({
      custom_prompt: '',
      initiative_enabled: true,
      proactive_max_per_day: 1,
      quiet_start: '23:00',
      quiet_end: '08:00',
    }),
  };
  const loaded = {
    slug: 'test',
    name: 'Денис',
    variables: {},
    prompts: mergePrompts({}),
    rhythm: {
      ...structuredClone(DEFAULT_RHYTHM),
      timezone: 'Europe/Moscow',
      typing: { ...DEFAULT_RHYTHM.typing, enabled: false },
    },
    config: {
      timeZone: 'Europe/Moscow',
      persona: {},
      day: {},
      storylines: {},
      goals: { stages: [{ id: 'knock' }], slots: [] },
    },
  };
  const persona = {
    ready: true,
    forChat: async () => loaded,
    forAccount: async () => loaded,
    interlocutorLocation: async () => cityPlace('Moscow', 'RU'),
    personaPlace: async (p: any) => ({
      status: 'resolved',
      city: '',
      country: '',
      timezone: p.rhythm.timezone,
    }),
  };
  let messageId = 0;
  let tgId = 700;
  const incoming = (text: string) => ({
    chatId,
    accountId: 1,
    messageId: ++messageId,
    text,
    ts: now - 30,
  });
  const turn = async (text: string) => {
    await brain.handleInbound(incoming(text));
    await prisma.replySchedule.update({
      where: { chatId: BigInt(chatId) },
      data: { dueAt: now, openedAt: now },
    });
    return brain.runDueReplies();
  };
  const judgeChooses = (pick: (runtime: any) => string, extra = {}) =>
    (judgeDialogue as jest.Mock).mockImplementation(async ({ runtime }) => ({
      goal: 'respond',
      slot_updates: {},
      photo_reply: { photo_id: pick(runtime), reason: 'рассказала про кота' },
      ...extra,
    }));
  const sends = () =>
    prisma.photoSend.findMany({ where: { chatId: BigInt(chatId) } });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const set = await prisma.photoSet.create({
      data: {
        name: 'Денис — образ 1',
        minIntervalMin: 60,
        maxPerDay: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    });
    setId = set.id;
    const photo = (description: string, extra = {}) =>
      prisma.photoSetPhoto.create({
        data: {
          setId,
          filePath: join(dir, `${description}.jpg`),
          thumbPath: join(dir, `${description}_t.jpg`),
          sha256: description,
          description,
          createdAt: 1,
          updatedAt: 1,
          ...extra,
        },
      });
    catId = (
      await photo('рыжий кот спит на подоконнике', {
        takenOn: '2024-06',
        details: 'кота зовут Барсик',
        tags: '["кот"]',
      })
    ).id;
    cafeId = (await photo('капучино в кафе', { tags: '["кафе"]' })).id;
    await prisma.tgAccount.create({
      data: {
        id: 1,
        phoneE164: '+10000000001',
        personaId: 'test',
        addedAt: 1,
        photoSetId: setId,
      },
    });
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    now = Date.parse('2026-10-14T12:00:00Z') / 1000;
    history = new HistoryService(prisma, clock as any);
    memory = new BrainStateService(prisma, clock as any);
    schedule = new ReplyScheduleService(prisma, clock as any);
    photos = new PhotoLibraryService(prisma);
    await history.wipeChat(chatId);
    await prisma.photoSend.deleteMany({});
    await prisma.photoSet.update({
      where: { id: setId },
      data: { sendMode: 'initiative', autoSend: true },
    });
    await prisma.tgAccount.update({
      where: { id: 1 },
      data: { photoAutoSend: true },
    });
    pause = {
      status: async () => ({ status: 'active' }),
      pause: jest.fn(async () => undefined),
    };
    transport = {
      isOnline: () => true,
      markRead: jest.fn(async () => undefined),
      markListened: jest.fn(async () => undefined),
      sendReaction: jest.fn(async () => undefined),
      sendPhoto: jest.fn(async (_chat, opts) => {
        await opts.onDispatch?.();
        return 500;
      }),
      sendText: jest.fn(async (_chat, parts, opts) => {
        const ids: number[] = [];
        for (const [i] of parts.entries()) {
          checkCancelled(opts.signal);
          await opts.beforePart?.();
          await opts.onDispatch?.(i);
          const id = ++tgId;
          ids.push(id);
          await opts.onPart?.(i, id);
        }
        return ids;
      }),
    };
    (generateDraft as jest.Mock).mockResolvedValue(
      'Вот, только что сфоткал своего Барсика\nОн у меня та ещё соня',
    );
    (reviewReply as jest.Mock).mockImplementation(async (x) => ({
      approved: true,
      should_send: true,
      issues: [],
      final_text: x.draft,
    }));
    brain = new NastyaBrainService(
      history,
      pause,
      clock as any,
      { emit: jest.fn() } as any,
      { stopped: false } as any,
      settings,
      memory,
      persona as any,
      { scoped: () => ({}) } as any,
      schedule,
      transport,
      undefined,
      prisma,
      photos,
    );
  });

  it('sends the chosen photo with an honest caption, records it and remembers what was on it', async () => {
    judgeChooses((runtime) => {
      const cat = runtime.photo_availability.candidates.find((c: any) =>
        c.description.includes('кот'),
      );
      return cat.id;
    });
    expect(await turn('А у меня кошка Муся, смотри какая')).toBe(1);

    const generator = (generateDraft as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(generator.system)).toMatch(/kind\W+photo/);

    expect(transport.sendPhoto).toHaveBeenCalledTimes(1);
    const [, photo] = transport.sendPhoto.mock.calls[0];
    expect(photo.caption).toContain('Барсика');
    expect(photo.caption).not.toMatch(/только что/i);
    expect(photo.randomId).toMatch(/^\d+$/);
    expect(transport.sendText.mock.calls[0][1]).toEqual([
      'Он у меня та ещё соня',
    ]);

    const [row] = await prisma.message.findMany({
      where: { chatId: BigInt(chatId), role: 'assistant', mediaKind: 'photo' },
    });
    expect(row.tgMsgId).toBe(500);
    expect(row.mediaNote).toContain('Барсик');
    const recorded = await sends();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      photoId: catId,
      messageId: row.id,
      source: 'bot',
    });

    // «Как зовут кота?» — модели есть к чему привязать вопрос.
    const state = await memory.reconcile(chatId, true);
    const own = state.history.find((m) => m.panel_message_id === row.id);
    expect(own?.content).toMatch(/^\[Ты отправил\(а\) фото .*Барсик.*\]\n/);

    // Снимок показан: повторно не предлагается, а интервал закрывает отправку.
    const next = await photos.context(chatId, 1, 'Europe/Moscow', now + 60);
    expect(next?.available).toBe(false);
    const later = await photos.context(
      chatId,
      1,
      'Europe/Moscow',
      now + 2 * 3600,
    );
    expect(later?.candidates.map((c) => Number(c.id))).toEqual([cafeId]);
    expect(later?.shown_before.map((c) => Number(c.id))).toEqual([catId]);
  });

  it('the photo goes where its caption line is: text first, then the photo with its own caption', async () => {
    judgeChooses((runtime) => runtime.photo_availability.candidates[0].id);
    (generateDraft as jest.Mock).mockResolvedValue(
      'От двух до трёх раз в неделю — хороший режим\n[ФОТО] Вот, это я в своём зале\nА ты где занимаешься?',
    );
    const order: string[] = [];
    transport.sendPhoto.mockImplementation(async (_chat: number, opts: any) => {
      order.push(`photo:${opts.caption}`);
      await opts.onDispatch?.();
      return 500;
    });
    const sendText = transport.sendText.getMockImplementation();
    transport.sendText.mockImplementation(
      async (chat: number, parts: string[], opts: any) => {
        order.push(...parts.map((p) => `text:${p}`));
        return sendText(chat, parts, opts);
      },
    );
    expect(await turn('Я хожу в зал 2-3 раза в неделю')).toBe(1);
    expect(order).toEqual([
      'text:От двух до трёх раз в неделю — хороший режим',
      'photo:Вот, это я в своём зале',
      'text:А ты где занимаешься?',
    ]);
    const rows = await prisma.message.findMany({
      where: { chatId: BigInt(chatId), role: 'assistant' },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((r) => [r.mediaKind, r.text])).toEqual([
      [null, 'От двух до трёх раз в неделю — хороший режим'],
      ['photo', 'Вот, это я в своём зале'],
      [null, 'А ты где занимаешься?'],
    ]);
    expect(rows.some((r) => r.text.includes('[ФОТО]'))).toBe(false);
    expect(await sends()).toHaveLength(1);
  });

  it('a failed photo send is not marked as shown, and the retry reuses the same random_id', async () => {
    judgeChooses((runtime) => runtime.photo_availability.candidates[0].id);
    transport.sendPhoto.mockRejectedValueOnce(new Error('network down'));
    expect(await turn('Покажи что-нибудь')).toBe(0);
    expect(await sends()).toHaveLength(0);

    await prisma.replySchedule.update({
      where: { chatId: BigInt(chatId) },
      data: { dueAt: now },
    });
    expect(await brain.runDueReplies()).toBe(1);
    expect(transport.sendPhoto).toHaveBeenCalledTimes(2);
    const [first, second] = transport.sendPhoto.mock.calls.map(
      (c: any) => c[1].randomId,
    );
    expect(second).toBe(first);
    expect(await sends()).toHaveLength(1);
    expect(judgeDialogue).toHaveBeenCalledTimes(1);
  });

  it('in "on request" mode an unrequested choice is dropped and the reply goes as text', async () => {
    await prisma.photoSet.update({
      where: { id: setId },
      data: { sendMode: 'request' },
    });
    judgeChooses((runtime) => runtime.photo_availability.candidates[0].id);
    expect(await turn('У меня кот')).toBe(1);
    expect(transport.sendPhoto).not.toHaveBeenCalled();
    expect(await sends()).toHaveLength(0);
  });

  it('a photo request with the set enabled stays with the bot; disabled for the account — goes to a manager', async () => {
    judgeChooses(() => '', { media_request: 'photo' });
    expect(await turn('Скинь фотку')).toBe(1);
    expect(pause.pause).not.toHaveBeenCalled();
    expect(transport.sendText).toHaveBeenCalled();

    await prisma.tgAccount.update({
      where: { id: 1 },
      data: { photoAutoSend: false },
    });
    await turn('Ну скинь фото');
    expect(pause.pause).toHaveBeenCalledTimes(1);
    expect(transport.sendPhoto).not.toHaveBeenCalled();
  });

  it('a photo id the judge invented is never sent', async () => {
    judgeChooses(() => '424242');
    expect(await turn('Что делаешь?')).toBe(1);
    expect(transport.sendPhoto).not.toHaveBeenCalled();
  });

  it('upload strips metadata, finds no invented facts and shows per-chat sent marks', async () => {
    const service = new PhotoSetsService(
      prisma,
      clock as any,
      history,
      {} as any,
      {
        anthropic: {
          messages: { create: async () => Promise.reject(new Error('no key')) },
        },
        provider: 'anthropic',
      } as any,
      { scoped: () => ({ record: async () => undefined }) } as any,
    );
    const jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#c63' },
    })
      .jpeg()
      .toBuffer();
    const first = await service.upload(setId, 'sea.jpg', jpeg);
    expect(first.duplicate).toBe(false);
    expect(first.photo).toMatchObject({
      description: '',
      place: null,
      taken_on: null,
      taken_label: 'дата неизвестна',
      reviewed: false,
    });
    expect((await service.upload(setId, 'again.jpg', jpeg)).duplicate).toBe(
      true,
    );

    await history.appendMessage(chatId, {
      role: 'user',
      text: 'привет',
      ts: now,
      sourceMessageId: 1,
    });
    await prisma.contact.upsert({
      where: { chatId: BigInt(chatId) },
      create: { chatId: BigInt(chatId), accountId: 1 },
      update: { accountId: 1 },
    });
    await photos.recordSend({
      chatId,
      photoId: cafeId,
      accountId: 1,
      caption: '',
      note: 'капучино',
      source: 'manager',
      sentAt: now,
    });
    const library = await service.chatLibrary(chatId, { tag: 'кафе' });
    expect(library.set?.id).toBe(setId);
    expect(library.items).toHaveLength(1);
    expect(library.items[0]).toMatchObject({ id: cafeId, sent_at: now });
    expect(library.tags).toEqual(expect.arrayContaining(['кафе', 'кот']));
    await expect(
      service.photoForChat(chatId, first.photo.id),
    ).resolves.toMatchObject({ id: first.photo.id });
  });
});
