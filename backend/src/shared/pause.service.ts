import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { HistoryService } from './history.service';
import { ClockService } from './clock.service';
import { FunnelEventsService } from './funnel-events.service';
import {
  BOT_ACTIVE_REASON,
  PAUSE_REASON_SEP,
  PauseState,
  TakeoverReason,
} from '../domain/pause';
import { HANDOFF_TRIGGER_KEY, MEDIA_REQUEST_KEY } from '../domain/lead-facts';

@Injectable()
export class PauseService {
  constructor(
    private history: HistoryService,
    private clock: ClockService,
    private funnel: FunnelEventsService,
    private prisma: PrismaService,
  ) {}

  async pause(
    chatId: number,
    reason: TakeoverReason,
    actor: string,
    opts: { until?: number | null; reasonText?: string | null } = {},
  ): Promise<void> {
    if (reason === TakeoverReason.MANUAL_TAKEOVER && opts.until != null) {
      throw new Error(
        'paused_until несовместим с MANUAL_TAKEOVER (auto-resume запрещён)',
      );
    }
    const pauseReason = opts.reasonText
      ? `${reason}${PAUSE_REASON_SEP}${opts.reasonText}`
      : reason;
    const current = await this.history.getPause(chatId);
    if (
      current.status === 'paused' &&
      current.reason === pauseReason &&
      current.actor === actor
    ) {
      return;
    }
    const ts = this.clock.ts();
    await this.history.setPause(chatId, {
      status: 'paused',
      reason: pauseReason,
      actor,
      ts,
      until: opts.until ?? null,
    });
    await this.funnel.emit(chatId, 'conversation_paused', ts, {
      reason: pauseReason,
      actor,
    });
  }

  async resume(chatId: number, actor: string): Promise<void> {
    if (
      await this.prisma.voiceCall.findFirst({
        where: { chatId: BigInt(chatId), endedAt: null },
        select: { id: true },
      })
    ) {
      throw new ConflictException(
        'Сначала завершите звонок с войсером, затем включите бота',
      );
    }
    const current = await this.history.getPause(chatId);
    if (!actor.startsWith('system:'))
      await this.history.acknowledgeManualReview(chatId);
    if (current.status !== 'paused') return;
    const ts = this.clock.ts();
    await this.history.setPause(chatId, {
      status: 'active',
      reason: BOT_ACTIVE_REASON,
      actor,
      ts,
      until: null,
    });
    await this.funnel.emit(chatId, 'conversation_resumed', ts, { actor });
    await this.history.mergeLeadFacts(
      chatId,
      { [MEDIA_REQUEST_KEY]: null, [HANDOFF_TRIGGER_KEY]: null },
      false,
    );
  }

  status(chatId: number): Promise<PauseState> {
    return this.history.getPause(chatId);
  }

  async resumeAfterCall(chatId: number, callId: string): Promise<boolean> {
    const ts = this.clock.ts();
    const changed = await this.prisma.$transaction(async (tx) => {
      if (
        await tx.voiceCall.findFirst({
          where: { chatId: BigInt(chatId), endedAt: null },
        })
      )
        return false;
      const result = await tx.contact.updateMany({
        where: {
          chatId: BigInt(chatId),
          pauseState: 'paused',
          pauseActor: `voicer:call:${callId}`,
          blockedByClientAt: null,
        },
        data: {
          pauseState: 'active',
          pauseReason: BOT_ACTIVE_REASON,
          pauseActor: `system:after_call:${callId}`,
          pausedTs: ts,
          pausedUntil: null,
        },
      });
      return result.count > 0;
    });
    if (changed)
      await this.funnel.emit(chatId, 'conversation_resumed', ts, {
        actor: `system:after_call:${callId}`,
      });
    return changed;
  }

  async autoResumeDue(): Promise<number> {
    const now = this.clock.ts();
    const due = await this.prisma.contact.findMany({
      where: { pauseState: 'paused', pausedUntil: { not: null, lte: now } },
      select: { chatId: true },
    });
    let resumed = 0;
    for (const c of due) {
      try {
        await this.resume(Number(c.chatId), 'system:auto_resume');
        resumed++;
      } catch (e) {
        if (!(e instanceof ConflictException)) throw e;
      }
    }
    return resumed;
  }
}
