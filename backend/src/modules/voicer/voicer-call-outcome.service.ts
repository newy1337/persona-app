import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { PauseService } from 'src/shared/pause.service';
import { ClockService } from 'src/shared/clock.service';
import { voiceNotice } from './voicer-notice';

@Injectable()
export class VoicerCallOutcomeService {
  constructor(
    private prisma: PrismaService,
    private pause: PauseService,
    private clock: ClockService,
  ) {}

  async finalize(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const call = await tx.voiceCall.findUnique({
        where: { id },
        include: { task: true },
      });
      if (!call?.endedAt || call.finalizedAt) return;
      const task = call.task,
        connected = call.connectedAt !== null;
      const duration = connected
        ? Math.max(0, call.endedAt - call.connectedAt!)
        : 0;
      const result = connected
        ? `Звонок состоялся · ${Math.floor(duration / 60)} мин ${duration % 60} сек. ${call.reason}`
        : `Разговора не было. ${call.reason}`;
      const changed = await tx.voiceTask.updateMany({
        where: {
          id: task.id,
          revision: call.revision,
          status: 'in_progress',
          voicerId: call.voicerId,
        },
        data: {
          ...(connected ? { status: 'completed' } : {}),
          outcome: result,
          updatedAt: this.clock.ts(),
          notifyVersion: { increment: 1 },
          notifyAfter: 0,
        },
      });
      if (changed.count)
        await voiceNotice(
          tx,
          task,
          `call:${id}`,
          `Звонок «${task.title}»: ${result}`,
          this.clock.ts(),
        );
      await tx.voiceCall.update({
        where: { id },
        data: { finalizedAt: this.clock.ts() },
      });
    });
    const call = await this.prisma.voiceCall.findUnique({
      where: { id },
      include: { task: true },
    });
    if (!call?.endedAt || call.resumeStatus !== 'pending') return;
    const contact = await this.prisma.contact.findUnique({
      where: { chatId: call.chatId },
      include: { account: { include: { manager: true } } },
    });
    const task = call.task;
    const same =
      task.status !== 'cancelled' &&
      task.voicerId === call.voicerId &&
      contact?.accountId === call.accountId &&
      contact.account?.personaId === task.personaSlug &&
      (contact.account?.manager?.userId === task.managerId ||
        (!contact.account?.manager &&
          task.chatGrantAccountId === call.accountId &&
          task.chatGrantedById));
    const resumed =
      same &&
      ((await this.pause.resumeAfterCall(Number(call.chatId), id)) ||
        contact?.pauseActor === `system:after_call:${id}`);
    await this.prisma.voiceCall.updateMany({
      where: { id, resumeStatus: 'pending' },
      data: {
        resumeStatus: resumed ? 'resumed' : 'kept',
        followupStatus:
          call.followupStatus === 'skipped'
            ? 'skipped'
            : resumed
              ? call.connectedAt !== null
                ? 'pending'
                : 'resume'
              : 'skipped',
      },
    });
  }
}
