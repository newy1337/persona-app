import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Api } from 'telegram';
import { PrismaService } from 'src/prisma.service';
import { CryptoService } from 'src/shared/crypto.service';
import { ClockService } from 'src/shared/clock.service';
import { TelegramService } from './telegram.service';
import { TelegramClient } from 'telegram';
import { withTimeout } from 'src/domain/timeout';
import { toString } from 'qrcode';

export const JOB_PENDING = 'pending';
export const JOB_NEED_CODE = 'need_code';
export const JOB_NEED_QR = 'need_qr';
export const JOB_NEED_2FA = 'need_2fa';
export const JOB_DONE = 'ok';
export const JOB_FAILED = 'failed';
const TERMINAL = new Set([JOB_DONE, JOB_FAILED]);
const INPUT_TIMEOUT_MS = 300_000;
const CONNECT_TIMEOUT_MS = 45_000;

/** Ссылка, которую ждёт Telegram в QR: токен в base64url без выравнивания. */
export const loginLink = (token: Buffer): string =>
  `tg://login?token=${token.toString('base64url')}`;

/** Картинку рисуем на сервере: токен входа — это ключ, его нельзя отдавать
 *  чужому генератору QR, а панель тогда обходится без лишней зависимости. */
export const qrSvg = (text: string): Promise<string> =>
  toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'L' });

export function loginErrorText(e: unknown): string {
  const msg = String((e as Error)?.message ?? e ?? '');
  const name = String((e as Error)?.name ?? '');
  if (
    /Proxy connection timed out|SocksClientError|ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|proxy/i.test(
      msg + ' ' + name,
    )
  ) {
    return 'прокси не отвечает — проверьте адрес, порт, логин и пароль прокси (или попробуйте другой)';
  }
  if (/подключение/i.test(msg)) return msg;
  if (/PHONE_NUMBER_INVALID/i.test(msg))
    return 'Telegram не принял номер телефона';
  if (/PHONE_CODE_INVALID/i.test(msg)) return 'неверный код из Telegram';
  if (/PHONE_CODE_EXPIRED/i.test(msg))
    return 'код устарел — начните вход заново';
  if (/PASSWORD_HASH_INVALID/i.test(msg))
    return 'неверный пароль двухфакторной защиты';
  if (/FLOOD_WAIT/i.test(msg))
    return 'Telegram просит подождать перед новой попыткой входа';
  return `${name || 'Error'}: ${msg}`;
}

class Input {
  private resolve: ((v: string) => void) | null = null;
  private reject: ((e: Error) => void) | null = null;
  readonly promise = new Promise<string>((res, rej) => {
    this.resolve = res;
    this.reject = rej;
  });
  constructor() {
    this.promise.catch(() => undefined);
  }
  supply(value: string) {
    this.resolve?.(value);
  }
  cancel(reason: string) {
    this.reject?.(new Error(reason));
  }
}

export type LoginMethod = 'phone' | 'qr';

export interface AuthJob {
  job_id: string;
  account_id: number;
  phone: string;
  method: LoginMethod;
  status: string;
  error: string | null;
  username: string | null;
  /** Картинка текущего кода и когда он протухнет; Telegram обновляет его сам. */
  qr: { svg: string; expires_at: number } | null;
  code: Input;
  password: Input;
  cancelled: boolean;
  client?: TelegramClient;
}

const snapshot = (j: AuthJob) => ({
  job_id: j.job_id,
  method: j.method,
  status: j.status,
  error: j.error,
  username: j.username,
  qr_svg: j.qr?.svg ?? null,
  qr_expires_at: j.qr?.expires_at ?? null,
});

@Injectable()
export class LoginService {
  private readonly log = new Logger(LoginService.name);
  private readonly jobs = new Map<string, AuthJob>();

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private clock: ClockService,
    private telegram: TelegramService,
  ) {}

  private activeFor(accountId: number): AuthJob | undefined {
    for (const job of this.jobs.values()) {
      if (job.account_id === accountId && !TERMINAL.has(job.status)) return job;
    }
    return undefined;
  }

  get(jobId: string): AuthJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new NotFoundException(`auth job ${jobId} not found`);
    return job;
  }

  status(jobId: string) {
    return snapshot(this.get(jobId));
  }

  async start(accountId: number, method: LoginMethod = 'phone') {
    if (!this.telegram.configured) {
      throw new UnprocessableEntityException(
        'TG_API_ID / TG_API_HASH are not configured',
      );
    }
    const account = await this.prisma.tgAccount.findUnique({
      where: { id: accountId },
    });
    if (!account)
      throw new NotFoundException(`tg_account id=${accountId} not found`);
    const running = this.activeFor(accountId);
    if (running) return snapshot(running);
    if (this.telegram.isOnline(accountId))
      await this.telegram.disconnect(accountId);

    const job: AuthJob = {
      job_id: randomUUID().replace(/-/g, ''),
      account_id: accountId,
      phone: account.phoneE164,
      method,
      status: JOB_PENDING,
      error: null,
      username: null,
      qr: null,
      code: new Input(),
      password: new Input(),
      cancelled: false,
    };
    this.jobs.set(job.job_id, job);
    void this.run(job);
    return snapshot(job);
  }

  private async waitFor(
    job: AuthJob,
    input: Input,
    status: string,
  ): Promise<string> {
    job.status = status;
    const timer = setTimeout(
      () =>
        input.cancel(
          `оператор не ввёл значение за ${INPUT_TIMEOUT_MS / 1000} с`,
        ),
      INPUT_TIMEOUT_MS,
    );
    try {
      return await input.promise;
    } finally {
      clearTimeout(timer);
      job.status = JOB_PENDING;
    }
  }

  private async run(job: AuthJob): Promise<void> {
    const client = this.telegram.buildClient(
      '',
      await this.telegram.proxyFor(job.account_id),
    );
    job.client = client;
    try {
      await withTimeout(
        client.connect(),
        CONNECT_TIMEOUT_MS,
        () =>
          new Error(
            `подключение к Telegram не удалось за ${CONNECT_TIMEOUT_MS / 1000} с — прокси не отвечает или недоступен`,
          ),
      );
      if (job.cancelled) throw new Error('отменено оператором');
      const onError = async (err: Error) => {
        this.log.warn(`auth job ${job.job_id}: ${err?.message ?? err}`);
        return true;
      };
      if (job.method === 'qr') {
        await client.signInUserWithQrCode(this.telegram.apiCredentials, {
          // Telegram сам обновляет код, пока его не отсканировали, и зовёт
          // это на каждый новый токен — просто показываем свежую картинку.
          qrCode: async ({ token, expires }) => {
            job.qr = {
              svg: await qrSvg(loginLink(token)),
              expires_at: expires,
            };
            job.status = JOB_NEED_QR;
          },
          password: async () => this.waitFor(job, job.password, JOB_NEED_2FA),
          onError,
        });
      } else {
        await client.start({
          phoneNumber: async () => job.phone,
          phoneCode: async () => this.waitFor(job, job.code, JOB_NEED_CODE),
          password: async () => this.waitFor(job, job.password, JOB_NEED_2FA),
          onError,
        });
      }
      const me = (await client.getMe()) as Api.User;
      const session = client.session.save() as unknown as string;
      const ts = this.clock.ts();
      await this.prisma.tgAccount.update({
        where: { id: job.account_id },
        data: {
          sessionEncrypted: this.crypto.encrypt(session),
          status: 'active',
          bannedAt: null,
          banReason: null,
          lastLoginAt: ts,
          telegramUserId: BigInt(Number(me.id)),
          username: me.username ?? null,
        },
      });
      job.username = me.username ?? me.firstName ?? null;
      job.status = JOB_DONE;
      await client.disconnect();
      await this.telegram.connect(job.account_id);
    } catch (e) {
      job.status = JOB_FAILED;
      job.error = job.cancelled ? 'отменено оператором' : loginErrorText(e);
      this.log.warn(`auth job ${job.job_id} failed: ${job.error}`);
      await withTimeout(
        client.disconnect(),
        10_000,
        () => new Error('disconnect timeout'),
      ).catch(() => undefined);
      await this.restoreAfterFailure(job.account_id);
    } finally {
      job.client = undefined;
    }
  }

  private async restoreAfterFailure(accountId: number): Promise<void> {
    this.telegram.release(accountId);
    const account = await this.prisma.tgAccount
      .findUnique({
        where: { id: accountId },
        select: { sessionEncrypted: true, status: true },
      })
      .catch(() => null);
    if (!account?.sessionEncrypted || account.status !== 'active') return;
    await this.telegram
      .connect(accountId)
      .catch((e) =>
        this.log.warn(
          `account ${accountId}: не вернулся в сеть после неудачного входа: ${e?.message ?? e}`,
        ),
      );
  }

  supplyCode(jobId: string, code: string) {
    const job = this.get(jobId);
    if (job.status !== JOB_NEED_CODE) {
      throw new ConflictException(
        `job ${jobId} is in status '${job.status}', expected '${JOB_NEED_CODE}'`,
      );
    }
    job.code.supply(code);
    return snapshot(job);
  }

  supplyPassword(jobId: string, password: string) {
    const job = this.get(jobId);
    if (job.status !== JOB_NEED_2FA) {
      throw new ConflictException(
        `job ${jobId} is in status '${job.status}', expected '${JOB_NEED_2FA}'`,
      );
    }
    job.password.supply(password);
    return snapshot(job);
  }

  cancel(jobId: string) {
    const job = this.get(jobId);
    if (!TERMINAL.has(job.status)) {
      job.cancelled = true;
      job.code.cancel('отменено оператором');
      job.password.cancel('отменено оператором');
      job.status = JOB_FAILED;
      job.error = 'отменено оператором';
      void job.client?.disconnect().catch(() => undefined);
    }
    return snapshot(job);
  }
}
