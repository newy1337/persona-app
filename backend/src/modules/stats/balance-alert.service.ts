import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { appConfig } from 'src/config/app.config';
import { ClockService } from 'src/shared/clock.service';
import { alertConfigured, sendTelegramAlert } from 'src/shared/telegram-alert';
import { BalanceService, type OpenRouterBalance } from './balance.service';

const HOUR = 3600;

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Предупреждение в группу Telegram, когда на OpenRouter остаётся меньше порога
 * (BALANCE_ALERT_THRESHOLD, по умолчанию $300). Пишет один раз при переходе
 * ниже порога, дальше напоминает раз в BALANCE_ALERT_REPEAT_HOURS, пока баланс
 * низкий, и сообщает, когда счёт пополнили. Отправляет через Bot API ботом
 * BALANCE_ALERT_BOT_TOKEN (если не задан — ботом войсеров) в чат
 * BALANCE_ALERT_CHAT_ID. Без чата или токена молчит.
 *
 * Состояние «уже предупредили» живёт в памяти: после перезапуска при низком
 * балансе придёт одно новое предупреждение — это лучше, чем пропустить его.
 */
@Injectable()
export class BalanceAlertService {
  private readonly log = new Logger(BalanceAlertService.name);
  private low = false;
  private lastAlertAt = 0;
  private busy = false;

  constructor(
    private balance: BalanceService,
    private clock: ClockService,
  ) {}

  get configured(): boolean {
    return alertConfigured();
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick(): Promise<void> {
    if (!this.configured || this.busy) return;
    this.busy = true;
    try {
      await this.check();
    } catch (e) {
      this.log.warn(
        `проверка баланса OpenRouter: ${(e as Error)?.message ?? e}`,
      );
    } finally {
      this.busy = false;
    }
  }

  /** Одна проверка. Возвращает, что отправлено: 'low', 'recovered' или null. */
  async check(): Promise<'low' | 'recovered' | null> {
    const value = await this.balance.openRouter();
    // Баланс не прочитался — ничего не решаем: молчание лучше ложной тревоги.
    if (value.error || value.left === null) return null;
    const { threshold, repeatHours } = appConfig.balanceAlert;
    const now = this.clock.ts();

    if (value.left < threshold) {
      const repeat = this.low && now - this.lastAlertAt >= repeatHours * HOUR;
      if (this.low && !repeat) return null;
      await this.send(lowText(value, threshold, this.low));
      this.low = true;
      this.lastAlertAt = now;
      return 'low';
    }

    if (this.low) {
      this.low = false;
      this.lastAlertAt = 0;
      await this.send(
        `✅ OpenRouter пополнен: на счёте ${usd(value.left)} (порог ${usd(threshold)}).`,
      );
      return 'recovered';
    }
    return null;
  }

  private async send(text: string): Promise<void> {
    await sendTelegramAlert(text);
    this.log.log(
      `баланс OpenRouter: отправлено в чат ${appConfig.balanceAlert.chatId}`,
    );
  }
}

export function lowText(
  value: OpenRouterBalance,
  threshold: number,
  again: boolean,
): string {
  const lines = [
    `${again ? '⏰ Напоминание: б' : '⚠️ Б'}аланс OpenRouter ниже ${usd(threshold)} — осталось ${usd(value.left ?? 0)}.`,
  ];
  if (value.days_left !== null)
    lines.push(`При текущем расходе хватит примерно на ${value.days_left} дн.`);
  if (value.today !== null)
    lines.push(`Расход за сегодня: ${usd(value.today)}.`);
  lines.push('Пополните счёт: https://openrouter.ai/settings/credits');
  return lines.join('\n');
}
