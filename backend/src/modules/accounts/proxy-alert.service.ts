import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { appConfig } from 'src/config/app.config';
import { ChannelRegistry } from 'src/channels/registry';
import { proxyLabel } from 'src/domain/proxy';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { CryptoService } from 'src/shared/crypto.service';
import { alertConfigured, sendTelegramAlert } from 'src/shared/telegram-alert';
import { AccountsService } from './accounts.service';
import {
  type AccountProbe,
  disabledMessage,
  ProxyWatch,
  type ProxyWatchState,
} from './proxy-alert';

/** Сколько аккаунт лежит, прежде чем предупреждать: переподключения короче. */
const DOWN_AFTER_SEC = 15 * 60;
/** Сколько напоминаний без замены прокси, прежде чем выключить аккаунт. */
const MAX_REMINDERS = 2;
const STATE_KEY = 'proxy_watch';

/**
 * Предупреждение в ту же группу, что и баланс: у каких активных аккаунтов
 * не работает прокси (не в сети дольше 15 минут из-за связи), за кем они и
 * какой прокси менять. После двух напоминаний без замены прокси аккаунт
 * ставится на паузу: мёртвый аккаунт держит диалоги и очереди. Без
 * настроенной группы молчит и ничего не выключает — без предупреждений
 * выключать нельзя. Состояние хранится в settings: деплой не сбрасывает
 * отсчёт и не шлёт предупреждение повторно.
 */
@Injectable()
export class ProxyAlertService {
  private readonly log = new Logger(ProxyAlertService.name);
  private readonly watch = new ProxyWatch(
    DOWN_AFTER_SEC,
    appConfig.balanceAlert.repeatHours * 3600,
    MAX_REMINDERS,
  );
  private busy = false;
  private loaded = false;

  constructor(
    private prisma: PrismaService,
    private channels: ChannelRegistry,
    private crypto: CryptoService,
    private clock: ClockService,
    private accounts: AccountsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    if (!alertConfigured() || this.busy) return;
    this.busy = true;
    try {
      await this.load();
      const now = this.clock.ts();
      const step = this.watch.step(await this.probes(), now);
      await this.save();
      for (const text of step.messages) {
        await sendTelegramAlert(text);
        this.log.log(`прокси: предупреждение отправлено`);
      }
      const off: typeof step.disable = [];
      for (const p of step.disable) {
        try {
          await this.accounts.setStatus(p.id, 'paused');
          off.push(p);
          this.log.warn(
            `прокси: аккаунт #${p.id} ${p.login} на паузе — прокси не заменили после ${MAX_REMINDERS} напоминаний`,
          );
        } catch (e) {
          this.log.warn(
            `прокси: не удалось выключить #${p.id}: ${(e as Error)?.message ?? e}`,
          );
        }
      }
      if (off.length)
        await sendTelegramAlert(disabledMessage(off, MAX_REMINDERS, now));
    } catch (e) {
      this.log.warn(`предупреждение о прокси: ${(e as Error)?.message ?? e}`);
    } finally {
      this.busy = false;
    }
  }

  private async load() {
    if (this.loaded) return;
    const row = await this.prisma.setting.findUnique({
      where: { key: STATE_KEY },
    });
    try {
      this.watch.restore(
        row ? (JSON.parse(row.value) as ProxyWatchState) : null,
      );
    } catch {
      this.watch.restore(null);
    }
    this.loaded = true;
  }

  private async save() {
    const value = JSON.stringify(this.watch.snapshot());
    const updatedAt = this.clock.ts();
    await this.prisma.setting.upsert({
      where: { key: STATE_KEY },
      create: { key: STATE_KEY, value, updatedAt },
      update: { value, updatedAt },
    });
  }

  /** «В сети», но приём сбоит из-за прокси — для предупреждения это как не в сети. */
  private state(id: number, channel: string) {
    if (!this.channels.isOnline(id))
      return {
        online: false,
        reason: this.channels.offlineReason(id, channel),
      };
    const trouble = this.channels.connectionTrouble(id, channel);
    return trouble
      ? { online: false, reason: trouble }
      : { online: true, reason: null };
  }

  async probes(): Promise<AccountProbe[]> {
    const rows = await this.prisma.channelAccount.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        channel: true,
        login: true,
        proxyConfigEncrypted: true,
        manager: {
          select: { user: { select: { username: true, regionCode: true } } },
        },
      },
      orderBy: { id: 'asc' },
    });
    return rows.map((a) => {
      let proxy: string | null = null;
      try {
        proxy = a.proxyConfigEncrypted
          ? proxyLabel(JSON.parse(this.crypto.decrypt(a.proxyConfigEncrypted)))
          : null;
      } catch {
        proxy = 'прокси не читается';
      }
      return {
        id: a.id,
        channel: a.channel,
        login: a.login,
        proxy,
        manager: a.manager?.user.username ?? null,
        region: a.manager?.user.regionCode ?? null,
        ...this.state(a.id, a.channel),
      };
    });
  }
}
