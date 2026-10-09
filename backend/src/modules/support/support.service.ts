import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import sharp from 'sharp';
import { appConfig } from 'src/config/app.config';
import { ClockService } from 'src/shared/clock.service';
import { panelTime } from 'src/shared/panel-time';

export const MAX_TEXT = 4000;
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Сколько обращений один пользователь может отправить за окно. */
export const RATE_LIMIT = { count: 5, windowS: 600 };
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PAGE_RE = /^\/[\w\-./?=&%]{0,200}$/;
const TG_CAPTION_MAX = 1024;

export interface SupportFile {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
  size: number;
}

export interface SupportReport {
  text: string;
  page?: string;
  files: SupportFile[];
}

export interface SupportAuthor {
  id: number;
  username: string;
  role: string;
}

type TelegramCall = (
  method: string,
  payload: Record<string, unknown> | FormData,
) => Promise<unknown>;

@Injectable()
export class SupportService {
  private readonly log = new Logger(SupportService.name);
  /** Отправки по пользователю за окно: защита от спама и от зацикленного клиента. */
  private readonly recent = new Map<number, number[]>();

  constructor(private clock: ClockService) {}

  get configured(): boolean {
    return Boolean(appConfig.supportBotToken && appConfig.supportChatId);
  }

  /**
   * Проверить обращение и отправить его в группу поддержки. Файлы живут только
   * в памяти на время запроса, на диск не пишутся.
   */
  async send(
    author: SupportAuthor,
    report: SupportReport,
    call: TelegramCall = (m, p) => this.telegram(m, p),
  ): Promise<{ ok: true }> {
    if (!this.configured)
      throw new ServiceUnavailableException(
        'поддержка не настроена: задайте SUPPORT_BOT_TOKEN и SUPPORT_CHAT_ID',
      );
    const text = String(report.text ?? '')
      .replace(/\r\n/g, '\n')
      .trim();
    if (!text) throw new UnprocessableEntityException('опишите проблему');
    if (text.length > MAX_TEXT)
      throw new UnprocessableEntityException(
        `текст длиннее ${MAX_TEXT} символов`,
      );
    const files = report.files ?? [];
    if (files.length > MAX_FILES)
      throw new UnprocessableEntityException(
        `не больше ${MAX_FILES} скриншотов`,
      );
    for (const f of files) await this.assertImage(f);
    this.assertRate(author.id);

    const page =
      report.page && PAGE_RE.test(report.page) ? report.page : '(не передана)';
    const header = [
      `🆘 Поддержка · ${author.username} (${author.role})`,
      `Страница: ${page}`,
      `Когда: ${panelTime(this.clock.ts())} МСК`,
    ].join('\n');
    const body = `${header}\n\n${text}`;
    const chat_id = appConfig.supportChatId;

    // Текст и фото без parse_mode: что написал пользователь, то и уходит,
    // никакой разметки, никакого HTML.
    if (!files.length) {
      await call('sendMessage', { chat_id, text: body });
    } else if (body.length <= TG_CAPTION_MAX) {
      await call('sendMediaGroup', this.mediaGroup(chat_id, files, body));
    } else {
      await call('sendMessage', { chat_id, text: body });
      await call('sendMediaGroup', this.mediaGroup(chat_id, files, ''));
    }
    this.log.log(
      `support report from ${author.username}: ${text.length} chars, ${files.length} file(s)`,
    );
    return { ok: true };
  }

  private mediaGroup(
    chat_id: string,
    files: SupportFile[],
    caption: string,
  ): FormData {
    const form = new FormData();
    form.set('chat_id', chat_id);
    form.set(
      'media',
      JSON.stringify(
        files.map((_, i) => ({
          type: 'photo',
          media: `attach://file${i}`,
          ...(i === 0 && caption ? { caption } : {}),
        })),
      ),
    );
    files.forEach((f, i) =>
      form.set(
        `file${i}`,
        new Blob([new Uint8Array(f.buffer)], { type: f.mimetype }),
        `screenshot-${i + 1}.${f.mimetype === 'image/png' ? 'png' : f.mimetype === 'image/webp' ? 'webp' : 'jpg'}`,
      ),
    );
    return form;
  }

  /** Тип по заголовку запроса не доказательство: смотрим на байты через sharp. */
  private async assertImage(f: SupportFile): Promise<void> {
    if (!ALLOWED_TYPES.has(f.mimetype))
      throw new UnprocessableEntityException(
        'скриншоты только png, jpeg или webp',
      );
    if (f.size > MAX_FILE_BYTES || f.buffer.length > MAX_FILE_BYTES)
      throw new UnprocessableEntityException('скриншот больше 5 МБ');
    let format = '';
    try {
      format =
        (await sharp(f.buffer, { limitInputPixels: 50e6 }).metadata()).format ??
        '';
    } catch {
      format = '';
    }
    const expected =
      f.mimetype === 'image/png'
        ? 'png'
        : f.mimetype === 'image/webp'
          ? 'webp'
          : 'jpeg';
    if (format !== expected)
      throw new UnprocessableEntityException(
        'файл не похож на изображение заявленного типа',
      );
  }

  private assertRate(userId: number): void {
    const now = this.clock.ts();
    const stamps = (this.recent.get(userId) ?? []).filter(
      (t) => now - t < RATE_LIMIT.windowS,
    );
    if (stamps.length >= RATE_LIMIT.count)
      throw new HttpException(
        'слишком много обращений подряд, подождите несколько минут',
        429,
      );
    stamps.push(now);
    this.recent.set(userId, stamps);
  }

  private async telegram(
    method: string,
    payload: Record<string, unknown> | FormData,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(
        `https://api.telegram.org/bot${appConfig.supportBotToken}/${method}`,
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
      throw new HttpException('Telegram не отвечает, попробуйте позже', 502);
    }
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
    };
    if (!response.ok || !data.ok) {
      // Описание ошибки Telegram в лог, пользователю — без деталей о боте.
      this.log.warn(
        `telegram ${method} failed: ${data.description ?? response.status}`,
      );
      throw new HttpException('не удалось отправить в поддержку', 502);
    }
    return data;
  }
}
