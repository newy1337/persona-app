import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { toChatId } from 'src/utils/ids';
import type { ReplyDelivery } from './reply-delivery';
import type { InboundTurn } from './reply-brain.port';

/** Одно входящее в ожидании ответа: сам ход и подписанный текст, как он лёг в историю. */
export interface PendingTurn {
  turn: InboundTurn;
  /** «[Фото]\nподпись» — то, что прочитает модель. */
  text: string;
  modality: string;
}

export interface ScheduledReply {
  chatId: number;
  accountId: number;
  dueAt: number;
  baseDueAt: number;
  /** Когда она открыла чат; null — ещё не открывала. */
  openedAt: number | null;
  reason: string;
  turns: PendingTurn[];
  createdAt: number;
  delivery: ReplyDelivery | null;
}

const parseTurns = (raw: string): PendingTurn[] => {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

/** Поток сообщений отодвигает ответ не дальше этого: болтливый собеседник не должен ждать вечно. */
export const BURST_CAP_SECONDS = 5 * 60;

const view = (row: {
  chatId: bigint;
  accountId: number;
  dueAt: number;
  baseDueAt: number;
  openedAt: number | null;
  reason: string;
  turns: string;
  createdAt: number;
  delivery?: string | null;
}): ScheduledReply => ({
  chatId: Number(row.chatId),
  accountId: row.accountId,
  dueAt: row.dueAt,
  baseDueAt: row.baseDueAt,
  openedAt: row.openedAt,
  reason: row.reason,
  turns: parseTurns(row.turns),
  createdAt: row.createdAt,
  delivery: row.delivery ? JSON.parse(row.delivery) : null,
});

/**
 * Очередь отложенных ответов: одна строка на чат.
 *
 * Всё, что собеседник написал, пока она «не видела», копится в одной строке и
 * уходит одним ответом — как у человека, который открыл чат и прочёл всё разом.
 * Пока он пишет, ответ ждёт паузы в потоке — но не дольше `BURST_CAP_SECONDS`
 * после первого срока: болтливый собеседник не отодвинет ответ бесконечно.
 *
 * Строки живут в базе — рестарт процесса ответов не теряет. Работа с одной
 * строкой идёт под замком чата в мозге. Она остаётся до подтверждённой доставки.
 */
@Injectable()
export class ReplyScheduleService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  async get(chatId: number): Promise<ScheduledReply | null> {
    const row = await this.prisma.replySchedule.findUnique({
      where: { chatId: toChatId(chatId) },
    });
    return row ? view(row) : null;
  }

  async create(
    chatId: number,
    accountId: number,
    entry: PendingTurn,
    dueAt: number,
    reason: string,
  ): Promise<ScheduledReply> {
    const row = await this.prisma.replySchedule.create({
      data: {
        chatId: toChatId(chatId),
        accountId,
        dueAt,
        baseDueAt: dueAt,
        reason,
        turns: JSON.stringify([entry]),
        createdAt: this.clock.ts(),
      },
    });
    return view(row);
  }

  /**
   * Ещё одно сообщение в ту же очередь. Срок сдвигается до `notBefore` (пауза в
   * потоке, время прослушать голосовое), но не дальше первого срока + предел.
   */
  async append(
    chatId: number,
    entry: PendingTurn,
    notBefore = 0,
  ): Promise<ScheduledReply | null> {
    const current = await this.get(chatId);
    if (!current) return null;
    if (current.turns.some((t) => t.turn.messageId === entry.turn.messageId))
      return current;
    const dueAt = Math.max(
      current.dueAt,
      Math.min(notBefore, current.baseDueAt + BURST_CAP_SECONDS),
    );
    const row = await this.prisma.replySchedule.update({
      where: { chatId: toChatId(chatId) },
      data: { turns: JSON.stringify([...current.turns, entry]), dueAt },
    });
    return view(row);
  }

  /** Она открыла чат: прочитала всё и слушает голосовые до `dueAt`. */
  async open(chatId: number, openedAt: number, dueAt: number): Promise<void> {
    await this.prisma.replySchedule.updateMany({
      where: { chatId: toChatId(chatId) },
      data: { openedAt, dueAt },
    });
  }

  /** Удалённые им сообщения выпадают из очереди; ничего не осталось — отвечать не на что. */
  async removeTurns(
    chatId: number,
    messageIds: number[],
  ): Promise<ScheduledReply | null> {
    const current = await this.get(chatId);
    if (!current) return null;
    const gone = new Set(messageIds);
    const turns = current.turns.filter((t) => !gone.has(t.turn.messageId));
    if (turns.length === current.turns.length) return current;
    if (!turns.length) {
      await this.drop(chatId);
      return null;
    }
    const row = await this.prisma.replySchedule.update({
      where: { chatId: toChatId(chatId) },
      data: { turns: JSON.stringify(turns) },
    });
    return view(row);
  }

  /** Забрать строку, если её срок наступил. Вызывается под замком чата. */
  async claim(chatId: number, now: number): Promise<ScheduledReply | null> {
    const current = await this.get(chatId);
    if (!current || current.dueAt > now) return null;
    return current;
  }

  /**
   * Перенести повтор после ошибки генерации или доставки, сохранив подтверждённые части.
   * Входящие сообщения и подготовленный ответ остаются в базе всё время обработки.
   */
  async restore(
    taken: ScheduledReply,
    dueAt: number,
    reason: string,
  ): Promise<void> {
    const current = await this.get(taken.chatId);
    if (current) {
      const known = new Set(current.turns.map((t) => t.turn.messageId));
      const turns = [
        ...taken.turns.filter((t) => !known.has(t.turn.messageId)),
        ...current.turns,
      ];
      await this.prisma.replySchedule.update({
        where: { chatId: toChatId(taken.chatId) },
        data: { turns: JSON.stringify(turns), dueAt, reason },
      });
      return;
    }
    await this.prisma.replySchedule.create({
      data: {
        chatId: toChatId(taken.chatId),
        accountId: taken.accountId,
        dueAt,
        baseDueAt: dueAt,
        openedAt: taken.openedAt,
        reason,
        turns: JSON.stringify(taken.turns),
        createdAt: taken.createdAt,
      },
    });
  }

  async prepare(chatId: number, delivery: ReplyDelivery): Promise<boolean> {
    const result = await this.prisma.replySchedule.updateMany({
      where: { chatId: toChatId(chatId) },
      data: { delivery: JSON.stringify(delivery) },
    });
    return result.count === 1;
  }

  async editText(
    chatId: number,
    role: string,
    oldText: string,
    newText: string,
    telegramId?: number,
  ): Promise<void> {
    if (role !== 'user') return;
    const pending = await this.get(chatId);
    if (!pending) return;
    const turn = [...pending.turns]
      .reverse()
      .find((t) =>
        telegramId
          ? t.turn.messageId === telegramId
          : t.text === oldText || t.turn.text === oldText,
      );
    if (!turn) return;
    turn.text = newText;
    turn.turn.text = newText;
    await this.prisma.replySchedule.updateMany({
      where: { chatId: toChatId(chatId) },
      data: { turns: JSON.stringify(pending.turns) },
    });
  }

  /** Discard stale text, retaining unanswered inputs only when nothing was sent. */
  async invalidate(chatId: number): Promise<void> {
    const current = await this.get(chatId);
    if (!current?.delivery) return;
    if (current.delivery.sentCount > 0) await this.drop(chatId);
    else
      await this.prisma.replySchedule.updateMany({
        where: { chatId: toChatId(chatId) },
        data: { delivery: null },
      });
  }

  async defer(chatId: number, dueAt: number, reason: string): Promise<void> {
    await this.prisma.replySchedule.updateMany({
      where: { chatId: toChatId(chatId) },
      data: { dueAt, reason },
    });
  }

  /** Ответ ждёт аккаунт, который не в сети: срок сдвигается, причина — «offline». */
  async postpone(chatId: number, dueAt: number): Promise<void> {
    await this.prisma.replySchedule.updateMany({
      where: { chatId: toChatId(chatId) },
      data: { dueAt, reason: 'offline' },
    });
  }

  /** Оператор ответил сам или чат забрали — боту отвечать уже не на что. */
  async drop(chatId: number): Promise<void> {
    await this.prisma.replySchedule.deleteMany({
      where: { chatId: toChatId(chatId) },
    });
  }

  async dueChatIds(now: number, limit = 50): Promise<number[]> {
    return (await this.dueRows(now, limit)).map((r) => r.chatId);
  }

  /** Наступившие ответы вместе с аккаунтом: по нему мозг раскладывает их по потокам. */
  async dueRows(
    now: number,
    limit = 50,
  ): Promise<Array<{ chatId: number; accountId: number }>> {
    const rows = await this.prisma.replySchedule.findMany({
      where: { dueAt: { lte: now } },
      orderBy: { dueAt: 'asc' },
      take: limit,
      select: { chatId: true, accountId: true },
    });
    return rows.map((r) => ({
      chatId: Number(r.chatId),
      accountId: r.accountId,
    }));
  }
}
