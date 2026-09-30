import { useTestDatabase } from './database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'manual-delivery-e2e-'));
process.env.TG_API_ID = '';
process.env.TG_API_HASH = '';
useTestDatabase('manual_delivery');
import { PrismaService } from '../src/prisma.service';
import { HistoryService } from '../src/shared/history.service';
import { RelayWorker } from '../src/modules/telegram/relay.worker';
import { ReplyScheduleService } from '../src/brain/reply-schedule.service';
import { PauseService } from '../src/shared/pause.service';

describe('manual outbox recovery against a migrated database', () => {
  let db: PrismaService,
    history: HistoryService,
    worker: RelayWorker,
    telegram: any,
    brain: any,
    pause: any,
    now = 1000;
  const clock = { ts: () => now, now: () => new Date(now * 1000) };
  const row = (id: number) => db.pendingReply.findUnique({ where: { id } });
  beforeAll(async () => {
    db = new PrismaService();
    await db.onModuleInit();
    await db.tgAccount.create({
      data: { id: 1, personaId: 'test', phoneE164: '+10001', addedAt: 1 },
    });
  });
  afterAll(async () => {
    await db.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    now = 1000;
    history = new HistoryService(db, clock);
    await history.wipeChat(1);
    await history.ensureContact(1, 1);
    pause = { pause: jest.fn(), autoResumeDue: jest.fn() };
    brain = { noteOperatorMessage: jest.fn() };
    telegram = {
      sendText: jest.fn(async (_c, _t, opts) => {
        await opts.onDispatch?.(0);
        await opts.onPart?.(0, 777);
        return [777];
      }),
      sendMedia: jest.fn(),
      sendAlbum: jest.fn(),
      sendReaction: jest.fn(),
    };
    worker = new RelayWorker(history, clock, {} as any, pause, telegram, brain);
  });
  it('retries uncertain text with the same random ID and pinned account', async () => {
    const id = await history.enqueueManualReply(1, 'Привет', now);
    telegram.sendText.mockImplementationOnce(async (_c, _t, opts) => {
      await opts.onDispatch(0);
      throw Error('timeout');
    });
    await worker.tick();
    expect((await row(id)).status).toBe('pending');
    now += 60;
    await worker.tick();
    expect(telegram.sendText.mock.calls[0][2].randomIds).toEqual(
      telegram.sendText.mock.calls[1][2].randomIds,
    );
    expect(telegram.sendText.mock.calls[1][2].accountId).toBe(1);
    expect((await row(id)).status).toBe('sent');
    expect(await db.message.count()).toBe(1);
  });
  it('acknowledged message survives memory failure and is recorded once without another RPC', async () => {
    const id = await history.enqueueManualReply(1, 'Обещание', now);
    brain.noteOperatorMessage.mockRejectedValueOnce(Error('memory DB failed'));
    await worker.tick();
    now += 60;
    await new RelayWorker(
      history,
      clock,
      {} as any,
      pause,
      telegram,
      brain,
    ).tick();
    expect((await row(id)).status).toBe('sent');
    expect(telegram.sendText).toHaveBeenCalledTimes(1);
    expect(await db.message.count()).toBe(1);
  });
  it('legacy claimed rows require review and are never blindly resent', async () => {
    const r = await db.pendingReply.create({
      data: { chatId: 1n, text: 'Legacy', status: 'claimed', createdTs: 1 },
    });
    await worker.onModuleInit();
    await worker.tick();
    expect((await row(r.id)).status).toBe('needs_review');
    expect(telegram.sendText).not.toHaveBeenCalled();
    expect(pause.pause).toHaveBeenCalled();
    await history.acknowledgeManualReview(1);
    expect(await history.hasPendingManualReply(1)).toBe(false);
  });
  it('new text claims recover with their original attempt identity after restart', async () => {
    const id = await history.enqueueManualReply(1, 'Привет', now);
    const before = JSON.parse((await row(id)).delivery!);
    await history.claimManualReply(id);
    await worker.onModuleInit();
    await worker.tick();
    expect(telegram.sendText.mock.calls[0][2].randomIds).toEqual([
      before.randomId,
    ]);
    expect((await row(id)).status).toBe('sent');
  });
  it('unknown media delivery is held for review without automatic duplicate', async () => {
    const id = await history.enqueueManualReply(1, '', now, {
      kind: 'photo',
      filePath: '/synthetic/photo.jpg',
    });
    telegram.sendMedia.mockRejectedValue(Error('timeout'));
    await worker.tick();
    now += 4000;
    await worker.onModuleInit();
    await worker.tick();
    expect((await row(id)).status).toBe('needs_review');
    expect(telegram.sendMedia).toHaveBeenCalledTimes(1);
  });
  it('sends five new texts and a reaction past an old review without resending its album or resuming the bot', async () => {
    const old = await db.pendingReply.create({
      data: {
        chatId: 1n,
        text: 'Old album',
        kind: 'album',
        status: 'needs_review',
        createdTs: 1,
      },
    });
    await history.appendMessage(1, {
      role: 'user',
      text: 'Message to react to',
      ts: 900,
      sourceMessageId: 444,
      tgMsgId: 444,
    });
    const realPause = new PauseService(
      history,
      clock,
      { emit: jest.fn() } as any,
      db,
    );
    worker = new RelayWorker(
      history,
      clock,
      {} as any,
      realPause,
      telegram,
      brain,
    );
    const sent: string[] = [];
    let tgId = 1000;
    telegram.sendText.mockImplementation(async (_c, parts, opts) => {
      const id = ++tgId;
      sent.push(`text:${parts[0]}`);
      await opts.onDispatch?.(0);
      await opts.onPart?.(0, id);
      return [id];
    });
    telegram.sendReaction.mockImplementation(async (_c, _id, emoji) => {
      sent.push(`reaction:${emoji}`);
    });
    const queued: number[] = [];
    for (const text of ['first', 'second', '👍', 'third', 'fourth', 'fifth']) {
      queued.push(
        await history.enqueueManualReply(
          1,
          text,
          now,
          text === '👍' ? { kind: 'reaction', replyTo: 444 } : {},
        ),
      );
    }
    await worker.tick();
    expect(sent).toEqual([
      'text:first',
      'text:second',
      'reaction:👍',
      'text:third',
      'text:fourth',
      'text:fifth',
    ]);
    for (const id of queued) expect((await row(id)).status).toBe('sent');
    expect((await row(old.id)).status).toBe('needs_review');
    expect(telegram.sendAlbum).not.toHaveBeenCalled();
    expect(await history.getPause(1)).toMatchObject({
      status: 'paused',
      actor: 'system:manual_delivery',
    });
    expect(await history.hasPendingManualReply(1)).toBe(true);
    expect(await db.message.count({ where: { role: 'assistant' } })).toBe(5);
    await worker.tick();
    expect(sent).toHaveLength(6);
  });
  it('keeps later messages behind an earlier scheduled retry', async () => {
    const first = await history.enqueueManualReply(1, 'First', now);
    await history.retryManualReply(first, 'Temporary timeout', now + 60);
    const second = await history.enqueueManualReply(1, 'Second', now);
    await worker.tick();
    expect(telegram.sendText).not.toHaveBeenCalled();
    expect((await row(second)).status).toBe('pending');
    now += 60;
    await worker.tick();
    expect(telegram.sendText.mock.calls.map((c) => c[1][0])).toEqual([
      'First',
      'Second',
    ]);
  });
  it('waits for an in-flight predecessor but allows the next message once it needs review', async () => {
    const first = await history.enqueueManualReply(1, 'First', now);
    await history.claimManualReply(first);
    const second = await history.enqueueManualReply(1, 'Second', now);
    expect(await history.claimManualReply(second)).toBeNull();
    await history.reviewManualReply(first, 'Check delivery');
    expect((await history.claimManualReply(second))?.id).toBe(second);
    expect((await row(first)).status).toBe('needs_review');
  });
  it('deferring blocked rows lets an eligible 51st chat into the next pass', async () => {
    const schedule = new ReplyScheduleService(db, clock);
    await db.replySchedule.deleteMany();
    for (let i = 1; i <= 51; i++)
      await schedule.create(
        i,
        1,
        {
          turn: {
            chatId: i,
            accountId: 1,
            messageId: i,
            text: 'Привет',
            ts: 1,
          },
          text: 'Привет',
          modality: 'text',
        },
        i,
        'test',
      );
    for (const r of await schedule.dueRows(now))
      await schedule.defer(r.chatId, now + 60, 'manual_pending');
    expect((await schedule.dueRows(now)).map((r) => r.chatId)).toEqual([51]);
  });
});
