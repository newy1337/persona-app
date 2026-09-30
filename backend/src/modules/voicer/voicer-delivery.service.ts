import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  Prisma,
  VoiceRecording,
  VoiceTask,
  VoiceDelivery,
  PendingReply,
} from '@prisma/client';
import { realpath } from 'fs/promises';
import { isAbsolute, relative, resolve } from 'path';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { appConfig } from 'src/config/app.config';
import { VoicerAutomationService } from './voicer-automation.service';
import { voiceNotice } from './voicer-notice';
import { deliveryRandomId } from 'src/brain/reply-delivery';

const parse = (s: string | null) => {
  try {
    return JSON.parse(s ?? '{}');
  } catch {
    return {};
  }
};
export const deliveryRelation = {
  orderBy: { id: 'desc' as const },
  take: 1,
  include: {
    pendingReply: { select: { status: true, error: true, sentTs: true } },
  },
};
export type DeliveryWithStatus = VoiceDelivery & {
  pendingReply: Pick<PendingReply, 'status' | 'error' | 'sentTs'> | null;
};
export const deliveryView = (d?: DeliveryWithStatus | null) =>
  d
    ? {
        id: d.id,
        recording_id: d.recordingId,
        chat_id: String(d.chatId),
        status: d.pendingReply?.status ?? 'needs_review',
        error:
          d.pendingReply?.error ??
          (!d.pendingReply
            ? 'Запись отправки недоступна. Проверьте диалог перед повтором'
            : null),
        created_at: d.createdAt,
        sent_at: d.pendingReply?.sentTs ?? null,
      }
    : null;

@Injectable()
export class VoicerDeliveryService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    @Optional() private autoVoice?: VoicerAutomationService,
  ) {}

  async enqueue(
    tx: Prisma.TransactionClient,
    task: VoiceTask,
    recording: VoiceRecording,
    target: {
      chatId: bigint;
      accountId: number;
      personaSlug: string;
      requestedById: number;
      requestKey: string;
      mode: string;
    },
  ) {
    const existing = await tx.voiceDelivery.findUnique({
      where: { requestKey: target.requestKey },
    });
    if (existing) {
      if (
        existing.recordingId !== recording.id ||
        existing.chatId !== target.chatId
      )
        throw new ConflictException(
          'Этот запрос уже использован для другой отправки',
        );
      return existing;
    }
    const pending = await tx.pendingReply.create({
      data: {
        chatId: target.chatId,
        accountId: target.accountId,
        text: '',
        kind: 'voice',
        filePath: recording.filePath,
        source:
          task.source === 'bot'
            ? `bot:voicer:${task.voicerId}`
            : `operator:voicer:${target.requestedById}`,
        createdTs: this.clock.ts(),
        delivery: JSON.stringify({ version: 1, randomId: deliveryRandomId() }),
      },
    });
    return tx.voiceDelivery.create({
      data: {
        ...target,
        taskId: task.id,
        recordingId: recording.id,
        historyText: task.script,
        createdAt: this.clock.ts(),
        pendingReplyId: pending.id,
      },
    });
  }

  async beforeDispatch(replyId: number) {
    const d = await this.prisma.voiceDelivery.findUnique({
      where: { pendingReplyId: replyId },
      include: { task: true, recording: true, pendingReply: true },
    });
    if (!d || !d.pendingReply)
      throw new NotFoundException(
        'Задание отправки голосового больше недоступно',
      );
    if (d.task.source === 'bot') {
      if (!this.autoVoice)
        throw new BadRequestException('Автоматическая отправка недоступна');
      const problem = await this.autoVoice.problem(d.task);
      if (problem) throw new BadRequestException(problem);
    }
    const [actor, contact] = await Promise.all([
      this.prisma.dashboardUser.findUnique({ where: { id: d.requestedById } }),
      this.prisma.contact.findUnique({
        where: { chatId: d.chatId },
        include: { account: { include: { manager: true } } },
      }),
    ]);
    if (!actor || !['manager', 'admin'].includes(actor.role))
      throw new BadRequestException(
        'Автор задания больше не имеет права отправлять сообщения',
      );
    if (
      !contact?.account ||
      contact.accountId !== d.accountId ||
      contact.account.personaId !== d.personaSlug
    )
      throw new BadRequestException(
        'Аккаунт или личность диалога изменились. Создайте новое задание',
      );
    if (
      actor.role === 'manager' &&
      contact.account.manager?.userId !== actor.id
    )
      throw new BadRequestException('Диалог больше не закреплён за менеджером');
    if (d.mode === 'once') {
      const owner = contact.account.manager?.userId;
      const grant =
        !owner &&
        d.task.chatGrantAccountId === d.accountId &&
        Boolean(d.task.chatGrantedById);
      if (
        d.task.chatId !== d.chatId ||
        d.task.sendAccountId !== d.accountId ||
        !d.task.managerId ||
        (owner !== d.task.managerId && !grant)
      )
        throw new BadRequestException(
          'Привязка диалога к заданию изменилась. Отправка остановлена',
        );
    }
    if (
      d.task.status === 'cancelled' ||
      d.recording.revision !== d.task.revision ||
      d.recording.taskId !== d.task.id
    )
      throw new BadRequestException(
        'Запись отменена или заменена новой версией',
      );
    if (d.mode === 'library' && !['ready', 'completed'].includes(d.task.status))
      throw new BadRequestException('Запись ещё не готова к отправке');
    if (contact.blockedByClientAt)
      throw new BadRequestException('Собеседник заблокировал Telegram-аккаунт');
    if (contact.account.status !== 'active')
      throw new BadRequestException(
        'Telegram-аккаунт не подключён. Подключите его и повторите отправку',
      );
    const path = await realpath(d.recording.filePath).catch(() => null);
    const base = await realpath(resolve(appConfig.mediaDir, 'voicer')).catch(
      () => null,
    );
    const rel = path && base ? relative(base, path) : '..';
    if (
      !path ||
      !base ||
      !rel ||
      rel.startsWith('..') ||
      isAbsolute(rel) ||
      d.pendingReply.filePath !== d.recording.filePath
    )
      throw new BadRequestException('Файл голосового недоступен');
    return d;
  }

  async replyContext(replyId: number) {
    return this.prisma.voiceDelivery.findUnique({
      where: { pendingReplyId: replyId },
      select: { task: { select: { source: true, autoReplyId: true } } },
    });
  }

  async historyText(replyId: number) {
    return (
      (
        await this.prisma.voiceDelivery.findUnique({
          where: { pendingReplyId: replyId },
          select: { historyText: true },
        })
      )?.historyText ?? ''
    );
  }

  async retry(id: number) {
    return this.prisma.$transaction(async (tx) => {
      const d = await tx.voiceDelivery.findUnique({
        where: { id },
        include: { pendingReply: true, task: true },
      });
      if (d?.task.status === 'cancelled')
        throw new ConflictException('Задание отменено');
      const p = d?.pendingReply;
      if (
        !p ||
        p.status !== 'failed' ||
        parse(p.delivery).dispatchedAt ||
        parse(p.delivery).ids?.length
      ) {
        throw new ConflictException(
          'Повтор разрешён только если отправка в Telegram ещё не начиналась',
        );
      }
      const changed = await tx.pendingReply.updateMany({
        where: { id: p.id, status: 'failed' },
        data: { status: 'pending', error: null, retryAt: null },
      });
      if (!changed.count)
        throw new ConflictException('Отправка уже обновилась');
      await tx.voiceDelivery.update({
        where: { id },
        data: { notifiedStatus: '' },
      });
      if (d.mode === 'once')
        await tx.voiceTask.updateMany({
          where: { id: d.taskId, status: { not: 'cancelled' } },
          data: { status: 'delivering', updatedAt: this.clock.ts() },
        });
    });
  }

  async pauseOnManual() {
    const settings = await this.prisma.appSettings.findUnique({
      where: { id: 1 },
    });
    return (
      parse(settings?.customPrompt ?? null).pause_on_manual_message === true
    );
  }

  async cancelUnsent(taskId: number, revision: number) {
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.voiceTask.findUniqueOrThrow({
        where: { id: taskId },
      });
      const d = await tx.voiceDelivery.findFirst({
        where: { taskId },
        orderBy: { id: 'desc' },
        include: { pendingReply: true },
      });
      const p = d?.pendingReply;
      if (
        task.revision !== revision ||
        task.status !== 'delivery_error' ||
        !p ||
        p.status !== 'failed' ||
        parse(p.delivery).dispatchedAt ||
        parse(p.delivery).ids?.length
      ) {
        throw new ConflictException(
          'Отправка уже началась или требует проверки в Telegram',
        );
      }
      await tx.voiceTask.update({
        where: { id: taskId },
        data: {
          status: 'cancelled',
          outcome: 'Менеджер отменил неотправленное голосовое',
          updatedAt: this.clock.ts(),
          notifyVersion: { increment: 1 },
          notifyAfter: 0,
        },
      });
    });
  }

  async syncReply(replyId: number) {
    await this.prisma.$transaction(async (tx) => {
      const d = await tx.voiceDelivery.findUnique({
        where: { pendingReplyId: replyId },
        include: { pendingReply: true, task: true },
      });
      if (!d) return;
      const status = d.pendingReply?.status ?? 'needs_review';
      const terminal = ['sent', 'failed', 'needs_review', 'resolved'].includes(
        status,
      );
      if (d.mode === 'once') {
        const next =
          status === 'sent'
            ? 'sent'
            : status === 'failed'
              ? 'delivery_error'
              : status === 'resolved'
                ? 'delivery_closed'
                : terminal
                  ? 'delivery_review'
                  : 'delivering';
        await tx.voiceTask.updateMany({
          where: {
            id: d.taskId,
            status: { in: ['delivering', 'delivery_error', 'delivery_review'] },
          },
          data: { status: next, updatedAt: this.clock.ts() },
        });
      }
      if (terminal && d.notifiedStatus !== status) {
        const text =
          status === 'resolved'
            ? `Проверка доставки «${d.task.title}» закрыта менеджером. Автоматического повтора не будет.`
            : status === 'sent'
              ? `Голосовое отправлено: «${d.task.title}» → диалог ${d.chatId}.`
              : status === 'failed'
                ? `Не удалось отправить голосовое «${d.task.title}». ${d.pendingReply?.error || 'Откройте задание'}`
                : `Проверьте отправку голосового «${d.task.title}» в Telegram. Подтверждение не получено; автоматического повтора не будет.`;
        await voiceNotice(
          tx,
          d.task,
          `delivery:${d.id}:${status}`,
          text,
          this.clock.ts(),
        );
        await tx.voiceDelivery.update({
          where: { id: d.id },
          data: { notifiedStatus: status },
        });
      }
    });
  }

  @Cron('*/5 * * * * *')
  async reconcile() {
    const rows = await this.prisma.voiceDelivery.findMany({
      where: {
        OR: ['sent', 'failed', 'needs_review', 'resolved'].map((status) => ({
          notifiedStatus: { not: status },
          pendingReply: { status },
        })),
      },
      take: 100,
    });
    for (const d of rows)
      if (d.pendingReplyId) await this.syncReply(d.pendingReplyId);
    const missing = await this.prisma.voiceDelivery.findMany({
      where: { notifiedStatus: '', pendingReply: null },
      include: { task: true },
      take: 100,
    });
    for (const d of missing)
      await this.prisma.$transaction(async (tx) => {
        await tx.voiceTask.updateMany({
          where: { id: d.taskId, status: 'delivering' },
          data: { status: 'delivery_review', updatedAt: this.clock.ts() },
        });
        await voiceNotice(
          tx,
          d.task,
          `delivery:${d.id}:missing`,
          `Данные отправки голосового «${d.task.title}» удалены. Проверьте диалог перед повторной отправкой.`,
          this.clock.ts(),
        );
        await tx.voiceDelivery.update({
          where: { id: d.id },
          data: { notifiedStatus: 'needs_review' },
        });
      });
  }
}
