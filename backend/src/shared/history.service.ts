import { Injectable } from '@nestjs/common';
import { deliveryRandomId } from 'src/brain/reply-delivery';
import type { InboundTurn } from 'src/brain/reply-brain.port';
import { PrismaService } from '../prisma.service';
import { ClockService } from './clock.service';
import { BOT_ACTIVE_REASON, PauseState } from '../domain/pause';
import { LeadFacts, parseLeadFacts } from '../domain/lead-facts';
import { toChatId } from '../utils/ids';
import { ClientPresence, clientTelegramView } from '../domain/tg-status';

export interface StoredMessage {
  id: number;
  chat_id: number;
  ts: number;
  role: string;
  text: string;
  author: string;
  source_message_id: number | null;
  source_modality: string;
  tg_msg_id: number | null;
  media_kind: string | null;
  file_path: string | null;
  reply_to: number | null;
  reaction: string | null;
  deleted_at: number | null;
  edited_at: number | null;
  inbound_payload?: string | null;
}

export interface AppendMessage {
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  author?: string;
  sourceMessageId?: number | null;
  modality?: string;
  tgMsgId?: number | null;
  mediaKind?: string | null;
  filePath?: string | null;
  replyTo?: number | null;
  inboundPayload?: string;
}

const row = (m: any): StoredMessage => ({
  id: m.id,
  chat_id: Number(m.chatId),
  tg_msg_id: m.tgMsgId ?? null,
  media_kind: m.mediaKind ?? null,
  file_path: m.filePath ?? null,
  reply_to: m.replyTo ?? null,
  reaction: m.reaction ?? null,
  deleted_at: m.deletedAt ?? null,
  edited_at: m.editedAt ?? null,
  inbound_payload: m.inboundPayload ?? null,
  ts: m.ts,
  role: m.role,
  text: m.text,
  author: m.author,
  source_message_id: m.sourceMessageId,
  source_modality: m.sourceModality,
});

const MEDIA_LABELS: Record<string, string> = {
  photo: 'Фото',
  sticker: 'Стикер',
  animation: 'GIF',
  video: 'Видео',
  video_note: 'Кружок',
  voice: 'Голосовое сообщение',
  document: 'Файл',
};

@Injectable()
export class HistoryService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  async ensureContact(chatId: number, accountId?: number | null) {
    const id = toChatId(chatId);
    const existing = await this.prisma.contact.findUnique({
      where: { chatId: id },
    });
    if (existing) {
      if (accountId != null && existing.accountId == null) {
        await this.prisma.contact.update({
          where: { chatId: id },
          data: { accountId },
        });
      }
      return existing;
    }
    return this.prisma.contact.create({
      data: {
        chatId: id,
        accountId: accountId ?? null,
        createdAt: this.clock.ts(),
      },
    });
  }

  async takeOverEmptyChat(chatId: number, accountId: number): Promise<void> {
    const id = toChatId(chatId);
    const contact = await this.prisma.contact.findUnique({
      where: { chatId: id },
      select: { accountId: true },
    });
    if (!contact || contact.accountId === accountId) return;
    if (await this.prisma.message.count({ where: { chatId: id } })) return;
    await this.prisma.contact.update({
      where: { chatId: id },
      data: { accountId },
    });
  }

  async wipeChat(
    chatId: number,
  ): Promise<{ messages: number; files: string[] }> {
    const id = toChatId(chatId);
    const media = await this.prisma.inboundMedia.findMany({
      where: { chatId: id },
      select: { path: true },
    });
    const [messages] = await this.prisma.$transaction([
      this.prisma.message.deleteMany({ where: { chatId: id } }),
      this.prisma.brainState.deleteMany({ where: { chatId: id } }),
      this.prisma.leadFacts.deleteMany({ where: { chatId: id } }),
      this.prisma.replySchedule.deleteMany({ where: { chatId: id } }),
      this.prisma.pendingReply.deleteMany({ where: { chatId: id } }),
      this.prisma.pendingAdminAction.deleteMany({ where: { chatId: id } }),
      this.prisma.beatDelivery.deleteMany({ where: { chatId: id } }),
      this.prisma.leadHandoff.deleteMany({ where: { chatId: id } }),
      this.prisma.funnelEvent.deleteMany({ where: { chatId: id } }),
      this.prisma.mediaShown.deleteMany({ where: { chatId: id } }),
      this.prisma.inboundMedia.deleteMany({ where: { chatId: id } }),
      this.prisma.contact.deleteMany({ where: { chatId: id } }),
    ]);
    return {
      messages: messages.count,
      files: media.map((m) => m.path).filter(Boolean),
    };
  }

  async markTelegramRead(
    chatId: number,
    side: 'outbox' | 'inbox',
    maxId: number,
  ): Promise<void> {
    if (!Number.isInteger(maxId) || maxId <= 0) return;
    const id = toChatId(chatId);
    if (side === 'outbox') {
      await this.prisma
        .$executeRaw`UPDATE contacts SET read_outbox_max_id = GREATEST(COALESCE(read_outbox_max_id, 0), ${maxId}) WHERE chat_id = ${id}`;
    } else {
      await this.prisma
        .$executeRaw`UPDATE contacts SET read_inbox_max_id = GREATEST(COALESCE(read_inbox_max_id, 0), ${maxId}) WHERE chat_id = ${id}`;
    }
  }

  async markManagerSeen(chatId: number, ts: number): Promise<void> {
    await this.prisma.contact.updateMany({
      where: {
        chatId: toChatId(chatId),
        OR: [{ managerSeenTs: null }, { managerSeenTs: { lt: ts } }],
      },
      data: { managerSeenTs: ts },
    });
  }

  async saveClientPresence(
    chatId: number,
    presence: ClientPresence,
    seenAt: number,
  ): Promise<void> {
    await this.prisma.contact.updateMany({
      where: { chatId: toChatId(chatId) },
      data: {
        clientStatus: presence.kind,
        clientStatusAt: presence.at,
        clientStatusSeenAt: seenAt,
      },
    });
  }

  async setBlockedByClient(chatId: number, ts: number | null): Promise<void> {
    await this.prisma.contact.updateMany({
      where: {
        chatId: toChatId(chatId),
        ...(ts === null ? { blockedByClientAt: { not: null } } : {}),
      },
      data: { blockedByClientAt: ts },
    });
  }

  async detectClearedByClient(chatId: number, nowTs: number): Promise<boolean> {
    const id = toChatId(chatId);
    const [justDeleted, alive] = await Promise.all([
      this.prisma.message.count({
        where: { chatId: id, deletedAt: { gte: nowTs - 120 } },
      }),
      this.prisma.message.count({ where: { chatId: id, deletedAt: null } }),
    ]);
    if (justDeleted < 5 || alive > 1) return false;
    await this.prisma.contact.updateMany({
      where: { chatId: id },
      data: { clearedByClientAt: nowTs },
    });
    return true;
  }

  async clearClearedByClient(chatId: number): Promise<void> {
    await this.prisma.contact.updateMany({
      where: { chatId: toChatId(chatId), clearedByClientAt: { not: null } },
      data: { clearedByClientAt: null },
    });
  }

  async isBlockedByClient(chatId: number): Promise<boolean> {
    const c = await this.prisma.contact.findUnique({
      where: { chatId: toChatId(chatId) },
      select: { blockedByClientAt: true },
    });
    return Boolean(c?.blockedByClientAt);
  }

  async accountState(accountId: number): Promise<{
    status: string;
    reason: string | null;
    since: number | null;
  } | null> {
    const a = await this.prisma.tgAccount.findUnique({
      where: { id: accountId },
      select: { status: true, banReason: true, bannedAt: true },
    });
    return a
      ? { status: a.status, reason: a.banReason, since: a.bannedAt }
      : null;
  }

  async clientTelegramState(
    chatId: number,
    nowTs: number,
  ): Promise<{
    client_presence: ClientPresence | null;
    blocked_by_client_at: number | null;
    cleared_by_client_at: number | null;
  }> {
    const c = await this.prisma.contact.findUnique({
      where: { chatId: toChatId(chatId) },
      select: {
        clientStatus: true,
        clientStatusAt: true,
        blockedByClientAt: true,
        clearedByClientAt: true,
      },
    });
    return clientTelegramView(c, nowTs);
  }

  async latestClientTgId(chatId: number): Promise<number> {
    const row = await this.prisma.message.findFirst({
      where: {
        chatId: toChatId(chatId),
        role: 'user',
        OR: [{ tgMsgId: { not: null } }, { sourceMessageId: { not: null } }],
      },
      orderBy: { id: 'desc' },
      select: { tgMsgId: true, sourceMessageId: true },
    });
    return row?.tgMsgId ?? row?.sourceMessageId ?? 0;
  }

  async telegramReadMarks(
    chatId: number,
  ): Promise<{ outbox: number | null; inbox: number | null }> {
    const row = await this.prisma.contact.findUnique({
      where: { chatId: toChatId(chatId) },
      select: { readOutboxMaxId: true, readInboxMaxId: true },
    });
    return {
      outbox: row?.readOutboxMaxId ?? null,
      inbox: row?.readInboxMaxId ?? null,
    };
  }

  async chatOwnerAccount(chatId: number): Promise<number | null> {
    const c = await this.prisma.contact.findUnique({
      where: { chatId: toChatId(chatId) },
      select: { accountId: true },
    });
    return c?.accountId ?? null;
  }

  async attachClientFile(
    chatId: number,
    sourceMessageId: number,
    kind: string,
    path: string,
  ): Promise<void> {
    await this.prisma.message.updateMany({
      where: {
        chatId: toChatId(chatId),
        sourceMessageId,
        role: 'user',
        filePath: null,
      },
      data: { mediaKind: kind, filePath: path },
    });
  }

  /** Метку «[вложение: …]» ставит разбор, когда файл не скачался; после докачки она лишняя. */
  async relabelPlaceholder(
    chatId: number,
    sourceMessageId: number,
    kind: string,
  ): Promise<void> {
    const label = MEDIA_LABELS[kind] ?? 'Вложение';
    await this.prisma.message.updateMany({
      where: {
        chatId: toChatId(chatId),
        sourceMessageId,
        role: 'user',
        text: { startsWith: '[вложение:' },
      },
      data: { text: `[${label}]` },
    });
  }

  async editMessageText(
    chatId: number,
    where: { id?: number; tgMsgId?: number },
    text: string,
    ts: number,
  ): Promise<{ role: string; old: string; id: number } | null> {
    const row = await this.prisma.message.findFirst({
      where: {
        chatId: toChatId(chatId),
        ...(where.id != null ? { id: where.id } : { tgMsgId: where.tgMsgId }),
      },
      select: { id: true, role: true, text: true, inboundPayload: true },
    });
    if (!row || row.text === text) return null;
    let payload: string | undefined;
    if (row.inboundPayload) {
      try {
        const turn = JSON.parse(row.inboundPayload);
        turn.text = text;
        payload = JSON.stringify(turn);
      } catch {
        /* unparsable payload: keep the stored one */
      }
    }
    await this.prisma.message.update({
      where: { id: row.id },
      data: {
        text,
        editedAt: ts,
        ...(payload ? { inboundPayload: payload } : {}),
      },
    });
    return { role: row.role, old: row.text, id: row.id };
  }

  async messageById(chatId: number, id: number) {
    return this.prisma.message.findFirst({
      where: { chatId: toChatId(chatId), id },
    });
  }

  async hasClientMessage(
    chatId: number,
    sourceMessageId: number,
  ): Promise<boolean> {
    return Boolean(
      await this.prisma.message.findFirst({
        where: { chatId: toChatId(chatId), sourceMessageId, role: 'user' },
        select: { id: true },
      }),
    );
  }

  private async conversationWindow(chatId: number) {
    const row = await this.prisma.brainState.findUnique({
      where: { chatId: toChatId(chatId) },
      select: { stateJson: true },
    });
    const reset = row ? JSON.parse(row.stateJson).history_reset : undefined;
    return reset
      ? {
          id: { gt: reset.after_id as number },
          ts: { gte: reset.at as number },
        }
      : {};
  }

  async unansweredMessages(chatId: number): Promise<StoredMessage[]> {
    const id = toChatId(chatId);
    const window = await this.conversationWindow(chatId);
    const last = await this.prisma.message.findFirst({
      where: { chatId: id, role: 'assistant', deletedAt: null, ...window },
      orderBy: [{ ts: 'desc' }, { id: 'desc' }],
    });
    return (
      await this.prisma.message.findMany({
        where: {
          chatId: id,
          role: 'user',
          deletedAt: null,
          ...window,
          ...(last
            ? {
                OR: [
                  { ts: { gt: last.ts } },
                  { ts: last.ts, id: { gt: last.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ ts: 'asc' }, { id: 'asc' }],
      })
    ).map(row);
  }

  async hasProcessedClientMessage(
    chatId: number,
    messageId: number,
  ): Promise<boolean> {
    return Boolean(
      await this.prisma.message.findFirst({
        where: {
          chatId: toChatId(chatId),
          sourceMessageId: messageId,
          role: 'user',
          processedAt: { not: null },
        },
        select: { id: true },
      }),
    );
  }

  async markInboundProcessed(chatId: number, messageId: number): Promise<void> {
    await this.prisma.message.updateMany({
      where: {
        chatId: toChatId(chatId),
        sourceMessageId: messageId,
        role: 'user',
      },
      data: { processedAt: this.clock.ts() },
    });
  }

  async unprocessedInbound(limit = 50): Promise<InboundTurn[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        role: 'user',
        processedAt: null,
        deletedAt: null,
        inboundPayload: { not: null },
      },
      orderBy: { id: 'asc' },
      take: limit,
    });
    return rows.flatMap((m) => {
      try {
        return [JSON.parse(m.inboundPayload!) as InboundTurn];
      } catch {
        return [];
      }
    });
  }

  async appendMessage(
    chatId: number,
    m: AppendMessage,
  ): Promise<StoredMessage | null> {
    const id = toChatId(chatId);
    if (m.role === 'user' && m.sourceMessageId != null) {
      const dup = await this.prisma.message.findFirst({
        where: { chatId: id, sourceMessageId: m.sourceMessageId, role: 'user' },
      });
      if (dup) return null;
    }
    if (m.role === 'assistant' && m.tgMsgId) {
      const existing = await this.prisma.message.findFirst({
        where: { chatId: id, role: 'assistant', tgMsgId: m.tgMsgId },
      });
      if (existing) return row(existing);
    }
    const created = await this.prisma.message.create({
      data: {
        chatId: id,
        ts: m.ts,
        role: m.role,
        text: m.text,
        author: m.author ?? 'llm',
        sourceMessageId: m.role === 'user' ? (m.sourceMessageId ?? null) : null,
        sourceModality: m.modality ?? 'text',
        tgMsgId:
          m.tgMsgId ?? (m.role === 'user' ? (m.sourceMessageId ?? null) : null),
        mediaKind: m.mediaKind ?? null,
        filePath: m.filePath ?? null,
        replyTo: m.replyTo ?? null,
        inboundPayload: m.inboundPayload ?? null,
        processedAt: m.role === 'assistant' ? this.clock.ts() : null,
      },
    });
    return row(created);
  }

  async rhythmMarks(
    chatId: number,
    beforeTs: number,
  ): Promise<{
    firstUserTs: number | null;
    prevUserTs: number | null;
    lastAssistantTs: number | null;
  }> {
    const id = toChatId(chatId);
    const window = await this.conversationWindow(chatId);
    const pick = (role: string, order: 'asc' | 'desc') =>
      this.prisma.message.findFirst({
        where: {
          chatId: id,
          role,
          AND: [window, { ts: { lt: beforeTs } }],
          deletedAt: null,
        },
        orderBy: [{ ts: order }, { id: order }],
        select: { ts: true },
      });
    const [first, prevUser, lastAssistant] = await Promise.all([
      this.prisma.message.findFirst({
        where: { chatId: id, role: 'user', deletedAt: null, ...window },
        orderBy: { id: 'asc' },
        select: { ts: true },
      }),
      pick('user', 'desc'),
      pick('assistant', 'desc'),
    ]);
    return {
      firstUserTs: first?.ts ?? null,
      prevUserTs: prevUser?.ts ?? null,
      lastAssistantTs: lastAssistant?.ts ?? null,
    };
  }

  async markDeleted(
    accountId: number,
    tgMsgIds: number[],
  ): Promise<Map<number, number[]>> {
    const byChat = new Map<number, number[]>();
    if (!tgMsgIds.length) return byChat;
    const chats = await this.prisma.contact.findMany({
      where: { accountId },
      select: { chatId: true },
    });
    if (!chats.length) return byChat;
    const where = {
      chatId: { in: chats.map((c) => c.chatId) },
      tgMsgId: { in: tgMsgIds },
      deletedAt: null,
    };
    const rows = await this.prisma.message.findMany({
      where,
      select: { chatId: true, tgMsgId: true },
    });
    if (!rows.length) return byChat;
    await this.prisma.message.updateMany({
      where,
      data: { deletedAt: this.clock.ts() },
    });
    for (const r of rows) {
      const chatId = Number(r.chatId);
      byChat.set(chatId, [...(byChat.get(chatId) ?? []), r.tgMsgId!]);
    }
    return byChat;
  }

  async window(chatId: number, limit: number): Promise<StoredMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { chatId: toChatId(chatId) },
      orderBy: [{ ts: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.reverse().map(row);
  }

  async since(
    chatId: number,
    afterId: number,
    limit: number,
  ): Promise<StoredMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { chatId: toChatId(chatId), id: { gt: afterId } },
      orderBy: { id: 'asc' },
      take: limit,
    });
    return rows.map(row);
  }

  async lastStoredRole(chatId: number): Promise<string | null> {
    const row = await this.prisma.message.findFirst({
      where: { chatId: toChatId(chatId) },
      orderBy: { id: 'desc' },
      select: { role: true },
    });
    return row?.role ?? null;
  }

  async latestSourceMessageId(chatId: number): Promise<number> {
    const row = await this.prisma.message.findFirst({
      where: {
        chatId: toChatId(chatId),
        role: 'user',
        sourceMessageId: { not: null },
      },
      orderBy: { sourceMessageId: 'desc' },
      select: { sourceMessageId: true },
    });
    return row?.sourceMessageId ?? 0;
  }

  async latestMessageId(chatId: number): Promise<number> {
    const last = await this.prisma.message.findFirst({
      where: { chatId: toChatId(chatId) },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return last?.id ?? 0;
  }

  async lastClientTs(chatId: number): Promise<number | null> {
    const last = await this.prisma.message.findFirst({
      where: { chatId: toChatId(chatId), role: 'user' },
      orderBy: { id: 'desc' },
      select: { ts: true },
    });
    return last?.ts ?? null;
  }

  async getLeadFacts(chatId: number): Promise<LeadFacts> {
    const r = await this.prisma.leadFacts.findUnique({
      where: { chatId: toChatId(chatId) },
    });
    return parseLeadFacts(r?.facts);
  }

  async mergeLeadFacts(
    chatId: number,
    patch: LeadFacts,
    skipIfExists = true,
  ): Promise<LeadFacts> {
    const id = toChatId(chatId);
    const current = await this.getLeadFacts(chatId);
    const next: LeadFacts = { ...current };
    if (!('_persona_home_city' in current)) {
      const home =
        current.city || (typeof patch.city === 'string' ? patch.city : '');
      if (typeof home === 'string' && home.trim())
        next['_persona_home_city'] = home.trim();
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) {
        if (!skipIfExists) delete next[k];
        continue;
      }
      if (
        skipIfExists &&
        k in current &&
        current[k] !== null &&
        current[k] !== ''
      )
        continue;
      next[k] = v;
    }
    await this.prisma.leadFacts.upsert({
      where: { chatId: id },
      create: { chatId: id, facts: JSON.stringify(next) },
      update: { facts: JSON.stringify(next) },
    });
    return next;
  }

  async getPause(chatId: number): Promise<PauseState> {
    const c = await this.prisma.contact.findUnique({
      where: { chatId: toChatId(chatId) },
    });
    if (!c || c.pauseState !== 'paused') {
      return {
        status: 'active',
        reason: BOT_ACTIVE_REASON,
        actor: c?.pauseActor ?? null,
        until: null,
        ts: c?.pausedTs ?? null,
      };
    }
    return {
      status: 'paused',
      reason: c.pauseReason ?? '',
      actor: c.pauseActor,
      until: c.pausedUntil,
      ts: c.pausedTs,
    };
  }

  async setPause(chatId: number, state: PauseState): Promise<void> {
    await this.ensureContact(chatId);
    await this.prisma.contact.update({
      where: { chatId: toChatId(chatId) },
      data: {
        pauseState: state.status,
        pauseReason: state.reason,
        pauseActor: state.actor,
        pausedUntil: state.until,
        pausedTs: state.ts,
      },
    });
  }

  async setReaction(
    chatId: number,
    tgMsgId: number,
    emoji: string | null,
  ): Promise<boolean> {
    const r = await this.prisma.message.updateMany({
      where: {
        chatId: toChatId(chatId),
        OR: [{ tgMsgId }, { sourceMessageId: tgMsgId }],
      },
      data: { reaction: emoji },
    });
    return r.count > 0;
  }

  async enqueueManualReply(
    chatId: number,
    text: string,
    createdTs: number,
    extra: {
      kind?: string;
      filePath?: string | null;
      replyTo?: number | null;
    } = {},
  ): Promise<number> {
    const r = await this.prisma.pendingReply.create({
      data: {
        chatId: toChatId(chatId),
        text,
        createdTs,
        accountId: await this.chatOwnerAccount(chatId),
        delivery: JSON.stringify({ version: 1, randomId: deliveryRandomId() }),
        kind: extra.kind ?? 'text',
        filePath: extra.filePath ?? null,
        replyTo: extra.replyTo ?? null,
      },
    });
    return r.id;
  }

  async pendingManualReplies(chatId?: number) {
    return this.prisma.pendingReply.findMany({
      where: {
        status: 'pending',
        OR: [{ retryAt: null }, { retryAt: { lte: this.clock.ts() } }],
        ...(chatId == null ? {} : { chatId: toChatId(chatId) }),
      },
      orderBy: { id: 'asc' },
    });
  }

  async claimManualReply(id: number) {
    const candidate = await this.prisma.pendingReply.findUnique({
      where: { id },
    });
    if (
      !candidate ||
      (await this.prisma.pendingReply.findFirst({
        where: {
          chatId: candidate.chatId,
          id: { lt: id },
          status: { in: ['pending', 'claimed'] },
        },
        select: { id: true },
      }))
    )
      return null;
    const { count } = await this.prisma.pendingReply.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'claimed', claimedAt: this.clock.ts() },
    });
    return count === 1
      ? this.prisma.pendingReply.findUnique({ where: { id } })
      : null;
  }

  async markManualReplySent(id: number) {
    await this.prisma.pendingReply.update({
      where: { id },
      data: { status: 'sent', sentTs: this.clock.ts() },
    });
  }

  async failManualReply(id: number, error: string) {
    await this.prisma.pendingReply.update({
      where: { id },
      data: { status: 'failed', error },
    });
  }

  async hasPendingManualReply(chatId: number): Promise<boolean> {
    return Boolean(
      await this.prisma.pendingReply.findFirst({
        where: {
          chatId: toChatId(chatId),
          status: { in: ['pending', 'claimed', 'needs_review'] },
          kind: { not: 'reaction' },
        },
        select: { id: true },
      }),
    );
  }

  async reviewManualReply(id: number, error: string): Promise<void> {
    await this.prisma.pendingReply.update({
      where: { id },
      data: { status: 'needs_review', error },
    });
  }

  async recoverManualReplies(startup = false): Promise<void> {
    const rows = await this.prisma.pendingReply.findMany({
      where: {
        status: 'claimed',
        ...(startup
          ? {}
          : {
              OR: [
                { claimedAt: null },
                { claimedAt: { lt: this.clock.ts() - 1800 } },
              ],
            }),
      },
    });
    for (const r of rows) {
      let d: any;
      try {
        d = JSON.parse(r.delivery ?? 'null');
      } catch {
        d = null;
      }
      const resumable =
        d?.version === 1 &&
        (r.kind === 'text' || !d.dispatchedAt || d.ids?.length);
      await this.prisma.pendingReply.updateMany({
        where: { id: r.id, status: 'claimed' },
        data: resumable
          ? { status: 'pending', retryAt: null }
          : {
              status: 'needs_review',
              error:
                'Доставка прервалась. Проверьте последнее сообщение в Telegram; затем включите бота. Повтор автоматически не отправляется.',
            },
      });
    }
  }

  async manualReviewRows() {
    return this.prisma.pendingReply.findMany({
      where: { status: 'needs_review' },
      orderBy: { id: 'asc' },
    });
  }

  async acknowledgeManualReview(chatId: number): Promise<void> {
    await this.prisma.pendingReply.updateMany({
      where: { chatId: toChatId(chatId), status: 'needs_review' },
      data: {
        status: 'resolved',
        error: 'Менеджер завершил проверку и возобновил диалог.',
      },
    });
  }

  async saveManualDelivery(id: number, delivery: unknown): Promise<void> {
    await this.prisma.pendingReply.update({
      where: { id },
      data: { delivery: JSON.stringify(delivery) },
    });
  }

  async retryManualReply(
    id: number,
    error: string,
    retryAt: number,
  ): Promise<void> {
    await this.prisma.pendingReply.update({
      where: { id },
      data: { status: 'pending', error, retryAt },
    });
  }

  async pendingReplyChats(): Promise<number[]> {
    const rows = await this.prisma.pendingReply.findMany({
      where: { status: 'pending' },
      distinct: ['chatId'],
      select: { chatId: true },
    });
    return rows.map((r) => Number(r.chatId));
  }

  async enqueueAdminAction(
    chatId: number,
    action: string,
    payload: string,
    accountId?: number | null,
  ) {
    const r = await this.prisma.pendingAdminAction.create({
      data: {
        chatId: toChatId(chatId),
        action,
        payload,
        createdTs: this.clock.ts(),
        accountId: accountId ?? (await this.chatOwnerAccount(chatId)),
      },
    });
    return r.id;
  }

  async pendingAdminActions(chatId: number) {
    return this.prisma.pendingAdminAction.findMany({
      where: { chatId: toChatId(chatId), status: 'pending' },
      orderBy: { id: 'asc' },
    });
  }

  async claimAdminAction(id: number) {
    const { count } = await this.prisma.pendingAdminAction.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'claimed' },
    });
    return count === 1
      ? this.prisma.pendingAdminAction.findUnique({ where: { id } })
      : null;
  }

  async completeAdminAction(id: number, error?: string) {
    await this.prisma.pendingAdminAction.update({
      where: { id },
      data: {
        status: error ? 'failed' : 'done',
        processedTs: this.clock.ts(),
        error: error ?? null,
      },
    });
  }
}
