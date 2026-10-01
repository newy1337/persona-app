import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { Prisma, VoiceTask } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { GlobalGateService } from 'src/shared/global-gate.service';
import { REFUSAL_LOCK_KEY } from 'src/domain/lead-facts';
import { voiceNotice } from './voicer-notice';
import type { ReplyDelivery } from 'src/brain/reply-delivery';

const parse = (raw?: string | null) => {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
};
const live = [
  'queued',
  'in_progress',
  'delivering',
  'delivery_error',
  'delivery_review',
];
export const AUTO_VOICE_TTL = 15 * 60;
export const AUTO_VOICE_MAX = 10;
export const voiceContextHash = (m: unknown) =>
  createHash('sha256').update(JSON.stringify(m)).digest('hex');
const lastMessage = (tx: Prisma.TransactionClient, chatId: bigint) =>
  tx.message.findFirst({
    where: {
      chatId,
      role: { in: ['user', 'assistant'] },
      deletedAt: null,
    },
    orderBy: { id: 'desc' },
    select: { id: true, role: true, text: true, editedAt: true, ts: true },
  });

@Injectable()
export class VoicerAutomationService {
  private busy = false;
  private log = new Logger(VoicerAutomationService.name);
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private gate: GlobalGateService,
  ) {}

  private async eligibility(
    chatId: bigint,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const [contact, last, facts, pending, manual, sent] = await Promise.all([
      tx.contact.findUnique({
        where: { chatId },
        include: {
          account: {
            include: {
              manager: {
                include: {
                  user: {
                    include: {
                      voicer: { include: { voiceProfile: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      lastMessage(tx, chatId),
      tx.leadFacts.findUnique({ where: { chatId } }),
      tx.voiceTask.findFirst({
        where: {
          chatId,
          kind: 'voice',
          voiceMode: 'once',
          status: { in: live },
        },
      }),
      tx.pendingReply.findFirst({
        where: {
          chatId,
          status: { in: ['pending', 'claimed', 'needs_review'] },
        },
      }),
      tx.message.count({
        where: {
          chatId,
          role: 'assistant',
          mediaKind: 'voice',
          deletedAt: null,
        },
      }),
    ]);
    const manager = contact?.account?.manager?.user,
      voicer = manager?.voicer;
    const persona = contact?.account
      ? await tx.persona.findUnique({
          where: { slug: contact.account.personaId },
        })
      : null;
    const key = last
      ? `auto:${chatId}:${last.id}:${voiceContextHash(last)}`
      : '';
    const previous = key
      ? await tx.voiceTask.findUnique({ where: { autoKey: key } })
      : null;
    const reason = this.gate.stopped
      ? 'Автоматика остановлена'
      : contact?.pauseState === 'paused'
        ? 'Диалог на паузе'
        : contact?.blockedByClientAt || parse(facts?.facts)[REFUSAL_LOCK_KEY]
          ? 'Автоматические сообщения запрещены'
          : contact?.account?.status !== 'active'
            ? 'Telegram-аккаунт не подключён'
            : manager?.role !== 'manager'
              ? 'У аккаунта не назначен менеджер'
              : voicer?.role !== 'voice' || !voicer.voiceProfile?.telegramId
                ? 'Нет подключённого войсера'
                : !persona?.enabled
                  ? 'Личность отключена'
                  : pending || manual
                    ? 'Уже есть незавершённая отправка'
                    : !last || last.role !== 'user'
                      ? 'Нет нового сообщения собеседника'
                      : previous
                        ? 'На эти сообщения уже была заявка'
                        : sent >= AUTO_VOICE_MAX
                          ? 'Лимит голосовых за общение достигнут'
                          : '';
    return {
      available: !reason,
      reason,
      contact,
      manager,
      voicer,
      persona,
      last,
      key,
      sent,
      facts: parse(facts?.facts),
    };
  }

  async context(chatId: number) {
    const e = await this.eligibility(BigInt(chatId));
    return {
      available: e.available,
      reason: e.reason,
      sent_count: e.sent,
      target_min: 5,
      target_max: AUTO_VOICE_MAX,
      context_id: e.last?.id ?? 0,
      context_hash: voiceContextHash(e.last),
      max_characters: 800,
    };
  }

  async pending(chatId: number) {
    return this.prisma.voiceTask.findFirst({
      where: { chatId: BigInt(chatId), source: 'bot', status: { in: live } },
      orderBy: { id: 'desc' },
    });
  }

  async enqueue(chatId: number, delivery: ReplyDelivery): Promise<boolean> {
    if (
      !delivery.voice ||
      !delivery.reply.trim() ||
      delivery.reply.length > 800
    )
      return false;
    return this.prisma.$transaction(async (tx) => {
      const e = await this.eligibility(BigInt(chatId), tx);
      const existing = await tx.voiceTask.findFirst({
        where: { source: 'bot', autoReplyId: delivery.id },
      });
      if (existing && live.includes(existing.status)) return true;
      if (
        !e.available ||
        !e.last ||
        !e.manager ||
        !e.voicer ||
        !e.persona ||
        !e.contact?.accountId ||
        e.last.id !== delivery.voice!.context_id ||
        voiceContextHash(e.last) !== delivery.voice!.context_hash
      )
        return false;
      const schedule = await tx.replySchedule.findUnique({
        where: { chatId: BigInt(chatId) },
      });
      const draft = parse(schedule?.delivery);
      if (
        draft.id !== delivery.id ||
        draft.sentCount ||
        draft.parts?.some((p) => p.dispatchedAt)
      )
        return false;
      const now = this.clock.ts(),
        expires = now + AUTO_VOICE_TTL;
      const changed = await tx.replySchedule.updateMany({
        where: { chatId: BigInt(chatId), delivery: schedule!.delivery },
        data: { dueAt: expires, reason: 'voicer_pending' },
      });
      if (!changed.count) throw new ConflictException('Ответ уже изменился');
      await tx.voiceTask.create({
        data: {
          source: 'bot',
          autoKey: e.key,
          autoReplyId: delivery.id,
          autoContextId: e.last.id,
          autoContextHash: voiceContextHash(e.last),
          autoExpiresAt: expires,
          autoPersonaUpdatedAt: e.persona.updatedAt,
          managerId: e.manager.id,
          voicerId: e.voicer.id,
          managerName: e.manager.username,
          voicerName: e.voicer.username,
          kind: 'voice',
          voiceMode: 'once',
          title: `Авто · ${String(e.facts.name || `Диалог ${chatId}`).slice(0, 80)}`,
          script: delivery.reply.trim(),
          emotion: delivery.voice!.emotion,
          instructions: delivery.voice!.reason,
          contactLabel: String(e.facts.name || `Диалог ${chatId}`).slice(
            0,
            160,
          ),
          contactRef: '',
          chatId: BigInt(chatId),
          sendAccountId: e.contact.accountId,
          sendRequestedById: e.manager.id,
          personaSlug: e.persona.slug,
          personaName: e.persona.name,
          biography: JSON.stringify(parse(e.persona.persona), null, 2),
          dueAt: expires,
          createdAt: now,
          updatedAt: now,
        },
      });
      return true;
    });
  }

  async problem(task: VoiceTask): Promise<string | null> {
    if (task.source !== 'bot') return null;
    if (task.status === 'cancelled') return 'Заявка отменена';
    if ((task.autoExpiresAt ?? 0) <= this.clock.ts())
      return 'Время записи истекло — бот подготовит актуальный ответ текстом';
    if (this.gate.stopped) return 'Автоматика остановлена';
    if (!task.chatId) return 'Диалог удалён';
    const [contact, last, facts, persona, schedule, manager, manual] =
      await Promise.all([
        this.prisma.contact.findUnique({
          where: { chatId: task.chatId },
          include: { account: { include: { manager: true } } },
        }),
        lastMessage(this.prisma, task.chatId),
        this.prisma.leadFacts.findUnique({ where: { chatId: task.chatId } }),
        this.prisma.persona.findUnique({ where: { slug: task.personaSlug } }),
        this.prisma.replySchedule.findUnique({
          where: { chatId: task.chatId },
        }),
        task.managerId
          ? this.prisma.dashboardUser.findUnique({
              where: { id: task.managerId },
            })
          : null,
        this.prisma.pendingReply.findFirst({
          where: {
            chatId: task.chatId,
            status: { in: ['pending', 'claimed', 'needs_review'] },
            source: { not: `bot:voicer:${task.voicerId}` },
          },
        }),
      ]);
    if (
      contact?.pauseState === 'paused' ||
      contact?.blockedByClientAt ||
      parse(facts?.facts)[REFUSAL_LOCK_KEY]
    )
      return 'Диалог приостановлен или отправка запрещена';
    if (manual) return 'Менеджер подготовил другой ответ';
    if (
      !contact?.account ||
      contact.accountId !== task.sendAccountId ||
      contact.account.personaId !== task.personaSlug ||
      contact.account.manager?.userId !== task.managerId ||
      manager?.role !== 'manager' ||
      manager.voicerId !== task.voicerId
    )
      return 'Назначение менеджера, войсера или аккаунта изменилось';
    if (!persona?.enabled || persona.updatedAt !== task.autoPersonaUpdatedAt)
      return 'Карточка личности изменилась';
    if (
      !last ||
      last.id !== task.autoContextId ||
      voiceContextHash(last) !== task.autoContextHash
    )
      return 'Разговор изменился — прежняя запись уже неактуальна';
    if (parse(schedule?.delivery).id !== task.autoReplyId)
      return 'Бот или менеджер уже изменил ответ';
    return null;
  }

  async cancel(taskId: number, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.voiceTask.findUnique({
        where: { id: taskId },
        include: { deliveries: { include: { pendingReply: true } } },
      });
      if (!task || task.source !== 'bot' || !live.includes(task.status)) return;
      if (
        task.deliveries.some(
          (d) =>
            ['sent', 'needs_review', 'resolved'].includes(
              d.pendingReply?.status ?? '',
            ) ||
            parse(d.pendingReply?.delivery).dispatchedAt ||
            parse(d.pendingReply?.delivery).ids?.length,
        )
      )
        return;
      for (const d of task.deliveries)
        if (d.pendingReplyId)
          await tx.pendingReply.updateMany({
            where: {
              id: d.pendingReplyId,
              status: { in: ['pending', 'claimed', 'failed'] },
            },
            data: { status: 'failed', error: reason },
          });
      await tx.voiceTask.update({
        where: { id: task.id },
        data: {
          status: 'cancelled',
          outcome: reason,
          updatedAt: this.clock.ts(),
          notifyVersion: { increment: 1 },
          notifyAfter: 0,
        },
      });
      const row = task.chatId
        ? await tx.replySchedule.findUnique({ where: { chatId: task.chatId } })
        : null;
      if (row && parse(row.delivery).id === task.autoReplyId)
        await tx.replySchedule.updateMany({
          where: { chatId: row.chatId, delivery: row.delivery },
          data: {
            delivery: null,
            reason: 'voice_fallback',
            dueAt: this.clock.ts(),
          },
        });
      await voiceNotice(
        tx,
        task,
        `auto-cancel:${task.id}`,
        `Заявка на голосовое «${task.title}» отменена. ${reason}`,
        this.clock.ts(),
      );
    });
  }

  async cancelForChat(chatId: number, reason: string) {
    const tasks = await this.prisma.voiceTask.findMany({
      where: { chatId: BigInt(chatId), source: 'bot', status: { in: live } },
    });
    for (const task of tasks) await this.cancel(task.id, reason);
  }

  @Cron('*/5 * * * * *')
  async reconcile() {
    if (this.busy) return;
    this.busy = true;
    try {
      const tasks = await this.prisma.voiceTask.findMany({
        where: {
          source: 'bot',
          status: {
            in: ['queued', 'in_progress', 'delivering', 'delivery_error'],
          },
        },
        include: { deliveries: { include: { pendingReply: true } } },
      });
      for (const task of tasks) {
        if (
          task.deliveries.some(
            (d) =>
              parse(d.pendingReply?.delivery).dispatchedAt ||
              parse(d.pendingReply?.delivery).ids?.length,
          )
        )
          continue;
        const reason =
          task.status === 'delivery_error'
            ? 'Голосовое не отправлено; бот ответит текстом'
            : await this.problem(task);
        if (reason) await this.cancel(task.id, reason);
      }
    } catch (e) {
      this.log.warn(`Auto voice reconciliation failed: ${e?.name ?? 'error'}`);
    } finally {
      this.busy = false;
    }
  }
}
