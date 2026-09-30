import { Prisma, VoiceTask } from '@prisma/client';

export async function voiceNotice(
  tx: Prisma.TransactionClient,
  task: Pick<VoiceTask, 'id' | 'managerId'>,
  eventKey: string,
  text: string,
  now: number,
) {
  const users = await tx.dashboardUser.findMany({
    where: {
      OR: [
        { role: 'admin' },
        ...(task.managerId ? [{ id: task.managerId, role: 'manager' }] : []),
      ],
    },
    select: { id: true },
  });
  for (const user of users)
    await tx.voiceNotice.upsert({
      where: { userId_eventKey: { userId: user.id, eventKey } },
      create: {
        taskId: task.id,
        userId: user.id,
        eventKey,
        text,
        createdAt: now,
      },
      update: {},
    });
}
