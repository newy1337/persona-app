import type { PrismaService } from 'src/prisma.service';
import { openerVariants } from 'src/domain/outreach-opener';

/**
 * Пул первых сообщений для аккаунта: региона его менеджера, если хед задал
 * непустой; иначе null — брать общий пул личности. Свободный аккаунт без
 * менеджера региона не имеет.
 */
export async function regionOpenerFor(
  prisma: PrismaService,
  accountId: number,
  personaSlug: string,
): Promise<string | null> {
  const link = await prisma.managerAccount.findUnique({
    where: { accountId },
    select: { user: { select: { regionCode: true } } },
  });
  const region = link?.user.regionCode;
  if (!region) return null;
  const row = await prisma.regionOpener.findUnique({
    where: { regionCode_personaSlug: { regionCode: region, personaSlug } },
    select: { text: true },
  });
  return row && openerVariants(row.text).length ? row.text : null;
}
