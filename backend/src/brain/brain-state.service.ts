import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { toChatId } from 'src/utils/ids';
import type { ConversationState } from './nastya/kernel/types';
import type { ReplyDelivery } from './reply-delivery';
import { reconcileTranscript } from './nastya/memory/transcript';
import { pruneUnsupportedEvents } from './nastya/memory/persona-events';
import { stateFingerprint } from './reply-delivery';

/**
 * The mind's private per-chat state: character progress, memories, judge
 * decisions. Separate from the panel-facing lead facts on purpose — the
 * panel reads a curated mirror, never the engine's internals.
 */
@Injectable()
export class BrainStateService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  defaultState(): ConversationState {
    return {
      conversation_id: randomUUID().replace(/-/g, ''),
      agreements: [],
      user_name: '',
      history: [],
      character: {},
      judge: {},
      judge_review: {},
      memories: [],
      initiative: {},
    };
  }

  async load(chatId: number): Promise<ConversationState> {
    const row = await this.prisma.brainState.findUnique({
      where: { chatId: toChatId(chatId) },
    });
    if (!row) return this.defaultState();
    const stored = JSON.parse(row.stateJson) as Partial<ConversationState>;
    const state: ConversationState = { ...this.defaultState(), ...stored };
    return state;
  }

  /** Run under the chat lock, only on actual conversation work (never panel polling). */
  async reconcile(chatId: number, force = false): Promise<ConversationState> {
    const state = await this.load(chatId);
    const rebuild = force || state.history_cursor === undefined;
    const afterId = Math.max(
      state.history_reset?.after_id ?? 0,
      rebuild ? 0 : (state.history_cursor ?? 0),
    );
    const rows = await this.prisma.message.findMany({
      where: {
        chatId: toChatId(chatId),
        ...(afterId ? { id: { gt: afterId } } : {}),
        ...(state.history_reset ? { ts: { gte: state.history_reset.at } } : {}),
      },
      orderBy: { id: 'asc' },
    });
    if (!rows.length && !rebuild) return state;
    reconcileTranscript(
      state,
      rows.map(
        (m) =>
          ({
            id: m.id,
            chat_id: chatId,
            ts: m.ts,
            role: m.role,
            text: m.text,
            author: m.author,
            tg_msg_id: m.tgMsgId,
            source_message_id: m.sourceMessageId,
            deleted_at: m.deletedAt,
          }) as any,
      ),
      rebuild,
    );
    state.history_cursor ??= 0;
    pruneUnsupportedEvents(state);
    await this.save(chatId, state);
    return state;
  }

  async save(chatId: number, state: ConversationState): Promise<void> {
    const id = toChatId(chatId);
    const stateJson = JSON.stringify(state);
    await this.prisma.brainState.upsert({
      where: { chatId: id },
      create: { chatId: id, stateJson, updatedAt: this.clock.ts() },
      update: { stateJson, updatedAt: this.clock.ts() },
    });
  }

  /** Telegram has acknowledged this part. All local delivery records commit together. */
  async confirmPart(
    chatId: number,
    state: ConversationState,
    text: string,
    author: string,
    tgMsgId: number,
    ts: number,
    delivery?: ReplyDelivery,
  ): Promise<void> {
    if (!Number.isSafeInteger(tgMsgId) || tgMsgId <= 0)
      throw new Error('Telegram did not acknowledge a message id');
    const id = toChatId(chatId);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.message.findFirst({
        where: { chatId: id, role: 'assistant', tgMsgId },
      });
      const message =
        existing ??
        (await tx.message.create({
          data: { chatId: id, role: 'assistant', text, author, ts, tgMsgId },
        }));
      const own = [...state.history]
        .reverse()
        .find(
          (m) =>
            m.role === 'assistant' && m.content === text && !m.panel_message_id,
        );
      if (own) {
        own.panel_message_id = message.id;
        own.telegram_message_id = tgMsgId;
      }
      if (delivery) delivery.basisState = stateFingerprint(state);
      const stateJson = JSON.stringify(state);
      await tx.brainState.upsert({
        where: { chatId: id },
        create: { chatId: id, stateJson, updatedAt: ts },
        update: { stateJson, updatedAt: ts },
      });
      if (delivery)
        await tx.replySchedule.updateMany({
          where: { chatId: id },
          data: { delivery: JSON.stringify(delivery) },
        });
    });
  }

  /** Chats with any brain state touched since `sinceTs`, newest first. */
  async activeChatIds(sinceTs: number): Promise<number[]> {
    const rows = await this.prisma.brainState.findMany({
      where: { updatedAt: { gte: sinceTs } },
      orderBy: { updatedAt: 'desc' },
      select: { chatId: true },
    });
    return rows.map((r) => Number(r.chatId));
  }
}
