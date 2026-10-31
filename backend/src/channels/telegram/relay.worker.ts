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
import { VoicerDeliveryService } from '../../modules/voicer/voicer-delivery.service';
import { KIND_LABEL, kindForFile } from 'src/domain/attachments';
import { PhotoLibraryService } from 'src/shared/photo-library.service';
import { ChannelRegistry } from 'src/channels/registry';
import { peerOf } from 'src/channels/ids';
import type { OutboundTransport } from 'src/brain/reply-brain.port';

/** Что из панели умеет уйти в VK: текст, фото и реакция. Остальное — только Telegram. */
const VK_KINDS = new Set(['text', 'photo', 'reaction']);

/** Как назвать мессенджер чата в подсказке менеджеру. */
const channelTitle = (chatId: number | bigint) =>
  peerOf(chatId).channel === 'vk' ? 'ВКонтакте' : 'Telegram';

/**
 * Одна строка на диалог — самая старая. Тик идёт каждые пять секунд, и если
 * брать все застрявшие сообщения, номер в тексте причины меняется от тика к
 * тику: защита от повторов в pause.pause сравнивает текст целиком и не
 * срабатывает, а в базу каждые пять секунд уходит новое состояние паузы и новое
 * событие воронки. На продакшне так набежало 206 тысяч событий по одному чату.
 */
export function oldestPerChat<
  T extends { id: number; chatId: bigint | number },
>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = String(row.chatId);
    const seen = best.get(key);
    if (!seen || row.id < seen.id) best.set(key, row);
  }
  return [...best.values()];
}

/** Сколько чатов одновременно получают ручные сообщения. */
const MANUAL_PARALLEL = 10;

@Injectable()
export class RelayWorker implements OnModuleInit {
  private readonly log = new Logger(RelayWorker.name);
  private running = false;
  /** чаты, в которые сейчас уходят ручные сообщения */
  private readonly sending = new Set<string>();

  constructor(
    private history: HistoryService,
    private clock: ClockService,
    private gate: GlobalGateService,
    private pause: PauseService,
    private telegram: TelegramService,
    @Inject(forwardRef(() => REPLY_BRAIN)) private brain: ReplyBrain,
    @Optional() private voiceDelivery?: VoicerDeliveryService,
    @Optional() private photos?: PhotoLibraryService,
    @Optional() private channels?: ChannelRegistry,
  ) {}

  /**
   * Через что слать в чат: Telegram-чат — Telegram-сервисом (он умеет все
   * вложения), VK-чат — каналом VK из реестра. Без реестра (тесты) — Telegram.
   */
  private vkFor(chatId: number): OutboundTransport | null {
    return peerOf(chatId).channel === 'vk' && this.channels
      ? this.channels.get('vk')
      : null;
  }

  async onModuleInit() {
    await this.history.recoverManualReplies(true);
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async tick() {
    if (this.running) return;
    this.running = true;
    let manual: Promise<void>[] = [];
    try {
      await this.history.recoverManualReplies();
      for (const row of oldestPerChat(await this.history.manualReviewRows())) {
        await this.pause.pause(
          Number(row.chatId),
          TakeoverReason.HOLD,
          'system:manual_delivery',
          {
            reasonText: `Ручное сообщение №${row.id}: ${row.error || `проверьте доставку в ${channelTitle(row.chatId)}, затем включите бота`}`,
          },
        );
      }
      manual = this.startManualReplies(
        await this.history.pendingManualReplies(),
      );
      await this.deliverRelays();
      await this.pause.autoResumeDue();
    } catch (e) {
      this.log.error(`relay tick failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
    // Следующий тик не ждёт долгих отправок: берёт новые чаты.
    await Promise.all(manual);
  }

  /**
   * Ручные сообщения: чаты — параллельно (до MANUAL_PARALLEL), внутри чата —
   * по порядку. Иначе одна долгая отправка (имитация набора, мёртвый прокси)
   * держала очередь всех менеджеров минутами. Чат, который ещё отправляется,
   * следующий тик не трогает.
   */
  private startManualReplies(
    rows: Awaited<ReturnType<HistoryService['pendingManualReplies']>>,
  ): Promise<void>[] {
    const byChat = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = String(row.chatId);
      byChat.set(key, [...(byChat.get(key) ?? []), row]);
    }
    const started: Promise<void>[] = [];
    for (const [key, replies] of byChat) {
      if (this.sending.has(key)) continue;
      if (this.sending.size >= MANUAL_PARALLEL) break;
      this.sending.add(key);
      started.push(
        (async () => {
          try {
            for (const reply of replies) await this.deliverManualReply(reply);
          } catch (e) {
            this.log.error(
              `manual delivery failed chat=${key}: ${e?.message ?? e}`,
            );
          } finally {
            this.sending.delete(key);
          }
        })(),
      );
    }
    return started;
  }

  /** Все ждущие ручные сообщения — до конца (тесты, ручной прогон). */
  async deliverManualReplies() {
    await Promise.all(
      this.startManualReplies(await this.history.pendingManualReplies()),
    );
  }

  private async deliverManualReply(
    reply: Awaited<ReturnType<HistoryService['pendingManualReplies']>>[number],
  ) {
    const chatId = Number(reply.chatId);
    const claimed = await this.history.claimManualReply(reply.id);
    if (!claimed) return;
    let delivery: any;
    try {
      delivery = JSON.parse(claimed.delivery ?? 'null');
    } catch {
      delivery = null;
    }
    delivery ??= { version: 1, randomId: deliveryRandomId() };
    const automated = claimed.source.startsWith('bot:voicer:');
    const voicer = automated || claimed.source.startsWith('operator:voicer:');
    const vk = this.vkFor(chatId);
    // VK не принимает из панели видео, голосовые, файлы, стикеры и альбомы:
    // повторять бессмысленно — сразу на проверку с понятной причиной.
    if (vk && !VK_KINDS.has(claimed.kind) && !delivery.dispatchedAt) {
      const label = (KIND_LABEL[claimed.kind] ?? claimed.kind).replace(
        /[[\]]/g,
        '',
      );
      const reason = `ВКонтакте пока не умеет отправлять из панели «${claimed.kind === 'album' ? 'альбом' : label}» — отправьте текстом или фото. Сообщение не отправлено.`;
      await this.history.reviewManualReply(reply.id, reason);
      await this.pause.pause(
        chatId,
        TakeoverReason.HOLD,
        'system:manual_delivery',
        { reasonText: `Ручное сообщение №${reply.id}: ${reason}` },
      );
      this.log.warn(
        `manual reply ${reply.id} chat=${chatId}: ${claimed.kind} is not supported by VK`,
      );
      if (voicer) await this.voiceDelivery?.syncReply(reply.id);
      return;
    }
    try {
      if (voicer && !delivery.ids?.length) {
        try {
          if (!this.voiceDelivery)
            throw new Error('Сервис отправки голосовых недоступен');
          await this.voiceDelivery.beforeDispatch(reply.id);
        } catch (e) {
          await this.history.failManualReply(reply.id, String(e?.message ?? e));
          return;
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
          await (vk ?? this.telegram).sendText(chatId, [claimed.text], {
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
            { ...claimed, randomId: delivery.randomId },
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
          `Не удалось подтвердить доставку. Проверьте ${channelTitle(chatId)}, затем включите бота. Сообщение не будет повторено автоматически.`,
        );
        await this.pause.pause(
          chatId,
          TakeoverReason.HOLD,
          'system:manual_delivery',
          {
            reasonText: `Проверьте доставку ручного сообщения №${reply.id} в ${channelTitle(chatId)}, затем включите бота`,
          },
        );
      }
      this.log.warn(`manual reply ${reply.id} failed chat=${chatId}: ${error}`);
    } finally {
      if (voicer) await this.voiceDelivery?.syncReply(reply.id);
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
      randomId?: string;
    },
    beforeSend?: () => Promise<void>,
  ): Promise<number[]> {
    const vk = this.vkFor(chatId);
    if (row.kind === 'reaction') {
      if (!row.replyTo) throw new Error('реакции нужен id сообщения');
      await (vk ?? this.telegram).sendReaction(chatId, row.replyTo, row.text);
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
    if (vk) {
      if (row.kind !== 'photo' || !vk.sendPhoto)
        throw new Error(`ВКонтакте не умеет отправлять «${row.kind}»`);
      return [
        await vk.sendPhoto(chatId, {
          path: row.filePath,
          caption: row.text,
          randomId: row.randomId ?? deliveryRandomId(),
          accountId: row.accountId,
          ...(beforeSend ? { onDispatch: beforeSend } : {}),
        }),
      ];
    }
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
      photoId?: number | null;
      accountId?: number | null;
    },
    ids: number[],
    ts: number,
    autoReplyId?: string,
  ): Promise<void> {
    if (row.kind === 'reaction') return;
    const libraryPhoto =
      row.photoId && this.photos ? await this.photos.photo(row.photoId) : null;
    const note = libraryPhoto ? this.photos!.note(libraryPhoto) : null;
    const paths =
      row.kind === 'album'
        ? (JSON.parse(row.filePath ?? '[]') as string[])
        : [row.filePath];
    for (const [i, path] of paths.entries()) {
      if (!ids[i])
        throw new Error(
          `${channelTitle(chatId)} не подтвердил все части сообщения`,
        );
      const kind =
        row.kind === 'album'
          ? kindForFile(path!) === 'video'
            ? 'video'
            : 'photo'
          : row.kind;
      const stored = await this.history.appendMessage(chatId, {
        role: 'assistant',
        text: (i === 0 && row.text) || KIND_LABEL[kind] || `[${kind}]`,
        ts,
        author:
          row.source.startsWith('operator:') ||
          row.source.startsWith('bot:voicer:')
            ? row.source
            : 'operator:web',
        peerMsgId: ids[i],
        mediaKind: kind === 'text' ? null : kind,
        filePath: path,
        replyTo: i === 0 ? row.replyTo : null,
        mediaNote: i === 0 ? note : null,
      });
      // Ручная отправка из образа тоже отмечается: бот потом не повторит снимок.
      if (i === 0 && libraryPhoto && stored)
        await this.photos!.recordSend({
          chatId,
          photoId: libraryPhoto.id,
          accountId: row.accountId ?? null,
          messageId: stored.id,
          peerMsgId: ids[0],
          caption: row.text,
          note: note ?? '',
          source: 'manager',
          actor: row.source,
          sentAt: ts,
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
          const ids = await (this.vkFor(chatId) ?? this.telegram).sendText(
            chatId,
            [text],
            { accountId: claimed.accountId },
          );
          const ts = this.clock.ts();
          await this.history.appendMessage(chatId, {
            role: 'assistant',
            text,
            ts,
            author: `operator:${data.operator}`,
            peerMsgId: ids[0] ?? null,
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
