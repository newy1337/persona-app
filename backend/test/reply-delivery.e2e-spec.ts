import { useTestDatabase } from './database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'reply-delivery-e2e-'));
process.env.TG_API_ID = '';
process.env.TG_API_HASH = '';
useTestDatabase('reply_delivery');

import { PrismaService } from '../src/prisma.service';
import { HistoryService } from '../src/shared/history.service';
import { BrainStateService } from '../src/brain/brain-state.service';
import { ReplyScheduleService } from '../src/brain/reply-schedule.service';
import { NastyaBrainService } from '../src/brain/nastya-brain.service';
import { TelegramService } from '../src/modules/telegram/telegram.service';
import { DEFAULT_RHYTHM } from '../src/brain/nastya/config/rhythm';
import { mergePrompts } from '../src/brain/nastya/config/prompts';
import { cityPlace } from '../src/brain/nastya/kernel/location';
import { historyMessage } from '../src/brain/nastya/memory/history';
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
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('reply delivery: real chat locks + a migrated database (no Telegram or model calls)', () => {
  let prisma: PrismaService,
    history: HistoryService,
    memory: BrainStateService,
    schedule: ReplyScheduleService;
  let now: number,
    brain: NastyaBrainService,
    persona: any,
    transport: any,
    pause: any;
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
      { stopped: false } as any,
      settings,
      memory,
      persona,
      { scoped: () => ({}) } as any,
      schedule,
      transport,
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
    await prisma.tgAccount.create({
      data: { id: 1, phoneE164: '+10000000001', personaId: 'test', addedAt: 1 },
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
    await history.wipeChat(chatId);
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
    });
    (generateDraft as jest.Mock).mockResolvedValue(
      'День прошёл спокойно\nПогуляла у моря',
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

  it('an explicit restart preserves panel history without reviving it after a forced rebuild', async () => {
    const boundary = await history.latestMessageId(chatId);
    const state = memory.defaultState();
    state.history_reset = { after_id: boundary, at: now };
    state.history_cursor = boundary;
    await memory.save(chatId, state);
    await schedule.drop(chatId);
    await history.markInboundProcessed(chatId, 1);
    expect((await memory.reconcile(chatId, true)).history).toEqual([]);
    expect(await brain.answerAfterResume(chatId)).toBe(false);
    expect(await history.hasProcessedClientMessage(chatId, 1)).toBe(true);
    expect(
      await prisma.message.count({ where: { chatId: BigInt(chatId) } }),
    ).toBe(1);

    // An old Telegram message imported after the restart gets a new DB id.
    await history.appendMessage(chatId, {
      role: 'assistant',
      text: 'Old late import',
      ts: now - 10,
      tgMsgId: 800,
    });
    await history.appendMessage(chatId, {
      role: 'assistant',
      text: 'New introduction',
      ts: now,
      tgMsgId: 801,
    });
    await history.appendMessage(chatId, {
      role: 'user',
      text: 'New reply',
      ts: now + 1,
      sourceMessageId: 802,
    });
    const restored = new BrainStateService(prisma, clock);
    expect(
      (await restored.reconcile(chatId, true)).history.map((m) => m.content),
    ).toEqual(['New introduction', 'New reply']);
    expect((await restored.reconcile(chatId)).history).toHaveLength(2);
    expect(
      (await history.unansweredMessages(chatId)).map((m) => m.text),
    ).toEqual(['New reply']);
    expect(await history.rhythmMarks(chatId, now + 2)).toEqual({
      firstUserTs: now + 1,
      prevUserTs: now + 1,
      lastAssistantTs: now,
    });
    expect(
      await prisma.message.count({ where: { chatId: BigInt(chatId) } }),
    ).toBe(4);
  });

  it('a chat without a restart still restores the complete existing conversation', async () => {
    expect(
      (await memory.reconcile(chatId, true)).history.map((m) => m.content),
    ).toEqual([incoming(1).text]);
    expect(
      (await history.unansweredMessages(chatId)).map((m) => m.text),
    ).toEqual([incoming(1).text]);
    expect((await history.rhythmMarks(chatId, now + 1)).firstUserTs).toBe(
      incoming(1).ts,
    );
  });

  it('failed first send leaves no fictional memory/facts and retries the persisted draft', async () => {
    transport.sendText.mockRejectedValueOnce(new Error('network down'));
    expect(await brain.runDueReplies()).toBe(0);
    expect(
      (await memory.load(chatId)).history.filter((m) => m.role === 'assistant'),
    ).toEqual([]);
    expect((await memory.load(chatId)).character.slots).toBeUndefined();
    expect(await assistantRows()).toEqual([]);
    const pending = await schedule.get(chatId);
    expect(pending.delivery.sentCount).toBe(0);
    expect(pending.reason).toBe('retry');
    expect(pending.dueAt).toBe(now + 60);
    await forceDue();
    expect(await brain.runDueReplies()).toBe(1);
    expect(generateDraft).toHaveBeenCalledTimes(1);
    expect(transport.sendText.mock.calls[1][2].randomIds).toEqual(
      transport.sendText.mock.calls[0][2].randomIds,
    );
    expect((await memory.load(chatId)).history.map((m) => m.content)).toEqual([
      incoming(1).text,
      'День прошёл спокойно',
      'Погуляла у моря',
    ]);
    expect((await memory.load(chatId)).history[0].created_at).toBe(
      incoming(1).ts,
    );
    expect(await schedule.get(chatId)).toBeNull();
  });

  it('partial failure + new service instance sends only remaining parts with original random IDs', async () => {
    transport.sendText.mockImplementationOnce(async (_chat, _parts, opts) => {
      expect(
        (await memory.load(chatId)).history.filter(
          (m) => m.role === 'assistant',
        ),
      ).toHaveLength(0);
      await opts.onPart(0, 700);
      expect((await memory.load(chatId)).history.map((m) => m.content)).toEqual(
        [incoming(1).text, 'День прошёл спокойно'],
      );
      throw new Error('second part timed out');
    });
    await brain.runDueReplies();
    const saved = (await schedule.get(chatId)).delivery;
    expect(saved.sentCount).toBe(1);
    expect((await assistantRows()).map((m) => m.text)).toEqual([
      'День прошёл спокойно',
    ]);
    // Restart-like reconstruction: no in-memory delivery cursor survives.
    schedule = new ReplyScheduleService(prisma, clock);
    memory = new BrainStateService(prisma, clock);
    brain = createBrain();
    await forceDue();
    transport.sendText.mockImplementationOnce(async (_chat, parts, opts) => {
      expect(parts).toEqual(['Погуляла у моря']);
      expect(opts.randomIds).toEqual([saved.parts[1].randomId]);
      await opts.onPart(0, 701);
      return [701];
    });
    expect(await brain.runDueReplies()).toBe(1);
    expect(generateDraft).toHaveBeenCalledTimes(1);
    expect((await assistantRows()).map((m) => m.tgMsgId)).toEqual([700, 701]);
    expect((await memory.load(chatId)).history).toHaveLength(3);
  });

  it('Denis keeps a question open after the first bubble and clears it only after the final acknowledgment across restart', async () => {
    (await persona.forAccount()).config.goals.conversation_policy = {
      enabled: true,
    };
    (reviewReply as jest.Mock).mockImplementation(async (x) => ({
      approved: true,
      issues: [],
      final_text: x.draft,
      unanswered_question_ids: [],
    }));
    transport.sendText.mockImplementationOnce(async (_chat, _parts, opts) => {
      await opts.onPart(0, 700);
      throw new Error('second bubble offline');
    });
    expect(await brain.runDueReplies()).toBe(0);
    const partial = await memory.load(chatId);
    expect(partial.character.open_questions).toHaveLength(1);
    expect(partial.character.open_questions[0].text).toBe(incoming(1).text);
    schedule = new ReplyScheduleService(prisma, clock);
    memory = new BrainStateService(prisma, clock);
    brain = createBrain();
    await forceDue();
    transport.sendText.mockImplementationOnce(async (_chat, _parts, opts) => {
      await opts.onPart(0, 701);
      return [701];
    });
    expect(await brain.runDueReplies()).toBe(1);
    expect((await memory.load(chatId)).character.open_questions).toEqual([]);
    expect((await assistantRows()).map((m) => m.tgMsgId)).toEqual([700, 701]);
  });

  it('acknowledgment checkpoint rolls back panel/history/cursor together on database failure', async () => {
    transport.sendText.mockImplementationOnce(async (_chat, _parts, opts) => {
      const real = (memory as any).prisma;
      // A transaction error AFTER its writes must roll back all three records.
      (memory as any).prisma = {
        $transaction: (fn) =>
          real.$transaction(async (tx) => {
            await fn(tx);
            throw new Error('commit failed');
          }),
      };
      try {
        await opts.onPart(0, 700);
      } finally {
        (memory as any).prisma = real;
      }
      return [700];
    });
    await brain.runDueReplies();
    expect(await assistantRows()).toHaveLength(0);
    expect(
      (await memory.load(chatId)).history.filter((m) => m.role === 'assistant'),
    ).toHaveLength(0);
    expect((await schedule.get(chatId)).delivery.sentCount).toBe(0);
    await forceDue();
    await brain.runDueReplies();
    expect((await assistantRows()).map((m) => m.tgMsgId)).toEqual([700, 701]);
    expect((await memory.load(chatId)).history).toHaveLength(3);
  });

  it('new inbound cancels generation through the REAL lock and the next reply includes both inputs', async () => {
    const entered = deferred(),
      waiting = deferred<string>();
    (generateDraft as jest.Mock).mockImplementationOnce(
      async (_input, deps) => {
        deps.signal.addEventListener(
          'abort',
          () => waiting.reject(deps.signal.reason),
          { once: true },
        );
        entered.resolve();
        return waiting.promise;
      },
    );
    const sending = brain.runDueReplies();
    await entered.promise;
    const receiving = brain.handleInbound(
      incoming(2, 'Подожди, расскажи лучше о планах'),
    );
    await Promise.all([sending, receiving]);
    expect(transport.sendText).not.toHaveBeenCalled();
    expect(reviewReply).not.toHaveBeenCalled();
    expect(
      (await memory.load(chatId)).history.filter((m) => m.role === 'assistant'),
    ).toHaveLength(0);
    expect(
      (await schedule.get(chatId)).turns.map((t) => t.turn.messageId),
    ).toEqual([1, 2]);
    await forceDue();
    await brain.runDueReplies();
    expect(
      (await memory.load(chatId)).history
        .filter((m) => m.role === 'user')
        .map((m) => m.content),
    ).toEqual([
      incoming(1).text,
      incoming(2, 'Подожди, расскажи лучше о планах').text,
    ]);
  });

  it('early receipt during a slow media download prevents cron from starting an old reply', async () => {
    const release = brain.observeIncoming(chatId, 1, 2);
    expect(await brain.runDueReplies()).toBe(0);
    expect(generateDraft).not.toHaveBeenCalled();
    await brain.handleInbound(incoming(2, 'Вот фото'));
    expect(await brain.runDueReplies()).toBe(0); // channel still owns its receipt registration
    release();
    release();
    await forceDue();
    expect(await brain.runDueReplies()).toBe(1);
  });

  it('new inbound during actual Telegram typing stops the old reply before sendMessage', async () => {
    const typing = deferred();
    const tg: any = Object.create(TelegramService.prototype);
    const client = { sendMessage: jest.fn(), invoke: jest.fn() };
    Object.assign(tg, {
      accountFor: async () => ({ client, id: 1 }),
      setTyping: async (_account, _chat, on) => {
        if (on) typing.resolve();
      },
      deliver: async (_chat, fn) => fn(),
      call: async (_account, _name, fn) => fn(),
    });
    transport.sendText = tg.sendText.bind(tg);
    (await persona.forChat()).rhythm.typing.enabled = true;
    const sending = brain.runDueReplies();
    await typing.promise;
    const receiving = brain.handleInbound(incoming(2, 'Я передумал'));
    await Promise.all([sending, receiving]);
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(client.invoke).not.toHaveBeenCalled();
    expect(await assistantRows()).toHaveLength(0);
    expect((await schedule.get(chatId)).delivery).toBeNull();
    expect((await schedule.get(chatId)).turns).toHaveLength(2);
  });

  it('new inbound after one delivered part preserves that part and discards the obsolete remainder', async () => {
    const first = deferred(),
      waiting = deferred<number[]>();
    transport.sendText.mockImplementationOnce(async (_chat, _parts, opts) => {
      await opts.onPart(0, 700);
      opts.signal.addEventListener(
        'abort',
        () => waiting.reject(opts.signal.reason),
        { once: true },
      );
      first.resolve();
      return waiting.promise;
    });
    const sending = brain.runDueReplies();
    await first.promise;
    await Promise.all([
      sending,
      brain.handleInbound(incoming(2, 'Стоп, лучше о другом')),
    ]);
    expect((await memory.load(chatId)).history.map((m) => m.content)).toEqual([
      incoming(1).text,
      'Стоп, лучше о другом',
      'День прошёл спокойно',
    ]);
    expect((await assistantRows()).map((m) => m.text)).toEqual([
      'День прошёл спокойно',
    ]);
    expect(
      (await schedule.get(chatId)).turns.map((t) => t.turn.messageId),
    ).toEqual([2]);
    expect((await schedule.get(chatId)).delivery).toBeNull();
  });

  it('a part already dispatched is committed even when inbound arrives before its acknowledgment', async () => {
    const dispatched = deferred(),
      ack = deferred();
    transport.sendText.mockImplementationOnce(async (_chat, _parts, opts) => {
      dispatched.resolve();
      await ack.promise;
      await opts.onPart(0, 700);
      checkCancelled(opts.signal);
      return [700];
    });
    const sending = brain.runDueReplies();
    await dispatched.promise;
    const release = brain.observeIncoming(chatId, 1, 2);
    const receiving = brain.handleInbound(incoming(2));
    ack.resolve();
    await Promise.all([sending, receiving]);
    release();
    expect((await assistantRows()).map((m) => m.tgMsgId)).toEqual([700]);
    expect(
      (await memory.load(chatId)).history.filter((m) => m.role === 'assistant'),
    ).toHaveLength(1);
  });

  it('goodnight generation is cancelled by inbound waiting on the same ritual lock', async () => {
    await schedule.drop(chatId);
    now = Date.parse('2026-09-24T16:55:00Z') / 1000;
    const state = memory.defaultState();
    state.history = [
      historyMessage('user', 'Я засыпаю', now - 1800, 'dialogue'),
    ];
    await memory.save(chatId, state);
    await prisma.message.updateMany({
      where: { chatId: BigInt(chatId) },
      data: { text: 'Я засыпаю', ts: now - 1800 },
    });
    const entered = deferred(),
      waiting = deferred<string>();
    (generateDraft as jest.Mock).mockImplementationOnce(
      async (_input, deps) => {
        deps.signal.addEventListener(
          'abort',
          () => waiting.reject(deps.signal.reason),
          { once: true },
        );
        entered.resolve();
        return waiting.promise;
      },
    );
    const sending = brain.runRituals();
    await entered.promise;
    await Promise.all([
      sending,
      brain.handleInbound(incoming(2, 'Подожди, ещё хотел спросить')),
    ]);
    expect(transport.sendText).not.toHaveBeenCalled();
    expect(
      (await memory.load(chatId)).rhythm?.goodnight?.['2026-09-24'],
    ).toBeUndefined();
    expect(await assistantRows()).toHaveLength(0);
  });

  it('transport without complete acknowledgments cannot invent delivered messages', async () => {
    transport.sendText.mockResolvedValueOnce([]);
    await brain.runDueReplies();
    expect(await assistantRows()).toHaveLength(0);
    expect(
      (await memory.load(chatId)).history.filter((m) => m.role === 'assistant'),
    ).toHaveLength(0);
    expect((await schedule.get(chatId)).delivery.sentCount).toBe(0);
  });

  it('partial goodnight is remembered immediately and is not repeated by the next ritual run', async () => {
    await schedule.drop(chatId);
    now = Date.parse('2026-09-24T16:55:00Z') / 1000;
    const state = memory.defaultState();
    state.history = [
      historyMessage('user', 'Я засыпаю', now - 1800, 'dialogue'),
    ];
    await memory.save(chatId, state);
    await prisma.message.updateMany({
      where: { chatId: BigInt(chatId) },
      data: { text: 'Я засыпаю', ts: now - 1800 },
    });
    (generateDraft as jest.Mock).mockResolvedValue(
      'Спокойной ночи\nОтдыхай хорошенько',
    );
    transport.sendText.mockImplementationOnce(async (_chat, _parts, opts) => {
      await opts.onPart(0, 700);
      throw new Error('second part failed');
    });
    await brain.runRituals();
    const latest = await memory.load(chatId);
    expect(
      latest.history
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content),
    ).toEqual(['Спокойной ночи']);
    expect(latest.rhythm.goodnight['2026-09-24']).toBe('sent');
    expect((await assistantRows()).map((m) => m.text)).toEqual([
      'Спокойной ночи',
    ]);
    await brain.runRituals();
    expect(transport.sendText).toHaveBeenCalledTimes(1);
  });

  it('a manager pause during typing prevents dispatch without inventing a sent reply', async () => {
    const tg: any = Object.create(TelegramService.prototype);
    const client = { sendMessage: jest.fn(), invoke: jest.fn() };
    Object.assign(tg, {
      accountFor: async () => ({ client, id: 1 }),
      typeLike: async () => {
        pause.status = async () => ({ status: 'paused' });
      },
      deliver: async (_chat, fn) => fn(),
      call: async (_account, _name, fn) => fn(),
    });
    transport.sendText = tg.sendText.bind(tg);
    (await persona.forChat()).rhythm.typing.enabled = true;
    await brain.runDueReplies();
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(client.invoke).not.toHaveBeenCalled();
    expect(
      (await memory.load(chatId)).history.filter((m) => m.role === 'assistant'),
    ).toHaveLength(0);
    expect(await assistantRows()).toHaveLength(0);
  });

  it('remembers both sides while paused and restores old manager gaps once without duplicates', async () => {
    await schedule.drop(chatId);
    pause.status = async () => ({ status: 'paused' });
    await brain.handleInbound(incoming(2, 'Я работаю архитектором'));
    await history.appendMessage(chatId, {
      role: 'assistant',
      text: 'А я завтра на пилатес',
      ts: now,
      author: 'operator:web',
      tgMsgId: 800,
    });
    await brain.noteOperatorMessage(chatId);
    expect((await memory.load(chatId)).history.map((m) => m.content)).toEqual([
      incoming(1).text,
      'Я работаю архитектором',
      'А я завтра на пилатес',
    ]);
    expect(transport.sendText).not.toHaveBeenCalled();
    const legacy = await memory.load(chatId);
    delete legacy.history_cursor;
    legacy.history = legacy.history.filter((m) => m.role === 'assistant');
    await memory.save(chatId, legacy);
    await memory.reconcile(chatId);
    await memory.reconcile(chatId);
    expect((await memory.load(chatId)).history).toHaveLength(3);
    pause.status = async () => ({ status: 'active' });
    await brain.handleInbound(incoming(3, 'И как тебе там?'));
    await forceDue();
    await brain.runDueReplies();
    const input = (judgeDialogue as jest.Mock).mock.calls[0][0];
    expect(input.history.map((m) => m.content)).toContain(
      'Я работаю архитектором',
    );
    expect(input.history.map((m) => m.content)).toContain(
      'А я завтра на пилатес',
    );
    expect(input.history.map((m) => m.content)).not.toContain(
      'И как тебе там?',
    );
  });

  it('resuming a burst feeds every unanswered input exactly once to the judge', async () => {
    await schedule.drop(chatId);
    pause.status = async () => ({ status: 'paused' });
    await brain.handleInbound(incoming(2, 'Я в Мадриде'));
    await brain.handleInbound(incoming(3, 'А у тебя как?'));
    pause.status = async () => ({ status: 'active' });
    await brain.answerAfterResume(chatId);
    await forceDue();
    await brain.runDueReplies();
    const input = (judgeDialogue as jest.Mock).mock.calls[0][0];
    expect(input.history).toEqual([]);
    expect(input.userText).toContain('Я в Мадриде');
    expect((input.userText.match(/Я в Мадриде/g) ?? []).length).toBe(1);
    expect(
      (await memory.load(chatId)).history.filter((m) => m.role === 'user'),
    ).toHaveLength(3);
  });

  it('queuing a manager message cancels generation before the manager delivery reaches the chat lock', async () => {
    const entered = deferred(),
      waiting = deferred<string>();
    (generateDraft as jest.Mock).mockImplementationOnce(
      async (_input, deps) => {
        deps.signal.addEventListener(
          'abort',
          () => waiting.reject(deps.signal.reason),
          { once: true },
        );
        entered.resolve();
        return waiting.promise;
      },
    );
    const sending = brain.runDueReplies();
    await entered.promise;
    await history.enqueueManualReply(chatId, 'Отвечу сама', now);
    await Promise.all([sending, brain.noteOperatorQueued(chatId)]);
    expect(transport.sendText).not.toHaveBeenCalled();
    expect(await schedule.get(chatId)).toBeNull();
    expect(
      (await memory.load(chatId)).history.filter((m) => m.role === 'assistant'),
    ).toEqual([]);
  });

  it('a prepared but undispatched reply expires and is regenerated with the new date', async () => {
    transport.sendText.mockRejectedValueOnce(
      new Error('offline before dispatch'),
    );
    await brain.runDueReplies();
    now += 86400;
    await forceDue();
    expect(await brain.runDueReplies()).toBe(0);
    expect((await schedule.get(chatId)).delivery).toBeNull();
    expect(await brain.runDueReplies()).toBe(1);
    expect(generateDraft).toHaveBeenCalledTimes(2);
    expect((judgeDialogue as jest.Mock).mock.calls[1][0].runtime.date).toBe(
      '2026-09-25',
    );
    expect(pause.pause).not.toHaveBeenCalled();
  });

  it('an expired ambiguous Telegram send is held for inspection, never regenerated with a new random ID', async () => {
    transport.sendText.mockImplementationOnce(async (_chat, _parts, opts) => {
      await opts.onDispatch(0);
      throw new Error('acknowledgment lost');
    });
    await brain.runDueReplies();
    now += 601;
    await forceDue();
    await brain.runDueReplies();
    expect(pause.pause).toHaveBeenCalledWith(
      chatId,
      'operator_hold',
      'system:stale_reply',
      expect.any(Object),
    );
    expect(transport.sendText).toHaveBeenCalledTimes(1);
    expect(generateDraft).toHaveBeenCalledTimes(1);
    expect(await schedule.get(chatId)).toBeNull();
    expect(
      (await memory.load(chatId)).history.filter((m) => m.role === 'assistant'),
    ).toEqual([]);
  });

  it('a newer operator fact survives a failed old draft and reaches regeneration', async () => {
    transport.sendText.mockRejectedValueOnce(new Error('offline'));
    await brain.runDueReplies();
    await brain.setSlot(chatId, 'location', 'Tokyo');
    (judgeDialogue as jest.Mock).mockResolvedValue({
      goal: 'respond',
      slot_updates: {},
    });
    await forceDue();
    await brain.runDueReplies();
    expect((await memory.load(chatId)).character.slots.location).toBe('Tokyo');
    expect(
      (judgeDialogue as jest.Mock).mock.calls[1][0].runtime.known_interlocutor
        .location,
    ).toBe('Tokyo');
  });

  it('an edited unanswered message replaces the queued text and discards its prepared reply', async () => {
    transport.sendText.mockRejectedValueOnce(new Error('offline'));
    await brain.runDueReplies();
    await history.editMessageText(chatId, { tgMsgId: 1 }, 'Я в Токио', now);
    await brain.noteEdited(chatId, 'user', incoming(1).text, 'Я в Токио');
    await forceDue();
    await brain.runDueReplies();
    expect((judgeDialogue as jest.Mock).mock.calls[1][0].userText).toContain(
      'Я в Токио',
    );
    expect(
      (judgeDialogue as jest.Mock).mock.calls[1][0].userText,
    ).not.toContain('Как прошёл день');
  });

  it('crossing midnight during typing cancels an unsent today plan before Telegram dispatch', async () => {
    now = Date.parse('2026-09-24T16:59:30Z') / 1000;
    await forceDue();
    transport.sendText.mockImplementationOnce(async (_chat, _parts, opts) => {
      await opts.beforePart();
      now += 60;
      await opts.beforePart();
      throw new Error('must not reach dispatch');
    });
    await brain.runDueReplies();
    expect(await assistantRows()).toEqual([]);
    expect((await schedule.get(chatId)).delivery).toBeNull();
  });

  it('mirroring a newly learned city after part one does not incorrectly expire part two', async () => {
    const loaded = await persona.forChat();
    const view = async () => ({
      ...loaded,
      variables: {
        city: String((await history.getLeadFacts(chatId)).city ?? ''),
      },
    });
    persona.forChat = view;
    persona.forAccount = view;
    expect(await brain.runDueReplies()).toBe(1);
    expect(await assistantRows()).toHaveLength(2);
    expect(pause.pause).not.toHaveBeenCalled();
  });

  it('a recent ambiguous send retries with the original Telegram ID and no new generation', async () => {
    transport.sendText.mockImplementationOnce(async (_chat, _parts, opts) => {
      await opts.onDispatch(0);
      throw new Error('acknowledgment lost');
    });
    await brain.runDueReplies();
    const firstIds = transport.sendText.mock.calls[0][2].randomIds;
    now += 60;
    await forceDue();
    expect(await brain.runDueReplies()).toBe(1);
    expect(transport.sendText.mock.calls[1][2].randomIds).toEqual(firstIds);
    expect(generateDraft).toHaveBeenCalledTimes(1);
  });

  it('an event learned from a delivered manager quote commits only with confirmed bot delivery', async () => {
    const row = await history.appendMessage(chatId, {
      role: 'assistant',
      text: 'Завтра пойду на пилатес',
      ts: now - 200,
      author: 'operator:web',
      tgMsgId: 801,
    });
    await memory.reconcile(chatId);
    const own = (await memory.load(chatId)).history.find(
      (m) => m.panel_message_id === row.id,
    );
    (judgeDialogue as jest.Mock).mockResolvedValue({
      goal: 'respond',
      slot_updates: {},
      persona_event_updates: [
        {
          event_id: '',
          source_id: own.id,
          text: own.content,
          status: 'planned',
          due_on: '',
        },
      ],
    });
    transport.sendText.mockRejectedValueOnce(new Error('offline'));
    await brain.runDueReplies();
    expect((await memory.load(chatId)).persona_events).toEqual([]);
    await forceDue();
    await brain.runDueReplies();
    expect((await memory.load(chatId)).persona_events[0]).toMatchObject({
      text: own.content,
      status: 'planned',
      due_on: '2026-09-25',
    });
  });

  it('a changed persona invalidates a saved draft before any network attempt', async () => {
    transport.sendText.mockRejectedValueOnce(new Error('offline'));
    await brain.runDueReplies();
    const loaded = await persona.forChat();
    loaded.rhythm.timezone = 'Europe/Madrid';
    loaded.config.timeZone = 'Europe/Madrid';
    await forceDue();
    await brain.runDueReplies();
    expect((await schedule.get(chatId)).delivery).toBeNull();
    await brain.runDueReplies();
    expect(
      (judgeDialogue as jest.Mock).mock.calls[1][0].runtime.time_context.persona
        .timezone,
    ).toBe('Europe/Madrid');
    expect(pause.pause).not.toHaveBeenCalled();
  });

  it('midnight after the first bubble reviews the remainder and continues without a manager hold or duplicate', async () => {
    now = Date.parse('2026-09-24T16:59:45Z') / 1000;
    await forceDue();
    transport.sendText.mockImplementationOnce(async (_chat, _parts, opts) => {
      await opts.beforePart();
      await opts.onDispatch(0);
      await opts.onPart(0, 700);
      now += 20;
      await opts.beforePart();
      throw new Error('stale text must not dispatch');
    });
    (reviewReply as jest.Mock).mockImplementation(async (x) => ({
      approved: true,
      should_send: true,
      issues: [],
      final_text:
        x.runtime.delivery_context?.kind === 'continuation'
          ? 'Вчера погуляла у моря'
          : x.draft,
    }));
    expect(await brain.runDueReplies()).toBe(0);
    expect(pause.pause).not.toHaveBeenCalled();
    const pending = await schedule.get(chatId);
    expect(pending.delivery.sentCount).toBe(1);
    expect(pending.delivery.parts[1].text).toBe('Вчера погуляла у моря');
    transport.sendText.mockImplementationOnce(async (_chat, parts, opts) => {
      expect(parts).toEqual(['Вчера погуляла у моря']);
      await opts.beforePart();
      await opts.onDispatch(0);
      await opts.onPart(0, 701);
      return [701];
    });
    expect(await brain.runDueReplies()).toBe(1);
    expect((await assistantRows()).map((m) => m.text)).toEqual([
      'День прошёл спокойно',
      'Вчера погуляла у моря',
    ]);
    expect((await memory.load(chatId)).character.turns).toBe(1);
  });

  it('recovers a received but unfinished input on ordinary redelivery without a duplicate row', async () => {
    const original = memory.reconcile.bind(memory);
    jest
      .spyOn(memory, 'reconcile')
      .mockRejectedValueOnce(Error('simulated database outage'))
      .mockImplementation(original);
    const turn = incoming(77, 'Новое сообщение');
    await expect(brain.handleInbound(turn)).rejects.toThrow(
      'simulated database outage',
    );
    expect(await history.hasProcessedClientMessage(chatId, 77)).toBe(false);
    await brain.handleInbound(turn);
    expect(await history.hasProcessedClientMessage(chatId, 77)).toBe(true);
    expect(
      await prisma.message.count({
        where: { chatId: BigInt(chatId), sourceMessageId: 77 },
      }),
    ).toBe(1);
    expect(
      (await schedule.get(chatId)).turns.some((t) => t.turn.messageId === 77),
    ).toBe(true);
  });

  it('restores a paused photo with its real media payload when returning the chat to the bot', async () => {
    await schedule.drop(chatId);
    pause.status = async () => ({ status: 'paused' });
    await brain.handleInbound({
      ...incoming(78, 'Как тебе?'),
      media: { kind: 'photo', path: '/synthetic/photo.jpg' },
    });
    pause.status = async () => ({ status: 'active' });
    await brain.answerAfterResume(chatId);
    const photo = (await schedule.get(chatId)).turns.find(
      (t) => t.turn.messageId === 78,
    );
    expect(photo.turn.media).toEqual({
      kind: 'photo',
      path: '/synthetic/photo.jpg',
    });
    expect(photo.text).toBe('[Фото]\nКак тебе?');
  });

  it('edits the exact earlier duplicate and invalidates only facts learned from that message', async () => {
    const first = await history.appendMessage(chatId, {
      role: 'user',
      text: 'Я в Москве',
      ts: now,
      sourceMessageId: 201,
    });
    const second = await history.appendMessage(chatId, {
      role: 'user',
      text: 'Я в Москве',
      ts: now + 1,
      sourceMessageId: 202,
    });
    const state = await memory.reconcile(chatId);
    state.character.slots = { location: 'Москва', work: 'Врач' };
    state.memories = [
      {
        id: 'city',
        slot_id: 'location',
        source_message_ids: [201],
        text: 'Москва',
        status: 'active',
        source: 'dialogue',
        evidence: 'Я в Москве',
      } as any,
    ];
    await memory.save(chatId, state);
    await history.mergeLeadFacts(chatId, { city: 'Москва' }, false);
    await history.editMessageText(
      chatId,
      { id: first.id },
      'Я в Мадриде',
      now + 2,
    );
    await brain.noteEdited(
      chatId,
      'user',
      'Я в Москве',
      'Я в Мадриде',
      first.id,
    );
    const after = await memory.load(chatId);
    expect(
      after.history.find((m) => m.panel_message_id === first.id).content,
    ).toBe('Я в Мадриде');
    expect(
      after.history.find((m) => m.panel_message_id === second.id).content,
    ).toBe('Я в Москве');
    expect(after.character.slots.location).toBeUndefined();
    expect(after.character.slots.work).toBe('Врач');
    expect((await history.getLeadFacts(chatId)).city).toBeUndefined();
  });

  it('clearing city removes the mirror but preserves the already established hometown', async () => {
    await history.mergeLeadFacts(chatId, { city: 'Пермь' }, false);
    await brain.setSlot(chatId, 'location', 'Казань');
    await brain.setSlot(chatId, 'location', null);
    const facts = await history.getLeadFacts(chatId);
    expect(facts.city).toBeUndefined();
    expect(facts._persona_home_city).toBe('Пермь');
    const snapshot = await memory.load(chatId);
    expect(snapshot.character.cleared_slots).toContain('location');
  });
});
