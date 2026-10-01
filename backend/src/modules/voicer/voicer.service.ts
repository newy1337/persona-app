import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  DashboardUser,
  Prisma,
  VoiceCall,
  VoiceRecording,
  VoiceTask,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { join, resolve, relative, isAbsolute } from 'path';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { ScopeService } from 'src/shared/scope.service';
import { appConfig } from 'src/config/app.config';
import { VoiceEncoderService } from '../media/voice-encoder.service';
import {
  fillVariables,
  variableValues,
} from 'src/brain/nastya/config/variables';
import { CreateVoiceTaskDto, VoiceTaskActionDto } from './voicer.dto';
import { VoicerAutomationService } from './voicer-automation.service';
import { voiceNotice } from './voicer-notice';
import {
  VoicerDeliveryService,
  deliveryRelation,
  deliveryView,
  DeliveryWithStatus,
} from './voicer-delivery.service';

const active = [
  'queued',
  'in_progress',
  'delivering',
  'delivery_error',
  'delivery_review',
];
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const parse = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

export function biographyText(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value))
    return value
      .map((v) => `${'  '.repeat(depth)}• ${biographyText(v, depth + 1)}`)
      .join('\n');
  if (typeof value === 'object')
    return Object.entries(value)
      .filter(([key]) => !key.startsWith('_'))
      .map(
        ([key, v]) =>
          `${'  '.repeat(depth)}${key}: ${typeof v === 'object' ? '\n' : ''}${biographyText(v, depth + 1)}`,
      )
      .join('\n');
  return String(value);
}

@Injectable()
export class VoicerService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private scope: ScopeService,
    private encoder: VoiceEncoderService,
    private delivery: VoicerDeliveryService,
    @Optional() private autoVoice?: VoicerAutomationService,
  ) {}

  scopeWhere(user: DashboardUser): Prisma.VoiceTaskWhereInput {
    if (user.role === 'admin') return {};
    if (user.role === 'manager') return { managerId: user.id };
    if (user.role === 'voice') return { voicerId: user.id };
    throw new ForbiddenException();
  }

  async task(user: DashboardUser, id: number) {
    const task = await this.prisma.voiceTask.findFirst({
      where: { id, ...this.scopeWhere(user) },
      include: {
        deliveries: deliveryRelation,
        calls: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            connectedAt: true,
            endedAt: true,
            note: true,
            resumeStatus: true,
          },
        },
      },
    });
    if (!task) throw new NotFoundException('Задание не найдено');
    return task;
  }

  publicTask(
    task: VoiceTask & {
      deliveries?: DeliveryWithStatus[];
      calls?: Pick<
        VoiceCall,
        'id' | 'status' | 'connectedAt' | 'endedAt' | 'note' | 'resumeStatus'
      >[];
    },
    full = false,
  ) {
    const {
      biography,
      botChatId,
      botMessageId,
      notifyVersion,
      notifiedVersion,
      notifyAfter,
      chatGrantAccountId,
      chatGrantedById,
      sendRequestedById,
      sendAccountId,
      autoKey,
      autoReplyId,
      autoContextId,
      autoContextHash,
      autoPersonaUpdatedAt,
      deliveries,
      calls,
      ...rest
    } = task;
    return {
      ...rest,
      chatId: task.chatId?.toString() ?? null,
      ...(full ? { biography } : {}),
      delivery:
        task.voiceMode === 'once' ? deliveryView(deliveries?.[0]) : null,
      ...(full && task.kind === 'call' ? { call: calls?.[0] ?? null } : {}),
      notification:
        notifyVersion === notifiedVersion
          ? 'sent'
          : task.notifyError
            ? 'error'
            : 'pending',
    };
  }

  async options(user: DashboardUser) {
    const users =
      user.role === 'voice'
        ? []
        : await this.prisma.dashboardUser.findMany({
            where:
              user.role === 'admin' ? { role: 'manager' } : { id: user.id },
            select: {
              id: true,
              username: true,
              regionCode: true,
              voicer: {
                select: {
                  id: true,
                  username: true,
                  voiceProfile: { select: { telegramId: true } },
                },
              },
            },
            orderBy: { username: 'asc' },
          });
    const profile =
      user.role === 'voice'
        ? await this.prisma.voicerProfile.findUnique({
            where: { userId: user.id },
          })
        : null;
    return {
      role: user.role,
      user_id: user.id,
      managers: users.map((u) => ({
        id: u.id,
        username: u.username,
        region: u.regionCode,
        voicer_id: u.voicer?.id ?? null,
        voicer_name: u.voicer?.username ?? null,
        bot_linked: Boolean(u.voicer?.voiceProfile?.telegramId),
      })),
      personas:
        user.role === 'voice'
          ? []
          : await this.prisma.persona.findMany({
              where: { enabled: true },
              select: { slug: true, name: true },
            }),
      linked: Boolean(profile?.telegramId),
      telegram_username: profile?.telegramUsername ?? null,
    };
  }

  async list(user: DashboardUser, status: string, q = '', page = 1) {
    const where: Prisma.VoiceTaskWhereInput = {
      ...this.scopeWhere(user),
      ...(status === 'active'
        ? { status: { in: active } }
        : ['completed', 'ready'].includes(status)
          ? { status: { in: ['completed', 'ready'] } }
          : status && status !== 'all'
            ? { status }
            : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { contactLabel: { contains: q } },
              { managerName: { contains: q } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.voiceTask.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * 40,
        take: 40,
        include: { deliveries: deliveryRelation },
      }),
      this.prisma.voiceTask.count({ where }),
    ]);
    return { items: rows.map((t) => this.publicTask(t)), total, page };
  }

  async create(user: DashboardUser, dto: CreateVoiceTaskDto) {
    this.scope.requireManager(user);
    const voiceMode =
      dto.kind === 'voice'
        ? (dto.voice_mode ?? (dto.chat_id ? 'once' : 'library'))
        : 'library';
    if (voiceMode === 'once' && !dto.chat_id)
      throw new BadRequestException(
        'Для одноразового голосового выберите диалог получателя',
      );
    const managerId = user.role === 'admin' ? dto.manager_id : user.id;
    if (!managerId) throw new BadRequestException('Выберите менеджера');
    const manager = await this.prisma.dashboardUser.findUnique({
      where: { id: managerId },
      include: { voicer: true },
    });
    if (manager?.role !== 'manager')
      throw new BadRequestException('Выберите действующего менеджера');
    if (manager.voicer?.role !== 'voice')
      throw new BadRequestException(
        'Сначала назначьте менеджеру войсера в разделе «Менеджеры»',
      );
    if (
      !dto.title.trim() ||
      (dto.kind === 'call' && !dto.contact_label?.trim())
    )
      throw new BadRequestException('Укажите название и собеседника');
    if (dto.kind === 'voice' && !dto.script?.trim())
      throw new BadRequestException('Введите текст для записи');
    if (dto.kind === 'voice' && !dto.emotion?.trim())
      throw new BadRequestException('Укажите эмоциональность');
    if (
      dto.kind === 'call' &&
      (!dto.instructions?.trim() ||
        (!dto.contact_ref?.trim() && !dto.chat_id) ||
        !dto.tempo?.trim())
    ) {
      throw new BadRequestException(
        'Для звонка укажите контакт, тему/задачу и темп разговора',
      );
    }
    const chatAccess = dto.chat_id
      ? await this.chatAccessForTask(
          user,
          manager.id,
          dto.chat_id,
          dto.persona_slug,
        )
      : {};
    const target = dto.chat_id
      ? await this.prisma.contact.findUnique({
          where: { chatId: BigInt(dto.chat_id) },
        })
      : null;
    if (voiceMode === 'once' && !target?.accountId)
      throw new BadRequestException('Диалог больше недоступен');
    const persona = await this.prisma.persona.findUnique({
      where: { slug: dto.persona_slug },
    });
    if (!persona?.enabled) throw new BadRequestException('Личность недоступна');
    const biography = await this.biographyForChat(
      persona.slug,
      dto.chat_id ? BigInt(dto.chat_id) : null,
    );
    const now = this.clock.ts();
    const result = await this.prisma.voiceTask.create({
      data: {
        managerId,
        voicerId: manager.voicer.id,
        managerName: manager.username,
        voicerName: manager.voicer.username,
        kind: dto.kind,
        voiceMode,
        title: dto.title.trim(),
        sendAccountId: voiceMode === 'once' ? target!.accountId : null,
        sendRequestedById: voiceMode === 'once' ? user.id : null,
        contactLabel:
          dto.contact_label?.trim() ||
          (dto.chat_id ? `Диалог ${dto.chat_id}` : 'Для библиотеки'),
        contactRef: dto.contact_ref?.trim() ?? '',
        chatId: dto.chat_id ? BigInt(dto.chat_id) : null,
        ...chatAccess,
        personaSlug: persona.slug,
        personaName: persona.name,
        biography,
        script: dto.script?.trim() ?? '',
        emotion: dto.emotion?.trim() ?? '',
        tempo: dto.tempo?.trim() ?? '',
        instructions: dto.instructions?.trim() ?? '',
        priority: dto.priority ?? 0,
        dueAt: dto.due_at ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return this.publicTask(result, true);
  }

  async chatAccessForTask(
    actor: DashboardUser,
    managerId: number,
    chatId: string,
    personaSlug: string,
  ) {
    this.scope.requireManager(actor);
    if (!/^\d{1,16}$/.test(chatId) || !Number.isSafeInteger(Number(chatId)))
      throw new BadRequestException('Некорректный ID диалога');
    const contact = await this.prisma.contact.findUnique({
      where: { chatId: BigInt(chatId) },
      include: {
        account: {
          include: {
            manager: { include: { user: { select: { username: true } } } },
          },
        },
      },
    });
    if (!contact?.account) throw new NotFoundException('чат не найден');
    const owner = contact.account.manager;
    if (
      actor.role !== 'admin' &&
      (actor.id !== managerId || owner?.userId !== managerId)
    )
      throw new NotFoundException('чат не найден');
    if (owner && owner.userId !== managerId) {
      throw new BadRequestException(
        `Диалог закреплён за менеджером «${owner.user.username}». Выберите этого менеджера для задания`,
      );
    }
    if (contact.account.personaId !== personaSlug)
      throw new BadRequestException(
        'Личность не совпадает с аккаунтом диалога',
      );
    return {
      chatGrantAccountId: owner ? null : contact.account.id,
      chatGrantedById: owner ? null : actor.id,
    };
  }

  async biographyForChat(slug: string, chatId: bigint | null) {
    const persona = await this.prisma.persona.findUnique({ where: { slug } });
    if (!persona?.enabled) throw new BadRequestException('Личность недоступна');
    const facts = chatId
      ? parse(
          (await this.prisma.leadFacts.findUnique({ where: { chatId } }))
            ?.facts ?? '{}',
        )
      : {};
    const vars = Object.fromEntries(
      ['city', 'site', 'interlocutor_city']
        .filter((k) => typeof facts[k] === 'string')
        .map((k) => [k, facts[k]]),
    );
    return biographyText(
      fillVariables(parse(persona.persona), {
        ...variableValues(parse(persona.variables)),
        ...vars,
        name: persona.name,
      }),
    );
  }

  async action(user: DashboardUser, id: number, dto: VoiceTaskActionDto) {
    const task = await this.task(user, id);
    if (task.revision !== dto.revision)
      throw new ConflictException('Задание обновилось. Откройте его заново');
    const isVoicer = user.role === 'voice' && task.voicerId === user.id;
    const isManager =
      user.role === 'admin' ||
      (user.role === 'manager' && task.managerId === user.id);
    if (dto.action === 'call_note') {
      if (!isVoicer && !isManager) throw new ForbiddenException();
      const call = task.calls[0];
      if (task.kind !== 'call' || !call?.connectedAt || !call.endedAt)
        throw new ConflictException(
          'Дополнить итог можно после состоявшегося звонка',
        );
      if (!dto.note?.trim())
        throw new BadRequestException('Напишите важное из разговора');
      await this.prisma.voiceCall.update({
        where: { id: call.id },
        data: { note: dto.note.trim() },
      });
      return this.publicTask(await this.task(user, id), true);
    }
    if (
      task.kind === 'call' &&
      ['complete', 'release'].includes(dto.action) &&
      (await this.prisma.voiceCall.findFirst({
        where: { taskId: id, endedAt: null },
        select: { id: true },
      }))
    ) {
      throw new ConflictException(
        'Сначала завершите вызов, затем сохраните итог или верните задание в очередь',
      );
    }
    if (dto.action === 'cancel' && task.source === 'bot' && isManager) {
      await this.autoVoice!.cancel(
        task.id,
        dto.note?.trim() || 'Отменено менеджером',
      );
      return this.publicTask(await this.task(user, id), true);
    }
    if (
      dto.action === 'cancel' &&
      task.status === 'delivery_error' &&
      isManager
    ) {
      await this.delivery.cancelUnsent(id, dto.revision);
      return this.publicTask(await this.task(user, id), true);
    }
    if (dto.action === 'retry_delivery') {
      if (!isManager) throw new ForbiddenException();
      const d = task.deliveries[0];
      if (task.voiceMode !== 'once' || !d)
        throw new ConflictException('Нет одноразовой отправки');
      await this.delivery.retry(d.id);
      return this.publicTask(await this.task(user, id), true);
    }
    let data: Prisma.VoiceTaskUpdateManyMutationInput = {
      updatedAt: this.clock.ts(),
    };
    if (dto.action === 'claim') {
      if (!isVoicer)
        throw new ForbiddenException('Взять задание может назначенный войсер');
      if (task.status === 'in_progress') return this.publicTask(task, true);
      if (task.status !== 'queued')
        throw new ConflictException('Задание уже не в очереди');
      data.status = 'in_progress';
      data.notifyVersion = { increment: 1 };
      data.notifyAfter = 0;
    } else if (dto.action === 'release') {
      if (!isVoicer) throw new ForbiddenException();
      if (task.status !== 'in_progress')
        throw new ConflictException('Задание уже не в работе');
      data = {
        ...data,
        status: 'queued',
        notifyVersion: { increment: 1 },
        notifyAfter: 0,
        botMessageId: null,
        botChatId: null,
      };
    } else if (dto.action === 'complete') {
      if (!isVoicer) throw new ForbiddenException();
      if (task.kind !== 'call' || task.status !== 'in_progress')
        throw new ConflictException('Завершить можно только начатый звонок');
      if (!dto.note?.trim())
        throw new BadRequestException('Укажите результат звонка');
      data.status = 'completed';
      data.outcome = dto.note.trim();
    } else {
      if (!isManager) throw new ForbiddenException();
      if (
        dto.action === 'approve' &&
        task.kind === 'voice' &&
        task.voiceMode === 'library' &&
        ['ready', 'completed'].includes(task.status)
      )
        data.status = 'completed';
      else if (
        dto.action === 'revise' &&
        task.kind === 'voice' &&
        task.voiceMode === 'library' &&
        ['ready', 'completed'].includes(task.status)
      ) {
        if (!dto.note?.trim())
          throw new BadRequestException('Напишите, что изменить в записи');
        data = {
          ...data,
          status: 'queued',
          feedback: dto.note.trim(),
          revision: { increment: 1 },
          notifyVersion: { increment: 1 },
          botMessageId: null,
          botChatId: null,
          notifyAfter: 0,
          notifyError: null,
        };
      } else if (
        dto.action === 'cancel' &&
        ['queued', 'in_progress', 'ready'].includes(task.status)
      ) {
        data = {
          ...data,
          status: 'cancelled',
          outcome: dto.note?.trim() ?? '',
          notifyVersion: { increment: 1 },
          notifyAfter: 0,
        };
      } else
        throw new ConflictException('Действие недоступно для текущего статуса');
    }
    try {
      const changed = await this.prisma.voiceTask.updateMany({
        where: { id, status: task.status, revision: dto.revision },
        data,
      });
      if (!changed.count) throw new ConflictException('Задание уже изменилось');
    } catch (e) {
      if (e?.code === 'P2002')
        throw new ConflictException('Сначала завершите текущее задание');
      throw e;
    }
    return this.publicTask(await this.task(user, id), true);
  }

  async link(user: DashboardUser, targetId: number, username: string) {
    if (
      user.role !== 'admin' &&
      (user.role !== 'voice' || user.id !== targetId)
    )
      throw new ForbiddenException();
    if (
      (await this.prisma.dashboardUser.findUnique({ where: { id: targetId } }))
        ?.role !== 'voice'
    )
      throw new BadRequestException('Нужна роль войсера');
    if (!username)
      throw new BadRequestException('Telegram-бот пока не подключён');
    const token = randomBytes(24).toString('hex'),
      expires = this.clock.ts() + 900;
    await this.prisma.voicerProfile.upsert({
      where: { userId: targetId },
      create: {
        userId: targetId,
        linkHash: hash(token),
        linkExpiresAt: expires,
      },
      update: { linkHash: hash(token), linkExpiresAt: expires },
    });
    return {
      url: `https://t.me/${username}?start=bind_${token}`,
      expires_at: expires,
    };
  }

  async disconnect(user: DashboardUser, targetId: number) {
    if (
      user.role !== 'admin' &&
      (user.role !== 'voice' || user.id !== targetId)
    )
      throw new ForbiddenException();
    await this.prisma.voicerProfile.updateMany({
      where: { userId: targetId },
      data: {
        telegramId: null,
        telegramUsername: null,
        linkHash: null,
        linkExpiresAt: null,
      },
    });
    return { ok: true };
  }

  async bind(token: string, telegramId: bigint, username: string | null) {
    const profile = await this.prisma.voicerProfile.findUnique({
      where: { linkHash: hash(token) },
      include: { user: true },
    });
    if (
      !profile ||
      profile.user.role !== 'voice' ||
      (profile.linkExpiresAt ?? 0) < this.clock.ts()
    )
      throw new BadRequestException(
        'Ссылка использована или истекла. Получите новую в кабинете',
      );
    try {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.voicerProfile.updateMany({
          where: {
            userId: profile.userId,
            linkHash: hash(token),
            linkExpiresAt: { gte: this.clock.ts() },
          },
          data: {
            telegramId,
            telegramUsername: username,
            linkHash: null,
            linkExpiresAt: null,
          },
        });
        if (!changed.count)
          throw new ConflictException('Ссылка уже использована');
        await tx.voiceTask.updateMany({
          where: { voicerId: profile.userId, status: { in: active } },
          data: {
            notifiedVersion: 0,
            notifyAfter: 0,
            botChatId: null,
            botMessageId: null,
          },
        });
      });
    } catch (e) {
      if (e?.code === 'P2002')
        throw new ConflictException(
          'Этот Telegram уже связан с другой учёткой',
        );
      throw e;
    }
    return profile.user;
  }

  async telegramUser(id: bigint) {
    const profile = await this.prisma.voicerProfile.findUnique({
      where: { telegramId: id },
      include: { user: true },
    });
    return profile?.user.role === 'voice' ? profile.user : null;
  }

  async record(
    user: DashboardUser,
    taskId: number,
    revision: number,
    telegramId: bigint,
    messageId: number,
    bytes: Buffer,
  ) {
    if (user.role !== 'voice') throw new ForbiddenException();
    const already = await this.prisma.voiceRecording.findUnique({
      where: {
        telegramChatId_telegramMessageId: {
          telegramChatId: telegramId,
          telegramMessageId: messageId,
        },
      },
    });
    if (already) return already.id;
    const task = await this.task(user, taskId);
    if (task.source === 'bot') {
      const problem = this.autoVoice
        ? await this.autoVoice.problem(task)
        : 'Автоматическая запись недоступна';
      if (problem) {
        await this.autoVoice?.cancel(task.id, problem);
        throw new ConflictException(problem);
      }
    }
    if (
      task.kind !== 'voice' ||
      task.status !== 'in_progress' ||
      task.revision !== revision
    )
      throw new ConflictException(
        'Задание изменилось. Откройте актуальное через /tasks',
      );
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
      throw new BadRequestException('Запись должна быть от 1 байта до 20 МБ');
    const dir = resolve(appConfig.mediaDir, 'voicer');
    await mkdir(dir, { recursive: true });
    const temp = join(dir, `${randomUUID()}.upload`),
      target = join(dir, `${randomUUID()}.ogg`);
    let prepared: Awaited<ReturnType<VoiceEncoderService['prepare']>> | null =
      null;
    try {
      await writeFile(temp, bytes, { mode: 0o600 });
      const probe = await this.encoder.probe(temp);
      if (!probe?.codec || !probe.channels || probe.duration <= 0)
        throw new BadRequestException(
          'Не удалось прочитать аудио. Пришлите голосовое сообщение',
        );
      prepared = await this.encoder.prepare(temp);
      const encoded = await this.encoder.probe(prepared.path);
      if (
        encoded?.codec !== 'opus' ||
        !encoded.format.split(',').includes('ogg')
      )
        throw new BadRequestException(
          'Не удалось подготовить голосовое. Попробуйте запись прямо в Telegram',
        );
      await rename(prepared.path, target);
      const saved = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.voiceTask.updateMany({
          where: {
            id: taskId,
            voicerId: user.id,
            status: 'in_progress',
            revision,
          },
          data: {
            status: task.voiceMode === 'once' ? 'delivering' : 'completed',
            updatedAt: this.clock.ts(),
          },
        });
        if (!changed.count)
          throw new ConflictException('Задание изменилось во время загрузки');
        const recording = await tx.voiceRecording.create({
          data: {
            taskId,
            revision,
            title: task.title,
            filePath: target,
            duration: Math.ceil(encoded.duration),
            telegramChatId: telegramId,
            telegramMessageId: messageId,
            createdAt: this.clock.ts(),
          },
        });
        if (task.voiceMode === 'once') {
          if (!task.chatId || !task.sendAccountId || !task.sendRequestedById)
            throw new ConflictException(
              'У одноразового задания не задан получатель',
            );
          await this.delivery.enqueue(tx, task, recording, {
            chatId: task.chatId,
            accountId: task.sendAccountId,
            personaSlug: task.personaSlug,
            requestedById: task.sendRequestedById,
            requestKey: `once:${task.id}:${revision}`,
            mode: 'once',
          });
        }
        if (task.voiceMode === 'library')
          await voiceNotice(
            tx,
            task,
            `ready:${task.id}:${revision}`,
            `Голосовое готово: «${task.title}». Запись доступна в библиотеке.`,
            this.clock.ts(),
          );
        return recording;
      });
      return saved.id;
    } catch (e) {
      await rm(target, { force: true });
      throw e;
    } finally {
      await rm(temp, { force: true });
      if (prepared?.temporary) this.encoder.cleanup(prepared);
    }
  }

  async recordings(user: DashboardUser, q = '', page = 1) {
    const where: Prisma.VoiceRecordingWhereInput = {
      task: { ...this.scopeWhere(user), voiceMode: 'library' },
      ...(q ? { title: { contains: q } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.voiceRecording.findMany({
        where,
        take: 40,
        skip: (page - 1) * 40,
        orderBy: { id: 'desc' },
        include: { task: true, deliveries: deliveryRelation },
      }),
      this.prisma.voiceRecording.count({ where }),
    ]);
    return {
      items: rows.map(
        ({
          filePath,
          telegramChatId,
          telegramMessageId,
          task,
          deliveries,
          ...r
        }) => ({
          ...r,
          task: this.publicTask(task),
          last_delivery: deliveryView(deliveries[0]),
          current:
            r.revision === task.revision &&
            ['ready', 'completed'].includes(task.status),
        }),
      ),
      total,
      page,
    };
  }

  async recording(user: DashboardUser, id: number) {
    const recording = await this.prisma.voiceRecording.findFirst({
      where: { id, task: this.scopeWhere(user) },
      include: { task: true },
    });
    if (!recording) throw new NotFoundException('Запись не найдена');
    return recording;
  }

  async file(user: DashboardUser, id: number) {
    const r = await this.recording(user, id);
    const path = resolve(r.filePath),
      rel = relative(resolve(appConfig.mediaDir, 'voicer'), path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new NotFoundException();
    return { data: await readFile(path), title: r.title };
  }

  async rename(user: DashboardUser, id: number, title: string) {
    this.scope.requireManager(user);
    await this.recording(user, id);
    if (!title.trim()) throw new BadRequestException('Укажите название');
    await this.prisma.voiceRecording.update({
      where: { id },
      data: { title: title.trim() },
    });
    return { ok: true };
  }

  async sendRecording(
    user: DashboardUser,
    id: number,
    chatId: string,
    requestId: string,
  ) {
    this.scope.requireManager(user);
    const r = await this.recording(user, id);
    if (r.task.voiceMode !== 'library')
      throw new BadRequestException(
        'Одноразовую запись нельзя отправить повторно из библиотеки',
      );
    if (!Number.isSafeInteger(Number(chatId)))
      throw new BadRequestException('Некорректный диалог');
    const requestKey = `library:${user.id}:${requestId}`;
    return this.libraryDelivery(requestKey, id, chatId, r, user);
  }

  private async libraryDelivery(
    requestKey: string,
    id: number,
    chatId: string,
    r: VoiceRecording & { task: VoiceTask },
    user: DashboardUser,
  ) {
    try {
      return await this.libraryTransaction(requestKey, id, chatId, r, user);
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e;
      const settled = await this.prisma.voiceDelivery.findUnique({
        where: { requestKey },
        include: { pendingReply: true },
      });
      if (!settled) throw e;
      return deliveryView(settled);
    }
  }

  private libraryTransaction(
    requestKey: string,
    id: number,
    chatId: string,
    r: VoiceRecording & { task: VoiceTask },
    user: DashboardUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.voiceDelivery.findUnique({
        where: { requestKey },
        include: { pendingReply: true },
      });
      if (existing) {
        if (existing.recordingId !== id || existing.chatId !== BigInt(chatId))
          throw new ConflictException(
            'Запрос уже использован для другого получателя',
          );
        return deliveryView(existing);
      }
      const current = await tx.voiceTask.findUniqueOrThrow({
        where: { id: r.taskId },
      });
      if (
        r.revision !== current.revision ||
        !['ready', 'completed'].includes(current.status)
      )
        throw new ConflictException('Выберите актуальную готовую запись');
      const contact = await tx.contact.findUnique({
        where: { chatId: BigInt(chatId) },
        include: { account: { include: { manager: true } } },
      });
      if (
        !contact?.account ||
        (user.role !== 'admin' && contact.account.manager?.userId !== user.id)
      )
        throw new NotFoundException('Диалог недоступен для отправки');
      const unfinished = await tx.voiceDelivery.findFirst({
        where: {
          recordingId: id,
          chatId: contact.chatId,
          pendingReply: {
            status: { in: ['pending', 'claimed', 'needs_review'] },
          },
        },
        include: { pendingReply: true },
      });
      if (unfinished?.pendingReply?.status === 'needs_review')
        throw new ConflictException(
          'Проверьте предыдущую отправку этого голосового в Telegram перед повтором',
        );
      if (unfinished) return deliveryView(unfinished);
      const d = await this.delivery.enqueue(tx, current, r, {
        chatId: contact.chatId,
        accountId: contact.account.id,
        personaSlug: contact.account.personaId,
        requestedById: user.id,
        requestKey,
        mode: 'library',
      });
      return deliveryView({
        ...d,
        pendingReply: { status: 'pending', error: null, sentTs: null },
      });
    });
  }

  async notices(user: DashboardUser) {
    this.scope.requireManager(user);
    const where = { userId: user.id, task: this.scopeWhere(user) };
    const [items, unread] = await Promise.all([
      this.prisma.voiceNotice.findMany({
        where,
        orderBy: [{ readAt: 'asc' }, { id: 'desc' }],
        take: 40,
      }),
      this.prisma.voiceNotice.count({ where: { ...where, readAt: null } }),
    ]);
    return { items, unread };
  }

  async readNotice(user: DashboardUser, id: number) {
    this.scope.requireManager(user);
    await this.prisma.voiceNotice.updateMany({
      where: { id, userId: user.id, task: this.scopeWhere(user) },
      data: { readAt: this.clock.ts() },
    });
    return { ok: true };
  }

  async deliveryDetail(user: DashboardUser, id: number) {
    const d = await this.prisma.voiceDelivery.findFirst({
      where: { id, task: this.scopeWhere(user) },
      include: { pendingReply: true },
    });
    if (!d) throw new NotFoundException('Отправка не найдена');
    return deliveryView(d);
  }

  async retryDelivery(user: DashboardUser, id: number) {
    this.scope.requireManager(user);
    await this.deliveryDetail(user, id);
    await this.delivery.retry(id);
    return this.deliveryDetail(user, id);
  }
}
