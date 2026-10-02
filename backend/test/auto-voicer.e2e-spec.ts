import { useTestDatabase } from './database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'auto-voice-e2e-'));
process.env.DATA_DIR = dir;
process.env.TG_API_ID = '';
process.env.TG_API_HASH = '';
useTestDatabase('auto_voicer');

import {
  VoicerAutomationService,
  AUTO_VOICE_TTL,
} from '../src/modules/voicer/voicer-automation.service';
import { VoicerDeliveryService } from '../src/modules/voicer/voicer-delivery.service';
import { VoicerService } from '../src/modules/voicer/voicer.service';
import { ScopeService } from '../src/shared/scope.service';
import { RelayWorker } from '../src/modules/telegram/relay.worker';
import { PrismaService } from '../src/prisma.service';
import { HistoryService } from '../src/shared/history.service';
import { BrainStateService } from '../src/brain/brain-state.service';
import { ReplyScheduleService } from '../src/brain/reply-schedule.service';
import { NastyaBrainService } from '../src/brain/nastya-brain.service';
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
describe('automatic voicer: real brain, outbox and a migrated database; offline transports', () => {
  let prisma: PrismaService,
    history: HistoryService,
    memory: BrainStateService,
    schedule: ReplyScheduleService;
  let now: number,
    brain: NastyaBrainService,
    persona: any,
    transport: any,
    pause: any;
  let auto: VoicerAutomationService,
    delivery: VoicerDeliveryService,
    voicer: VoicerService,
    actor: any,
    manager: any;
  const gate = { stopped: false };
  const chatId = 88001;
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
  const incoming = (id: number, text = 'Как прошёл день?') => ({
    chatId,
    accountId: 1,
    messageId: id,
    text,
    ts: now - 60 + id,
  });
  const createBrain = () =>
    new NastyaBrainService(
      history,
      pause,
      clock,
      { emit: jest.fn() } as any,
      gate as any,
      settings,
      memory,
      persona,
      { scoped: () => ({}) } as any,
      schedule,
      transport,
      auto,
      prisma,
    );
  const forceDue = () =>
    prisma.replySchedule.update({
      where: { chatId: BigInt(chatId) },
      data: { dueAt: now, openedAt: now },
    });
  const assistantRows = () =>
    prisma.message.findMany({
      where: { chatId: BigInt(chatId), role: 'assistant' },
      orderBy: { id: 'asc' },
    });
  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    actor = await prisma.dashboardUser.create({
      data: {
        username: 'voice',
        role: 'voice',
        passwordHash: 'test',
        createdAt: 1,
        voiceProfile: { create: { telegramId: 42n } },
      },
    });
    manager = await prisma.dashboardUser.create({
      data: {
        username: 'manager',
        role: 'manager',
        passwordHash: 'test',
        createdAt: 1,
        voicerId: actor.id,
      },
    });
    await prisma.persona.create({
      data: { slug: 'test', name: 'Тест', createdAt: 1, updatedAt: 1 },
    });
    await prisma.tgAccount.create({
      data: {
        id: 1,
        phoneE164: '+10000000001',
        personaId: 'test',
        addedAt: 1,
        manager: { create: { userId: manager.id } },
      },
    });
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    now = Date.parse('2026-09-24T10:00:00Z') / 1000;
    history = new HistoryService(prisma, clock);
    memory = new BrainStateService(prisma, clock);
    schedule = new ReplyScheduleService(prisma, clock);
    await prisma.pendingReply.deleteMany();
    await prisma.voiceTask.deleteMany();
    await history.wipeChat(chatId);
    gate.stopped = false;
    await prisma.tgAccount.update({
      where: { id: 1 },
      data: { status: 'active', personaId: 'test' },
    });
    await prisma.dashboardUser.update({
      where: { id: manager.id },
      data: { voicerId: actor.id },
    });
    await prisma.persona.update({
      where: { slug: 'test' },
      data: { updatedAt: 1 },
    });
    auto = new VoicerAutomationService(prisma, clock as any, gate as any);
    delivery = new VoicerDeliveryService(prisma, clock as any, auto);
    const encoder: any = {
      prepare: async (path) => ({ path, temporary: false, duration: 2 }),
      cleanup: jest.fn(),
      probe: async () => ({
        codec: 'opus',
        format: 'ogg',
        channels: 1,
        duration: 2,
      }),
    };
    voicer = new VoicerService(
      prisma,
      clock as any,
      new ScopeService(prisma, history),
      encoder,
      delivery,
      auto,
    );
    const loaded = {
      slug: 'test',
      name: 'Настя',
      variables: {},
      prompts: mergePrompts({}),
      rhythm: {
        ...structuredClone(DEFAULT_RHYTHM),
        timezone: 'Asia/Bangkok',
        typing: { ...DEFAULT_RHYTHM.typing, enabled: false },
        goodnight: { enabled: true, from: '23:00', to: '00:00' },
      },
      config: {
        timeZone: 'Asia/Bangkok',
        persona: {},
        day: {},
        storylines: {},
        goals: {
          stages: [{ id: 'knock', ask_slots: ['location'] }],
          slots: [{ id: 'location' }],
        },
      },
    };
    persona = {
      ready: true,
      forChat: async () => loaded,
      forAccount: async () => loaded,
      interlocutorLocation: async () => cityPlace('Madrid', 'ES'),
      personaPlace: async (p: any) => ({
        status: 'resolved',
        city: '',
        country: '',
        timezone: p.rhythm.timezone,
      }),
    };
    pause = {
      status: async () => ({ status: 'active' }),
      autoResumeDue: jest.fn(),
      pause: jest.fn(async () => {
        pause.status = async () => ({ status: 'paused' });
      }),
    };
    transport = {
      isOnline: () => true,
      markRead: jest.fn(async () => undefined),
      markListened: jest.fn(async () => undefined),
      sendReaction: jest.fn(async () => undefined),
      sendText: jest.fn(async (_chat, parts, opts) => {
        const ids: number[] = [];
        for (const [i] of parts.entries()) {
          checkCancelled(opts.signal);
          await opts.beforePart?.();
          await opts.onDispatch?.(i);
          ids.push(700 + i);
          await opts.onPart?.(i, 700 + i);
        }
        return ids;
      }),
    };
    (judgeDialogue as jest.Mock).mockResolvedValue({
      goal: 'respond',
      slot_updates: { location: 'Madrid' },
      voice_reply: {
        send: true,
        emotion: 'Спокойно',
        reason: 'Короткий личный ответ уместен голосом',
      },
    });
    (generateDraft as jest.Mock).mockResolvedValue(
      'День прошёл спокойно, погуляла у моря',
    );
    (reviewReply as jest.Mock).mockImplementation(async (x) => ({
      approved: true,
      should_send: true,
      issues: [],
      final_text: x.draft,
    }));
    brain = createBrain();
    await brain.handleInbound(incoming(1));
    await forceDue();
  });

  const currentTask = () =>
    prisma.voiceTask.findFirstOrThrow({ orderBy: { id: 'desc' } });
  async function endedCall(connected = true) {
    await schedule.drop(chatId);
    const t = await voicer.create(manager, {
      kind: 'call',
      title: 'Звонок',
      contact_label: 'Тестовый собеседник',
      persona_slug: 'test',
      chat_id: String(chatId),
      tempo: 'Спокойно',
      instructions: 'Поговорить',
    });
    await prisma.voiceTask.update({
      where: { id: t.id },
      data: { status: 'completed' },
    });
    return prisma.voiceCall.create({
      data: {
        id: `call-${t.id}`,
        taskId: t.id,
        revision: 1,
        accountId: 1,
        chatId: BigInt(chatId),
        voicerId: actor.id,
        createdAt: now - 180,
        connectedAt: connected ? now - 120 : null,
        endedAt: now - 50,
        finalizedAt: now - 49,
        resumeStatus: 'resumed',
        followupStatus: 'pending',
        status: 'ended',
        note: 'Обсудили прогулку у моря',
      },
    });
  }
  it('passes the confirmed call and its note to the brain and sends at most one optional follow-up', async () => {
    const call = await endedCall();
    (generateDraft as jest.Mock).mockResolvedValue('Было приятно пообщаться');
    expect(await brain.answerAfterCall(call.id)).toBe(true);
    expect((await assistantRows()).map((m) => m.text)).toEqual([
      'Было приятно пообщаться',
    ]);
    expect(
      (reviewReply as jest.Mock).mock.calls.at(-1)[0].runtime.call_context,
    ).toEqual([
      expect.objectContaining({
        connected: true,
        note: 'Обсудили прогулку у моря',
        duration_seconds: 70,
      }),
    ]);
    expect(await brain.answerAfterCall(call.id)).toBe(false);
    expect(transport.sendText).toHaveBeenCalledTimes(1);
  });
  it('allows the judge to skip a post-call message', async () => {
    const call = await endedCall();
    (reviewReply as jest.Mock).mockResolvedValue({
      approved: false,
      should_send: false,
      final_text: 'Не отправлять',
      issues: ['Неуместно'],
    });
    expect(await brain.answerAfterCall(call.id)).toBe(false);
    expect(transport.sendText).not.toHaveBeenCalled();
    expect(reviewReply).toHaveBeenCalledTimes(1);
    expect(
      (await prisma.voiceCall.findUniqueOrThrow({ where: { id: call.id } }))
        .followupStatus,
    ).toBe('skipped');
  });
  it('never sends a warm call follow-up for a missed call or after a new manager pause', async () => {
    const missed = await endedCall(false);
    expect(await brain.answerAfterCall(missed.id)).toBe(false);
    const connected = await endedCall();
    await prisma.contact.update({
      where: { chatId: BigInt(chatId) },
      data: { pauseState: 'paused', pauseActor: 'operator' },
    });
    expect(await brain.answerAfterCall(connected.id)).toBe(false);
    expect(transport.sendText).not.toHaveBeenCalled();
    expect(generateDraft).not.toHaveBeenCalled();
  });
  it('includes the actual call in the next ordinary reply and prioritizes a new inbound message', async () => {
    const call = await endedCall();
    now += 60;
    await brain.handleInbound(
      incoming(2, 'Спасибо за разговор, расскажи про море'),
    );
    expect(await brain.answerAfterCall(call.id)).toBe(false);
    expect(generateDraft).not.toHaveBeenCalled();
    expect(
      (await prisma.voiceCall.findUniqueOrThrow({ where: { id: call.id } }))
        .followupStatus,
    ).toBe('skipped');
    (judgeDialogue as jest.Mock).mockResolvedValue({
      goal: 'respond',
      voice_reply: { send: false },
    });
    await forceDue();
    await brain.runDueReplies();
    expect(
      (judgeDialogue as jest.Mock).mock.calls.at(-1)[0].runtime.call_context[0],
    ).toMatchObject({ connected: true, note: 'Обсудили прогулку у моря' });
    expect(transport.sendText).toHaveBeenCalledTimes(1);
  });
  it('does not retry a post-call message after uncertain dispatch', async () => {
    const call = await endedCall();
    transport.sendText.mockImplementation(async (_chat, _parts, opts) => {
      await opts.beforePart?.();
      await opts.onDispatch?.(0);
      throw Error('Lost acknowledgement');
    });
    expect(await brain.answerAfterCall(call.id)).toBe(false);
    expect(
      (await prisma.voiceCall.findUniqueOrThrow({ where: { id: call.id } }))
        .followupStatus,
    ).toBe('review');
    expect(await brain.answerAfterCall(call.id)).toBe(false);
    expect(transport.sendText).toHaveBeenCalledTimes(1);
  });
  async function record() {
    const t = await currentTask();
    await voicer.action(actor, t.id, { action: 'claim', revision: t.revision });
    await voicer.record(
      actor,
      t.id,
      t.revision,
      42n,
      t.id,
      Buffer.from('test audio, encoder mocked'),
    );
    return t;
  }
  function worker(failure = false, before?: () => Promise<void>) {
    const telegram = {
      sendMedia: jest.fn(async (_chat, opts) => {
        await before?.();
        await opts.beforeSend();
        if (failure) throw Error('RPC acknowledgement lost');
        return 900;
      }),
    };
    return {
      telegram,
      relay: new RelayWorker(
        history,
        clock as any,
        gate as any,
        pause,
        telegram as any,
        brain,
        delivery,
      ),
    };
  }
  it('parks a reviewed answer, creates one task and commits memory only after actual audio delivery', async () => {
    expect(await brain.runDueReplies()).toBe(0);
    expect(transport.sendText).not.toHaveBeenCalled();
    const t = await currentTask();
    expect(t).toMatchObject({
      source: 'bot',
      voiceMode: 'once',
      managerId: manager.id,
      voicerId: actor.id,
      script: 'День прошёл спокойно, погуляла у моря',
    });
    expect((await schedule.get(chatId)).reason).toBe('voicer_pending');
    expect((await memory.load(chatId)).character.slots).toBeUndefined();
    expect(await assistantRows()).toHaveLength(0);
    await forceDue();
    await brain.runDueReplies();
    expect(await prisma.voiceTask.count()).toBe(1);
    await record();
    const { relay, telegram } = worker();
    await relay.tick();
    await relay.tick();
    expect(telegram.sendMedia).toHaveBeenCalledTimes(1);
    expect(transport.sendText).not.toHaveBeenCalled();
    expect((await currentTask()).status).toBe('sent');
    expect((await assistantRows())[0]).toMatchObject({
      mediaKind: 'voice',
      text: t.script,
      author: `bot:voicer:${actor.id}`,
    });
    expect((await memory.load(chatId)).character.slots).toMatchObject({
      location: 'Madrid',
    });
    expect(await schedule.get(chatId)).toBeNull();
    expect(judgeDialogue).toHaveBeenCalledTimes(1);
    expect(generateDraft).toHaveBeenCalledTimes(1);
    expect(reviewReply).toHaveBeenCalledTimes(1);
    expect(pause.pause).not.toHaveBeenCalled();
  });
  it('a voice request can receive a text answer, without handing the chat to a manager', async () => {
    (judgeDialogue as jest.Mock).mockResolvedValue({
      goal: 'respond',
      media_request: 'voice',
      voice_reply: { send: false },
    });
    expect(await brain.runDueReplies()).toBe(1);
    expect(transport.sendText).toHaveBeenCalledTimes(1);
    expect(await prisma.voiceTask.count()).toBe(0);
    expect(pause.pause).not.toHaveBeenCalled();
  });
  it('uses a conversation-wide cap and falls back to text when no voicer is assigned', async () => {
    await prisma.message.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        chatId: BigInt(chatId),
        ts: now - 100,
        role: 'assistant',
        mediaKind: 'voice',
        text: `voice${i}`,
      })),
    });
    await brain.handleInbound(incoming(2));
    await forceDue();
    expect(await auto.context(chatId)).toMatchObject({
      available: false,
      sent_count: 10,
    });
    expect(await brain.runDueReplies()).toBe(1);
    expect(await prisma.voiceTask.count()).toBe(0);
    await prisma.dashboardUser.update({
      where: { id: manager.id },
      data: { voicerId: null },
    });
    await brain.handleInbound(incoming(3));
    await forceDue();
    expect(await auto.context(chatId)).toMatchObject({
      available: false,
      reason: 'Нет подключённого войсера',
    });
    expect(await brain.runDueReplies()).toBe(1);
  });
  it('expires a recording and regenerates current text without recreating the same order', async () => {
    await brain.runDueReplies();
    now += AUTO_VOICE_TTL + 1;
    await auto.reconcile();
    expect((await currentTask()).status).toBe('cancelled');
    expect(await auto.context(chatId)).toMatchObject({ available: false });
    expect(await brain.runDueReplies()).toBe(1);
    expect(await prisma.voiceTask.count()).toBe(1);
    expect(generateDraft).toHaveBeenCalledTimes(2);
  });
  it('cancels on new input, prevents sending the old file and preserves the new reply schedule', async () => {
    await brain.runDueReplies();
    await record();
    await brain.handleInbound(incoming(2, 'Теперь не могу слушать'));
    const row = await schedule.get(chatId);
    expect((await currentTask()).status).toBe('cancelled');
    expect(row).not.toBeNull();
    const { relay, telegram } = worker();
    await relay.tick();
    expect(telegram.sendMedia).not.toHaveBeenCalled();
    expect(await assistantRows()).toHaveLength(0);
  });
  it.each(['edit', 'persona', 'assignment', 'stop', 'pause'])(
    'invalidates an outstanding recording after %s',
    async (reason) => {
      await brain.runDueReplies();
      const t = await currentTask();
      if (reason === 'edit')
        await prisma.message.updateMany({
          where: { chatId: BigInt(chatId) },
          data: { text: 'Исправлено', editedAt: now },
        });
      if (reason === 'persona')
        await prisma.persona.update({
          where: { slug: 'test' },
          data: { updatedAt: 2 },
        });
      if (reason === 'assignment')
        await prisma.dashboardUser.update({
          where: { id: manager.id },
          data: { voicerId: null },
        });
      if (reason === 'stop') gate.stopped = true;
      if (reason === 'pause')
        await prisma.contact.update({
          where: { chatId: BigInt(chatId) },
          data: { pauseState: 'paused' },
        });
      expect(await auto.problem(t)).toBeTruthy();
      await auto.reconcile();
      expect((await currentTask()).status).toBe('cancelled');
      await expect(record()).rejects.toThrow();
      expect(await prisma.voiceRecording.count()).toBe(0);
    },
  );
  it('manager intervention cancels an unrecorded task and rejects further upload', async () => {
    await brain.runDueReplies();
    await brain.noteOperatorQueued(chatId);
    expect((await currentTask()).status).toBe('cancelled');
    expect(await schedule.get(chatId)).toBeNull();
  });
  it('rechecks context after simulated recording/typing, immediately before the Telegram RPC', async () => {
    await brain.runDueReplies();
    await record();
    const { relay, telegram } = worker(false, async () => {
      now += AUTO_VOICE_TTL + 1;
    });
    await relay.tick();
    await auto.reconcile();
    expect(telegram.sendMedia).toHaveBeenCalledTimes(1);
    expect(await assistantRows()).toHaveLength(0);
    expect((await currentTask()).status).toBe('cancelled');
    expect(
      JSON.parse((await prisma.pendingReply.findFirstOrThrow()).delivery!)
        .dispatchedAt,
    ).toBeUndefined();
  });
  it('does not send a second text or retry audio when Telegram dispatch is uncertain', async () => {
    await brain.runDueReplies();
    await record();
    const { relay, telegram } = worker(true);
    await relay.tick();
    now += AUTO_VOICE_TTL + 1;
    await auto.reconcile();
    await relay.onModuleInit();
    await relay.tick();
    expect((await currentTask()).status).toBe('delivery_review');
    await forceDue();
    expect(await brain.runDueReplies()).toBe(0);
    expect(telegram.sendMedia).toHaveBeenCalledTimes(1);
    expect(transport.sendText).not.toHaveBeenCalled();
  });
});
