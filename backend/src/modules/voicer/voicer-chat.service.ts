import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DashboardUser, Prisma } from '@prisma/client';
import { realpath, stat } from 'fs/promises';
import { isAbsolute, relative, resolve } from 'path';
import { appConfig } from 'src/config/app.config';
import { PrismaService } from 'src/prisma.service';
import { ScopeService } from 'src/shared/scope.service';
import { VoicerService } from './voicer.service';

const factsOf = (text?: string) => {
  try {
    return JSON.parse(text ?? '{}');
  } catch {
    return {};
  }
};

@Injectable()
export class VoicerChatService {
  constructor(
    private prisma: PrismaService,
    private voicer: VoicerService,
    private scope: ScopeService,
  ) {}

  async context(user: DashboardUser, id: number) {
    const task = await this.voicer.task(user, id);
    if (user.role === 'voice' && task.kind !== 'call')
      throw new NotFoundException(
        'Переписка доступна войсеру только для звонков',
      );
    if (user.role === 'voice' && task.status === 'cancelled')
      throw new NotFoundException(
        'Задание отменено — доступ к переписке закрыт',
      );
    if (!task.chatId) return { task, contact: null };
    const contact = await this.prisma.contact.findUnique({
      where: { chatId: task.chatId },
      include: { account: { include: { manager: true } } },
    });
    const grantedUnassigned = Boolean(
      task.chatGrantedById &&
      task.chatGrantAccountId &&
      contact?.accountId === task.chatGrantAccountId &&
      contact.account &&
      !contact.account.manager,
    );
    if (
      !contact ||
      contact.account?.personaId !== task.personaSlug ||
      (user.role !== 'admin' &&
        (!task.managerId ||
          (contact.account.manager?.userId !== task.managerId &&
            !grantedUnassigned)))
    ) {
      throw new NotFoundException(
        'Диалог недоступен. Менеджеру нужно проверить привязку задания',
      );
    }
    return { task, contact };
  }

  async choices(
    user: DashboardUser,
    managerId: number,
    persona: string,
    q: string,
  ) {
    this.scope.requireManager(user);
    const owner = user.role === 'admin' ? managerId : user.id;
    if (!Number.isSafeInteger(owner) || owner < 1)
      throw new BadRequestException('Выберите менеджера');
    return this.search(
      {
        ...(user.role === 'admin'
          ? { OR: [{ manager: { userId: owner } }, { manager: null }] }
          : { manager: { userId: owner } }),
        ...(persona ? { personaId: persona } : {}),
      },
      q,
    );
  }

  async sendTargets(user: DashboardUser, q: string) {
    this.scope.requireManager(user);
    return this.search(
      user.role === 'admin' ? {} : { manager: { userId: user.id } },
      q,
    );
  }

  private async search(account: Prisma.TgAccountWhereInput, q: string) {
    const matches = q
      ? await this.prisma.leadFacts.findMany({
          where: { facts: { contains: q } },
          select: { chatId: true },
        })
      : [];
    const profiles = q
      ? await this.prisma.phoneNumber.findMany({
          where: {
            OR: [
              { firstName: { contains: q } },
              { telegramUsername: { contains: q } },
            ],
          },
          select: { telegramUserId: true },
        })
      : [];
    const ids = [
      ...matches.map((f) => f.chatId),
      ...profiles.flatMap((p) => (p.telegramUserId ? [p.telegramUserId] : [])),
    ];
    if (/^\d{1,16}$/.test(q)) ids.push(BigInt(q));
    const rows = await this.prisma.contact.findMany({
      where: { account, ...(q ? { chatId: { in: ids } } : {}) },
      select: {
        chatId: true,
        account: {
          select: { personaId: true, manager: { select: { userId: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 41,
    });
    const selected = rows.slice(0, 40).map((r) => r.chatId);
    const [facts, people] = await Promise.all([
      this.prisma.leadFacts.findMany({
        where: { chatId: { in: selected } },
        select: { chatId: true, facts: true },
      }),
      this.prisma.phoneNumber.findMany({
        where: { telegramUserId: { in: selected } },
        select: {
          telegramUserId: true,
          firstName: true,
          telegramUsername: true,
        },
      }),
    ]);
    return {
      items: selected.map((chatId) => {
        const f = factsOf(facts.find((f) => f.chatId === chatId)?.facts),
          person = people.find((p) => p.telegramUserId === chatId);
        return {
          chat_id: String(chatId),
          persona_name: rows.find((r) => r.chatId === chatId)?.account
            ?.personaId,
          label: String(f.name || person?.firstName || `Диалог ${chatId}`),
          unassigned: !rows.find((r) => r.chatId === chatId)?.account?.manager,
          contact_ref: person?.telegramUsername
            ? `@${person.telegramUsername.replace(/^@/, '')}`
            : '',
        };
      }),
      more: rows.length > 40,
    };
  }

  async link(user: DashboardUser, id: number, chatId: string) {
    this.scope.requireManager(user);
    const task = await this.voicer.task(user, id);
    if (task.voiceMode === 'once')
      throw new ConflictException(
        'Получатель одноразового голосового зафиксирован. Создайте новое задание для другого диалога',
      );
    if (task.status !== 'queued')
      throw new ConflictException(
        'Привязать диалог можно, пока задание в очереди',
      );
    if (!task.managerId || !Number.isSafeInteger(Number(chatId)))
      throw new BadRequestException('Некорректный диалог или менеджер');
    const manager = await this.prisma.dashboardUser.findUnique({
      where: { id: task.managerId },
    });
    if (manager?.role !== 'manager')
      throw new NotFoundException('Менеджер недоступен');
    const chatAccess = await this.voicer.chatAccessForTask(
      user,
      manager.id,
      chatId,
      task.personaSlug,
    );
    const biography = await this.voicer.biographyForChat(
      task.personaSlug,
      BigInt(chatId),
    );
    const updated = await this.prisma.voiceTask.updateMany({
      where: { id, status: 'queued', revision: task.revision },
      data: {
        chatId: BigInt(chatId),
        ...chatAccess,
        biography,
        updatedAt: Math.floor(Date.now() / 1000),
        notifyVersion: { increment: 1 },
        notifyAfter: 0,
      },
    });
    if (!updated.count)
      throw new ConflictException(
        'Задание уже взято в работу. Обновите страницу',
      );
    return this.voicer.publicTask(await this.voicer.task(user, id), true);
  }

  async conversation(user: DashboardUser, id: number, before?: number) {
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1))
      throw new BadRequestException('Некорректная страница переписки');
    const { task, contact } = await this.context(user, id);
    if (!contact) return { chat_id: null, items: [], next_before: null };
    let older: Prisma.MessageWhereInput = {};
    if (before) {
      const cursor = await this.prisma.message.findFirst({
        where: { id: before, chatId: task.chatId! },
        select: { ts: true, id: true },
      });
      if (!cursor)
        throw new BadRequestException(
          'Обновите переписку: сообщение больше не доступно',
        );
      older = {
        OR: [
          { ts: { lt: cursor.ts } },
          { ts: cursor.ts, id: { lt: cursor.id } },
        ],
      };
    }
    const rows = await this.prisma.message.findMany({
      where: {
        chatId: task.chatId!,
        role: { in: ['user', 'assistant'] },
        ...older,
      },
      orderBy: [{ ts: 'desc' }, { id: 'desc' }],
      take: 101,
      select: {
        id: true,
        ts: true,
        role: true,
        text: true,
        author: true,
        mediaKind: true,
        filePath: true,
        editedAt: true,
        deletedAt: true,
        reaction: true,
      },
    });
    const page = rows.slice(0, 100);
    return {
      chat_id: String(task.chatId),
      contact_label: task.contactLabel,
      persona_name: task.personaName,
      next_before: rows.length > 100 ? page[page.length - 1].id : null,
      items: page.reverse().map(({ filePath, deletedAt, text, ...m }) => ({
        ...m,
        deletedAt,
        text: deletedAt ? '' : text,
        has_file: Boolean(filePath && !deletedAt),
      })),
    };
  }

  async attachment(user: DashboardUser, id: number, messageId: number) {
    const { task, contact } = await this.context(user, id);
    if (!contact) throw new NotFoundException('Диалог не привязан');
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        chatId: task.chatId!,
        deletedAt: null,
        role: { in: ['user', 'assistant'] },
      },
      select: { filePath: true },
    });
    if (!message?.filePath) throw new NotFoundException('Вложение недоступно');
    try {
      const path = await realpath(resolve(message.filePath));
      for (const root of [
        appConfig.mediaDir,
        resolve(appConfig.dataDir, 'uploads'),
      ]) {
        const base = await realpath(root).catch(() => null);
        if (!base) continue;
        const rel = relative(base, path);
        if (
          rel &&
          !rel.startsWith('..') &&
          !isAbsolute(rel) &&
          (await stat(path)).isFile()
        )
          return path;
      }
    } catch {
      /* Missing or invalid files are unavailable, not server errors. */
    }
    throw new NotFoundException('Вложение недоступно');
  }
}
