import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HistoryService } from 'src/shared/history.service';
import { ClockService } from 'src/shared/clock.service';
import { GlobalGateService } from 'src/shared/global-gate.service';
import { PauseService } from 'src/shared/pause.service';
import { REPLY_BRAIN, ReplyBrain } from 'src/brain/reply-brain.port';
import { RELAY_ACTION } from 'src/modules/operator/operator.service';
import { TelegramService } from './telegram.service';
import { deliveryRandomId } from 'src/brain/reply-delivery';
import { TakeoverReason } from 'src/domain/pause';
import { VoicerDeliveryService } from '../voicer/voicer-delivery.service';
import { KIND_LABEL, kindForFile } from 'src/domain/attachments';

/**
 * Одна строка на диалог — самая старая. Тик идёт каждые пять секунд, и если
 * брать все застрявшие сообщения, номер в тексте причины меняется от тика к
 * тику: защита от повторов в pause.pause сравнивает текст целиком и не
 * срабатывает, а в базу каждые пять секунд уходит новое состояние паузы и новое
 * событие воронки. На продакшне так набежало 206 тысяч событий по одному чату.
 */
export function oldestPerChat<T extends { id: number; chatId: bigint | number }>(
  rows: T[],
): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = String(row.chatId);
    const seen = best.get(key);
    if (!seen || row.id < seen.id) best.set(key, row);
  }
  return [...best.values()];
}

@Injectable()
export class RelayWorker implements OnModuleInit {
  private readonly log = new Logger(RelayWorker.name);
  private running = false;

  constructor(
    private history: HistoryService,
    private clock: ClockService,
    private gate: GlobalGateService,
    private pause: PauseService,
    private telegram: TelegramService,
    @Inject(forwardRef(() => REPLY_BRAIN)) private brain: ReplyBrain,
    @Optional() private voiceDelivery?: VoicerDeliveryService,
  ) {}

  async onModuleInit() {
    await this.history.recoverManualReplies(true);
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.history.recoverManualReplies();
      for (const row of oldestPerChat(await this.history.manualReviewRows())) {
        await this.pause.pause(
          Number(row.chatId),
          TakeoverReason.HOLD,
          'system:manual_delivery',
          {
            reasonText: `Ручное сообщение №${row.id}: ${row.error || 'проверьте доставку в Telegram, затем включите бота'}`,
          },
        );
      }
      await this.deliverManualReplies();
      await this.deliverRelays();
      await this.pause.autoResumeDue();
    } catch (e) {
      this.log.error(`relay tick failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }

  private async deliverManualReplies() {
    for (const reply of await this.history.pendingManualReplies()) {
      const chatId = Number(reply.chatId);
      const claimed = await this.history.claimManualReply(reply.id);
      if (!claimed) continue;
      let delivery: any;
      try {
        delivery = JSON.parse(claimed.delivery ?? 'null');
      } catch {
        delivery = null;
      }
      delivery ??= { version: 1, randomId: deliveryRandomId() };
      const automated = claimed.source.startsWith('bot:voicer:');
      const voicer = automated || claimed.source.startsWith('operator:voicer:');
      try {
        if (voicer && !delivery.ids?.length) {
          try {
            if (!this.voiceDelivery)
              throw new Error('Сервис отправки голосовых недоступен');
            await this.voiceDelivery.beforeDispatch(reply.id);
          } catch (e) {
            await this.history.failManualReply(
              reply.id,
              String(e?.message ?? e),
            );
            continue;
          }
          if (!automated) await this.brain.noteOperatorQueued?.(chatId);
          if (!automated && (await this.voiceDelivery!.pauseOnManual()))
            await this.pause.pause(
              chatId,
              TakeoverReason.MANUAL_TAKEOVER,
              'manager:manual_message',
            );
        }
        delivery.attempts = (delivery.attempts ?? 0) + 1;
        await this.history.saveManualDelivery(reply.id, delivery);
        if (!delivery.ids?.length) {
          const dispatch = async () => {
            delivery.dispatchedAt = this.clock.ts();
            await this.history.saveManualDelivery(reply.id, delivery);
          };
          if (claimed.kind === 'text') {
            await this.telegram.sendText(chatId, [claimed.text], {
              accountId: claimed.accountId,
              replyTo: claimed.replyTo,
              randomIds: [delivery.randomId],
              onDispatch: dispatch,
              onPart: async (_i, id) => {
                delivery.ids = [id];
                delivery.confirmedAt = this.clock.ts();
                await this.history.saveManualDelivery(reply.id, delivery);
              },
            });
          } else {
            if (!voicer) await dispatch();
            delivery.ids = await this.deliverMedia(
              chatId,
              claimed,
              voicer
                ? async () => {
                    await this.voiceDelivery!.beforeDispatch(reply.id);
                    await dispatch();
                  }
                : undefined,
            );
            delivery.confirmedAt = this.clock.ts();
            await this.history.saveManualDelivery(reply.id, delivery);
          }
        }
        await this.recordDelivery(
          chatId,
          voicer
            ? {
                ...claimed,
                text: await this.voiceDelivery!.historyText(reply.id),
              }
            : claimed,
          delivery.ids,
          delivery.confirmedAt ?? this.clock.ts(),
          automated
            ? ((await this.voiceDelivery!.replyContext(reply.id))?.task
                .autoReplyId ?? undefined)
            : undefined,
        );
        await this.history.markManualReplySent(reply.id);
      } catch (e) {
        const error = String(e?.message ?? e);
        if (
          (claimed.kind === 'text' ||
            delivery.ids?.length ||
            !delivery.dispatchedAt) &&
          (delivery.attempts ?? 0) < 5
        ) {
          await this.history.retryManualReply(
            reply.id,
            error,
            this.clock.ts() + 30 * Math.max(1, delivery.attempts ?? 1),
          );
        } else {
          await this.history.reviewManualReply(
            reply.id,
            'Не удалось подтвердить доставку. Проверьте Telegram, затем включите бота. Сообщение не будет повторено автоматически.',
          );
          await this.pause.pause(
            chatId,
            TakeoverReason.HOLD,
            'system:manual_delivery',
            {
              reasonText: `Проверьте доставку ручного сообщения №${reply.id} в Telegram, затем включите бота`,
            },
          );
        }
        this.log.warn(
          `manual reply ${reply.id} failed chat=${chatId}: ${error}`,
        );
      } finally {
        if (voicer) await this.voiceDelivery?.syncReply(reply.id);
      }
    }
  }

  private async deliverMedia(
    chatId: number,
    row: {
      text: string;
      kind: string;
      filePath: string | null;
      replyTo: number | null;
      accountId: number | null;
    },
    beforeSend?: () => Promise<void>,
  ): Promise<number[]> {
    if (row.kind === 'reaction') {
      if (!row.replyTo) throw new Error('реакции нужен id сообщения');
      await this.telegram.sendReaction(chatId, row.replyTo, row.text);
      await this.history.setReaction(chatId, row.replyTo, row.text || null);
      return [row.replyTo];
    }
    if (row.kind === 'album') {
      const paths: string[] = JSON.parse(row.filePath ?? '[]');
      if (!paths.length) throw new Error('в альбоме нет файлов');
      return this.telegram.sendAlbum(chatId, paths, {
        caption: row.text,
        replyTo: row.replyTo,
        accountId: row.accountId,
      });
    }
    if (!row.filePath) throw new Error(`вложению «${row.kind}» нужен файл`);
    return [
      await this.telegram.sendMedia(chatId, {
        kind: row.kind,
        source: row.filePath,
        caption: row.text,
        replyTo: row.replyTo,
        accountId: row.accountId,
        ...(beforeSend ? { beforeSend } : {}),
      }),
    ];
  }

  private async recordDelivery(
    chatId: number,
    row: {
      text: string;
      kind: string;
      filePath: string | null;
      replyTo: number | null;
      source: string;
    },
    ids: number[],
    ts: number,
    autoReplyId?: string,
  ): Promise<void> {
    if (row.kind === 'reaction') return;
    const paths =
      row.kind === 'album'
        ? (JSON.parse(row.filePath ?? '[]') as string[])
        : [row.filePath];
    for (const [i, path] of paths.entries()) {
      if (!ids[i])
        throw new Error('Telegram не подтвердил все части сообщения');
      const kind =
        row.kind === 'album'
          ? kindForFile(path!) === 'video'
            ? 'video'
            : 'photo'
          : row.kind;
      await this.history.appendMessage(chatId, {
        role: 'assistant',
        text: (i === 0 && row.text) || KIND_LABEL[kind] || `[${kind}]`,
        ts,
        author:
          row.source.startsWith('operator:') ||
          row.source.startsWith('bot:voicer:')
            ? row.source
            : 'operator:web',
        tgMsgId: ids[i],
        mediaKind: kind === 'text' ? null : kind,
        filePath: path,
        replyTo: i === 0 ? row.replyTo : null,
      });
    }
    if (autoReplyId && this.brain.noteAutomatedVoiceMessage)
      await this.brain.noteAutomatedVoiceMessage(
        chatId,
        row.text,
        ts,
        autoReplyId,
      );
    else await this.brain.noteOperatorMessage(chatId);
  }

  private async deliverRelays() {
    const chats = await this.history['prisma'].pendingAdminAction.findMany({
      where: { status: 'pending', action: RELAY_ACTION },
      distinct: ['chatId'],
      select: { chatId: true },
    });
    for (const { chatId: raw } of chats) {
      const chatId = Number(raw);
      for (const action of await this.history.pendingAdminActions(chatId)) {
        if (action.action !== RELAY_ACTION) continue;
        const claimed = await this.history.claimAdminAction(action.id);
        if (!claimed) continue;
        try {
          const data = JSON.parse(claimed.payload);
          const text = String(data.text);
          const ids = await this.telegram.sendText(chatId, [text], {
            accountId: claimed.accountId,
          });
          const ts = this.clock.ts();
          await this.history.appendMessage(chatId, {
            role: 'assistant',
            text,
            ts,
            author: `operator:${data.operator}`,
            tgMsgId: ids[0] ?? null,
          });
          await this.brain.noteOperatorMessage(chatId);
          await this.history.completeAdminAction(action.id);
        } catch (e) {
          await this.history.completeAdminAction(
            action.id,
            String(e?.message ?? e),
          );
          this.log.warn(
            `relay ${action.id} failed chat=${chatId}: ${e?.message ?? e}`,
          );
        }
      }
    }
  }
}
