import type { PrismaService } from 'src/prisma.service';

/** Аккаунт добавлен: событие для статистики «сколько загрузили». */
export async function recordAccountAdded(
  prisma: PrismaService,
  account: { id: number; channel: string; addedAt: number },
  managerId: number | null,
): Promise<void> {
  await prisma.accountEvent.create({
    data: {
      accountId: account.id,
      channel: account.channel,
      kind: 'added',
      managerId,
      ts: account.addedAt,
    },
  });
}

/**
 * Аккаунт слетел (бан, сессия завершена): метка на аккаунте и событие в
 * журнале — с менеджером и числом диалогов на этот момент. Уже слетевший
 * второй раз не считается. false — статус и так такой, ничего не меняли.
 */
export async function markAccountLost(
  prisma: PrismaService,
  accountId: number,
  loss: { status: 'banned' | 'unauthorized'; reason: string | null },
  now: number,
): Promise<boolean> {
  const current = await prisma.channelAccount.findUnique({
    where: { id: accountId },
    select: {
      status: true,
      bannedAt: true,
      channel: true,
      manager: { select: { userId: true } },
    },
  });
  if (!current || current.status === loss.status) return false;
  const wasLost =
    (current.status === 'banned' || current.status === 'unauthorized') &&
    current.bannedAt !== null;
  await prisma.channelAccount.update({
    where: { id: accountId },
    data: { status: loss.status, bannedAt: now, banReason: loss.reason },
  });
  if (!wasLost)
    await prisma.accountEvent.create({
      data: {
        accountId,
        channel: current.channel,
        kind: 'lost',
        status: loss.status,
        reason: loss.reason,
        managerId: current.manager?.userId ?? null,
        chats: await prisma.contact.count({ where: { accountId } }),
        ts: now,
      },
    });
  return true;
}
