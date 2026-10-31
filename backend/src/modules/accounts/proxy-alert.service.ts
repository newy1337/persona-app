import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { appConfig } from 'src/config/app.config';
import { ChannelRegistry } from 'src/channels/registry';
import { proxyLabel } from 'src/domain/proxy';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { CryptoService } from 'src/shared/crypto.service';
import { alertConfigured, sendTelegramAlert } from 'src/shared/telegram-alert';
import { type AccountProbe, ProxyWatch } from './proxy-alert';

/** Сколько аккаунт лежит, прежде чем предупреждать: переподключения короче. */
const DOWN_AFTER_SEC = 15 * 60;

/**
 * Предупреждение в ту же группу, что и баланс: у каких активных аккаунтов
 * не работает прокси (не в сети дольше 15 минут из-за связи), за кем они и
 * какой прокси менять. Без настроенной группы молчит.
 */
@Injectable()
export class ProxyAlertService {
  private readonly log = new Logger(ProxyAlertService.name);
  private readonly watch = new ProxyWatch(
    DOWN_AFTER_SEC,
    appConfig.balanceAlert.repeatHours * 3600,
  );
  private busy = false;

  constructor(
    private prisma: PrismaService,
    private channels: ChannelRegistry,
    private crypto: CryptoService,
    private clock: ClockService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    if (!alertConfigured() || this.busy) return;
    this.busy = true;
    try {
      for (const text of this.watch.step(
        await this.probes(),
        this.clock.ts(),
      )) {
        await sendTelegramAlert(text);
        this.log.log(`прокси: предупреждение отправлено`);
      }
    } catch (e) {
      this.log.warn(`предупреждение о прокси: ${(e as Error)?.message ?? e}`);
    } finally {
      this.busy = false;
    }
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
