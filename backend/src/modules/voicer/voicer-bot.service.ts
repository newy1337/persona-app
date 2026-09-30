import { panelTime } from 'src/shared/panel-time';
import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { VoiceTask } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { VoicerService } from './voicer.service';
import { VoicerBriefService } from './voicer-brief.service';

const MAX_BYTES = 20 * 1024 * 1024;
export class TelegramBotError extends Error {
  constructor(
    public code: number,
    public retryAfter = 30,
  ) {
    super(`Telegram: ${code}`);
  }
}

@Injectable()
export class VoicerBotService implements OnModuleInit {
  private readonly log = new Logger(VoicerBotService.name);
  private readonly token = (process.env.VOICER_BOT_TOKEN ?? '').trim();
  private busy = false;
  private nextInit = 0;
  private pollAfter = 0;
  username = '';
  health = '';
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private voicer: VoicerService,
    private briefs: VoicerBriefService,
  ) {}

  async onModuleInit() {
    if (this.token) await this.initialize();
  }
  status() {
    return {
      configured: Boolean(this.token),
      username: this.username,
      error: this.health || null,
    };
  }

  async api(method: string, payload: Record<string, unknown> | FormData = {}) {
    let response: Response;
    try {
      response = await fetch(
        `https://api.telegram.org/bot${this.token}/${method}`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(20000),
          ...(payload instanceof FormData
            ? { body: payload }
            : {
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              }),
        },
      );
    } catch {
      throw new TelegramBotError(503);
    }
    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new TelegramBotError(502);
    }
    if (!response.ok || !data.ok)
      throw new TelegramBotError(
        data.error_code ?? response.status,
        data.parameters?.retry_after ?? 30,
      );
    return data.result;
  }

  private async initialize() {
    this.nextInit = this.clock.ts() + 60;
    try {
      const me = await this.api('getMe');
      const webhook = await this.api('getWebhookInfo');
      if (webhook.url) {
        this.health =
          'У бота уже настроен webhook. Нужен отдельный бот без webhook';
        return;
      }
      this.username = me.username;
      this.health = '';
      await this.prisma.voicerBotState.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
      });
    } catch {
      this.health =
        'Не удалось подключиться к Telegram. Проверьте токен и сеть';
    }
  }

  async say(
    chatId: string | number | bigint,
    text: string,
    extra: Record<string, unknown> = {},
  ) {
    return this.api('sendMessage', { chat_id: String(chatId), text, ...extra });
  }

  async biography(chatId: bigint, task: VoiceTask) {
    const user = await this.voicer.telegramUser(chatId);
    if (!user)
      throw new BadRequestException('Сначала подключите кабинет войсера');
    const brief =
      task.kind === 'call'
        ? await this.briefs.forTelegram(user, task.id)
        : task.biography;
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set(
      'document',
      new Blob([brief], { type: 'text/plain;charset=utf-8' }),
      `bio-task-${task.id}.txt`,
    );
    form.set(
      'caption',
      task.kind === 'call'
        ? `Памятка к звонку #${task.id}: личность, собеседник и важное из общения. Актуальные данные — в кабинете.`
        : `Полная карточка: ${task.personaName}. Снимок при создании задания #${task.id}`,
    );
    return this.api('sendDocument', form);
  }

  async deliver(task: VoiceTask, chatId: bigint) {
    let chatUrl = '';
    try {
      const panel = new URL(process.env.VOICER_PANEL_URL ?? '');
      if (
        panel.protocol === 'https:' &&
        !panel.username &&
        !panel.password &&
        task.chatId &&
        task.kind === 'call'
      ) {
        chatUrl = new URL(`/voice?task=${task.id}&view=chat`, panel.origin)
          .href;
      }
    } catch {
      /* Panel URL is optional outside deployments with a web cabinet. */
    }
    const prefix = `#${task.id} · ${task.kind === 'call' ? 'Звонок' : task.voiceMode === 'once' ? 'Одноразовое голосовое' : 'Голосовое в библиотеку'} · ${task.title}\n${task.source === 'bot' ? 'Заявка бота\n' : ''}Менеджер: ${task.managerName}\nСобеседник: ${task.contactLabel}\nЛичность: ${task.personaName}`;
    if (task.status === 'cancelled')
      return this.say(
        chatId,
        `${prefix}\n\nЗадание отменено менеджером.${task.outcome ? `\n${task.outcome}` : ''}`,
      );
    if (task.kind === 'call') await this.biography(chatId, task);
    const details = [
      task.contactRef && `Контакт: ${task.contactRef}`,
      task.emotion && `Эмоциональность: ${task.emotion}`,
      task.tempo && `Темп: ${task.tempo}`,
      task.dueAt && `Желаемое время: ${panelTime(task.dueAt)}`,
      task.script && `Текст для записи:\n${task.script}`,
      task.instructions && `Тема / что сделать:\n${task.instructions}`,
      task.feedback && `Что изменить:\n${task.feedback}`,
      task.kind === 'call' &&
        task.outcome &&
        `Результат звонка:\n${task.outcome}${task.status === 'completed' ? '\nЗадание выполнено автоматически. Подтверждать звонок не нужно; при желании дополните итог в кабинете.' : '\nЕсли звонок не состоялся, укажите причину в кабинете или повторите попытку.'}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    let text = `${prefix}\n\n${details}`;
    if (text.length > 3600) {
      const form = new FormData();
      form.set('chat_id', String(chatId));
      form.set(
        'document',
        new Blob([text], { type: 'text/plain;charset=utf-8' }),
        `task-${task.id}.txt`,
      );
      await this.api('sendDocument', form);
      text = `${prefix}\n\nПолный текст и указания — в файле выше.`;
    }
    let reply_markup: unknown;
    if (task.status === 'in_progress' && task.kind === 'voice') {
      text +=
        task.voiceMode === 'once'
          ? `\n\nЗапишите голосовое ОТВЕТОМ на это сообщение. После записи оно автоматически уйдёт в диалог ${task.chatId} (${task.contactLabel}). Проверьте текст перед записью.`
          : '\n\nЗапишите голосовое ОТВЕТОМ на это сообщение. Оно попадёт в библиотеку менеджера.';
      if (chatUrl)
        text += `\n\nПереписка и звонок с сайта (вход в кабинет): ${chatUrl}`;
      reply_markup = { force_reply: true, selective: true };
    } else {
      const callback = (action: string) =>
        `vw:${action}:${task.id}:${task.revision}`;
      const buttons =
        task.status === 'queued'
          ? [{ text: 'Взять в работу', callback_data: callback('claim') }]
          : task.status === 'in_progress' && task.kind === 'call'
            ? [
                {
                  text: 'Не удалось позвонить',
                  callback_data: callback('missed'),
                },
              ]
            : [];
      reply_markup = {
        inline_keyboard: [
          buttons,
          ...(chatUrl
            ? [[{ text: 'Переписка и звонок с сайта', url: chatUrl }]]
            : []),
          [
            {
              text: task.kind === 'call' ? 'Памятка к звонку' : 'Биография',
              callback_data: callback('bio'),
            },
          ],
        ].filter((row) => row.length),
      };
    }
    const sent = await this.say(chatId, text, {
      reply_markup,
      link_preview_options: { is_disabled: true },
    });
    await this.prisma.voiceTask.updateMany({
      where: { id: task.id, revision: task.revision, status: task.status },
      data: {
        botMessageId: sent.message_id,
        botChatId: chatId,
        notifiedVersion: task.notifyVersion,
        notifyError: null,
      },
    });
    return sent;
  }

  private async download(fileId: string) {
    const file = await this.api('getFile', { file_id: fileId });
    if (
      file.file_size > MAX_BYTES ||
      typeof file.file_path !== 'string' ||
      !/^[\w/.-]+$/.test(file.file_path) ||
      file.file_path.split('/').includes('..')
    ) {
      throw new BadRequestException('Аудио должно быть не больше 20 МБ');
    }
    let response: Response;
    try {
      response = await fetch(
        `https://api.telegram.org/file/bot${this.token}/${file.file_path}`,
        { signal: AbortSignal.timeout(60000), redirect: 'error' },
      );
    } catch {
      throw new TelegramBotError(503);
    }
    if (!response.ok || !response.body)
      throw new TelegramBotError(response.status);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body.cancel();
      throw new BadRequestException('Аудио больше 20 МБ');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new BadRequestException('Аудио больше 20 МБ');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }

  async handle(update: any) {
    const message = update.message ?? update.callback_query?.message;
    const from = update.callback_query?.from ?? update.message?.from;
    if (
      !message ||
      !from ||
      message.chat?.type !== 'private' ||
      String(message.chat.id) !== String(from.id) ||
      from.is_bot
    )
      return;
    const chatId = BigInt(message.chat.id);
    try {
      const start = String(update.message?.text ?? '').match(
        /^\/start(?:@\w+)? bind_([a-f0-9]{48})$/,
      );
      if (start) {
        const user = await this.voicer.bind(
          start[1],
          chatId,
          from.username ?? null,
        );
        await this.say(
          chatId,
          `Кабинет «${user.username}» подключён. Новые задания придут сюда. /tasks — ваша очередь. Для записи нажмите «Взять в работу» и ответьте голосовым на сообщение задания.`,
        );
        return;
      }
      const user = await this.voicer.telegramUser(chatId);
      if (!user) {
        await this.say(
          chatId,
          'Откройте раздел «Войсер» в своём кабинете и нажмите «Подключить Telegram» либо получите ссылку у администратора.',
        );
        return;
      }
      if (update.callback_query) {
        await this.api('answerCallbackQuery', {
          callback_query_id: update.callback_query.id,
        }).catch(() => {});
        const match = String(update.callback_query.data).match(
          /^vw:(claim|open|bio|done|missed):(\d+):(\d+)$/,
        );
        if (!match) return;
        const [, action, id, rev] = match;
        const task = await this.voicer.task(user, Number(id));
        if (task.revision !== Number(rev))
          throw new BadRequestException(
            'Старая версия задания. Откройте актуальную через /tasks',
          );
        if (action === 'bio') {
          await this.biography(chatId, task);
          return;
        }
        if (action === 'done' || action === 'missed') {
          if (task.kind === 'call' && task.status === 'completed') {
            await this.say(
              chatId,
              `Задание #${task.id} уже завершено. ${task.outcome}`,
            );
            return;
          }
          if (action === 'done') {
            await this.say(
              chatId,
              'Состоявшийся звонок с сайта завершится автоматически. Если звонка не было, укажите причину в кабинете или нажмите «Не удалось позвонить».',
            );
            return;
          }
          await this.voicer.action(user, task.id, {
            action: 'complete',
            revision: task.revision,
            note: 'Не удалось дозвониться',
          });
          await this.say(
            chatId,
            `Результат задания #${task.id} сохранён. /tasks — следующее задание`,
          );
          return;
        }
        if (action === 'claim')
          await this.voicer.action(user, task.id, {
            action: 'claim',
            revision: task.revision,
          });
        await this.deliver(await this.voicer.task(user, task.id), chatId);
        return;
      }
      const release = String(message.text ?? '').match(/^\/release (\d+)$/);
      if (release) {
        const task = await this.voicer.task(user, Number(release[1]));
        await this.voicer.action(user, task.id, {
          action: 'release',
          revision: task.revision,
        });
        await this.say(
          chatId,
          `Задание #${task.id} возвращено в очередь. /tasks — выбрать другое`,
        );
        return;
      }
      const audio =
        message.voice ??
        message.audio ??
        (message.document?.mime_type?.startsWith('audio/')
          ? message.document
          : null);
      if (audio) {
        const duplicate = await this.prisma.voiceRecording.findUnique({
          where: {
            telegramChatId_telegramMessageId: {
              telegramChatId: chatId,
              telegramMessageId: message.message_id,
            },
          },
        });
        if (duplicate) {
          await this.say(chatId, 'Эта запись уже сохранена. /tasks — очередь');
          return;
        }
        if (audio.file_size > MAX_BYTES)
          throw new BadRequestException('Аудио больше 20 МБ');
        const task = message.reply_to_message?.message_id
          ? await this.prisma.voiceTask.findFirst({
              where: {
                voicerId: user.id,
                botChatId: chatId,
                botMessageId: message.reply_to_message.message_id,
                status: 'in_progress',
                kind: 'voice',
              },
            })
          : null;
        if (!task)
          throw new BadRequestException(
            'Откройте /tasks, возьмите задание и отправьте аудио ОТВЕТОМ на последнее сообщение с текстом задания',
          );
        await this.voicer.record(
          user,
          task.id,
          task.revision,
          chatId,
          message.message_id,
          await this.download(audio.file_id),
        );
        await this.say(
          chatId,
          task.voiceMode === 'once'
            ? `Запись «${task.title}» принята и поставлена на отправку в диалог ${task.chatId}. Результат будет в кабинете. /tasks — следующее задание`
            : `Задание #${task.id} выполнено. Запись «${task.title}» сохранена в библиотеке. Менеджеру добавлено уведомление о готовности. /tasks — следующее задание`,
        );
        return;
      }
      const result = await this.voicer.list(user, 'active', '', 1);
      if (!result.items.length) {
        await this.say(
          chatId,
          'Активных заданий пока нет. Новые придут автоматически.',
        );
        return;
      }
      await this.say(
        chatId,
        `Ваша очередь: ${result.total}. Выберите задание.${result.total > 20 ? '\nОстальные доступны в кабинете.' : ''}`,
        {
          reply_markup: {
            inline_keyboard: result.items.slice(0, 20).map((t) => [
              {
                text: `#${t.id} ${t.status === 'in_progress' ? '▶ ' : t.status === 'ready' ? '✓ ' : ''}${t.title}`.slice(
                  0,
                  64,
                ),
                callback_data: `vw:open:${t.id}:${t.revision}`,
              },
            ]),
          },
        },
      );
    } catch (e) {
      if (e instanceof HttpException) {
        await this.say(chatId, e.message);
        return;
      }
      throw e;
    }
  }

  @Cron('*/5 * * * * *')
  async tick() {
    if (!this.token || this.busy || this.clock.ts() < this.pollAfter) return;
    this.busy = true;
    try {
      if (!this.username) {
        if (this.clock.ts() >= this.nextInit) await this.initialize();
        return;
      }
      const state = await this.prisma.voicerBotState.findUnique({
        where: { id: 1 },
      });
      const updates = await this.api('getUpdates', {
        offset: state?.nextUpdateId ?? 0,
        timeout: 0,
        limit: 20,
        allowed_updates: ['message', 'callback_query'],
      });
      for (const update of updates) {
        try {
          await this.handle(update);
        } catch (e) {
          if (![400, 403].includes(e?.code)) throw e;
          this.log.warn(
            `Пропущен отклонённый Telegram update ${update.update_id}: ${e.code}`,
          );
        }
        await this.prisma.voicerBotState.update({
          where: { id: 1 },
          data: { nextUpdateId: update.update_id + 1 },
        });
      }
      const tasks = await this.prisma.voiceTask.findMany({
        where: {
          notifiedVersion: { lt: this.prisma.voiceTask.fields.notifyVersion },
          notifyAfter: { lte: this.clock.ts() },
          OR: [
            { status: { in: ['queued', 'in_progress', 'cancelled'] } },
            { kind: 'call', status: 'completed' },
          ],
          voicer: {
            role: 'voice',
            voiceProfile: { telegramId: { not: null } },
          },
        },
        orderBy: [{ priority: 'desc' }, { id: 'asc' }],
        take: 5,
        include: { voicer: { include: { voiceProfile: true } } },
      });
      for (const task of tasks) {
        try {
          await this.deliver(task, task.voicer!.voiceProfile!.telegramId!);
          await this.prisma.voiceTask.updateMany({
            where: { id: task.id, notifyVersion: task.notifyVersion },
            data: { notifiedVersion: task.notifyVersion, notifyError: null },
          });
        } catch (e) {
          await this.prisma.voiceTask.update({
            where: { id: task.id },
            data: {
              notifyAfter: this.clock.ts() + Math.max(60, e?.retryAfter ?? 60),
              notifyError:
                e?.code === 403
                  ? 'Бот заблокирован войсером. Откройте бот и нажмите /start'
                  : 'Telegram временно недоступен. Повторим автоматически',
            },
          });
        }
      }
      this.health = '';
    } catch (e) {
      if (e?.code === 429)
        this.pollAfter = this.clock.ts() + Math.max(5, e.retryAfter ?? 30);
      this.health =
        e?.code === 409
          ? 'Бот запущен ещё в одном месте: остановите второй обработчик'
          : 'Ошибка связи с Telegram. Повторим автоматически';
      this.log.warn(this.health);
    } finally {
      this.busy = false;
    }
  }
}
