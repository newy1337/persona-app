import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { appConfig } from 'src/config/app.config';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { HistoryService } from 'src/shared/history.service';
import { FunnelEventsService } from 'src/shared/funnel-events.service';
import { GlobalGateService } from 'src/shared/global-gate.service';
import { TelegramService } from 'src/modules/telegram/telegram.service';
import { LeadsService } from './leads.service';
import { REPLY_BRAIN, ReplyBrain } from 'src/brain/reply-brain.port';
import { FIRST_CONTACT_TS_KEY } from 'src/domain/lead-facts';
import {
  floodRetryAfter,
  IMPORT_THROTTLE_BACKOFF_S,
  MAX_OUTREACH_ATTEMPTS,
  mskDayStart,
  RETRY_BACKOFF_S,
  releasedLeadError,
  withinOutreachHours,
} from 'src/domain/leads';
import { toChatId } from 'src/utils/ids';
import { isTelegramTimeout } from 'src/domain/timeout';

const STALLED_ACCOUNT_PAUSE_S = 15 * 60;
const TICK_STALE_S = 10 * 60;

@Injectable()
export class OutreachWorker implements OnModuleInit {
  private readonly log = new Logger(OutreachWorker.name);
  private runningSince: number | null = null;

  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private history: HistoryService,
    private funnel: FunnelEventsService,
    private gate: GlobalGateService,
    private telegram: TelegramService,
    private leads: LeadsService,
    @Inject(REPLY_BRAIN) private brain: ReplyBrain,
  ) {}

  async onModuleInit(): Promise<void> {
    const now = this.clock.ts();
    const stuck = await this.prisma.phoneNumber.findMany({
      where: {
        status: 'queued',
        assignedAccountId: { not: null },
        nextAttemptAt: { gt: now },
        lastError: { startsWith: 'flood' },
      },
      select: { id: true, assignedAccountId: true, nextAttemptAt: true },
    });
    for (const lead of stuck) {
      await this.limitAccount(
        lead.assignedAccountId!,
        lead.nextAttemptAt!,
        'флуд от Telegram',
      );
      await this.releaseLead(
        lead.id,
        lead.assignedAccountId!,
        'флуд от Telegram',
        lead.nextAttemptAt!,
      );
    }
    if (stuck.length)
      this.log.warn(
        `outreach: ${stuck.length} lead(s) stuck on flood-limited accounts released to others`,
      );
  }

  private async limitAccount(
    accountId: number,
    untilTs: number,
    reason: string,
  ): Promise<void> {
    await this.prisma.tgAccount.updateMany({
      where: {
        id: accountId,
        OR: [{ floodUntil: null }, { floodUntil: { lt: untilTs } }],
      },
      data: { floodUntil: untilTs, floodReason: reason },
    });
  }

  private async releaseLead(
    leadId: number,
    accountId: number,
    reason: string,
    untilTs: number,
  ): Promise<void> {
    const lead = await this.prisma.phoneNumber.findUniqueOrThrow({
      where: { id: leadId },
      select: { preferredAccountId: true },
    });
    const account = await this.prisma.tgAccount.findUnique({
      where: { id: accountId },
      select: { username: true },
    });
    const label = account?.username
      ? `@${account.username}`
      : `аккаунт #${accountId}`;
    await this.prisma.phoneNumber.update({
      where: { id: leadId },
      data: {
        status: 'queued',
        assignedAccountId: null,
        nextAttemptAt: lead.preferredAccountId === null ? null : untilTs,
        assignedAt: null,
        lastError:
          lead.preferredAccountId === null
            ? releasedLeadError(label, reason, untilTs)
            : `${label}: ${reason} — ждём выбранный аккаунт, другой аккаунт не используется`,
      },
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.telegram.configured || this.gate.stopped) return;
    const now = this.clock.ts();
    if (this.runningSince !== null) {
      if (now - this.runningSince < TICK_STALE_S) return;
      this.log.error(
        `outreach: previous tick has been running for ${now - this.runningSince}s — starting a new one`,
      );
    }
    if (!withinOutreachHours(now, appConfig.outreachHours)) return;
    const started = now;
    this.runningSince = started;
    try {
      for (const accountId of await this.eligibleAccounts(now)) {
        await this.processOne(accountId, now);
      }
    } catch (e) {
      this.log.error(`outreach tick failed: ${e?.message ?? e}`);
    } finally {
      if (this.runningSince === started) this.runningSince = null;
    }
  }

  private async eligibleAccounts(now: number): Promise<number[]> {
    const online = this.telegram.onlineIds();
    if (!online.length) return [];
    const active = await this.prisma.tgAccount.findMany({
      where: {
        id: { in: online },
        status: 'active',
        OR: [{ floodUntil: null }, { floodUntil: { lte: now } }],
      },
      select: { id: true },
    });
    const out: number[] = [];
    for (const { id } of active) {
      const usage = await this.usageToday(id, now);
      if (usage.sent_today >= appConfig.outreachDailyPerAccount) continue;
      if (
        usage.last_contact_at !== null &&
        now - usage.last_contact_at < appConfig.outreachMinGapS
      )
        continue;
      out.push(id);
    }
    return out;
  }

  private async usageToday(accountId: number, now: number) {
    const dayStart = mskDayStart(now);
    const agg = await this.prisma.phoneNumber.aggregate({
      where: {
        assignedAccountId: accountId,
        firstContactAt: { gte: dayStart },
      },
      _count: { _all: true },
      _max: { firstContactAt: true },
    });
    const last = await this.prisma.phoneNumber.aggregate({
      where: { assignedAccountId: accountId },
      _max: { firstContactAt: true },
    });
    return {
      sent_today: agg._count._all,
      last_contact_at: last._max.firstContactAt ?? null,
    };
  }

  private async processOne(accountId: number, now: number): Promise<void> {
    const account = await this.prisma.tgAccount.findUnique({
      where: { id: accountId },
      select: { personaId: true },
    });
    const [accountManagers, managers] = await Promise.all([
      this.prisma.managerAccount.findMany({
        where: { tgAccountId: accountId },
        select: { userId: true },
      }),
      this.prisma.dashboardUser.findMany({
        where: { role: { not: 'admin' } },
        select: { id: true },
      }),
    ]);
    const mine = accountManagers.map((m) => m.userId);
    const foreignManagers = managers
      .map((m) => m.id)
      .filter((id) => !mine.includes(id));
    const candidate = await this.prisma.phoneNumber.findFirst({
      where: {
        status: 'queued',
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        AND: [
          {
            OR: [{ assignedAccountId: null }, { assignedAccountId: accountId }],
          },
          {
            OR: [
              { preferredAccountId: null },
              { preferredAccountId: accountId },
            ],
          },
          {
            OR: [
              { avoidAccountId: null },
              { avoidAccountId: { not: accountId } },
            ],
          },
          {
            OR: [
              { personaId: null },
              ...(account?.personaId ? [{ personaId: account.personaId }] : []),
            ],
          },
          {
            OR: [
              { ownerUserId: null },
              { ownerUserId: { notIn: foreignManagers } },
            ],
          },
        ],
      },
      orderBy: { id: 'asc' },
    });
    if (!candidate) return;
    const claimed = await this.prisma.phoneNumber.updateMany({
      where: {
        id: candidate.id,
        status: 'queued',
        assignedAccountId: candidate.assignedAccountId,
      },
      data: { assignedAccountId: accountId },
    });
    if (claimed.count !== 1) return;

    let openerStarted = false;
    try {
      const resolved = candidate.phoneE164
        ? await this.telegram.resolvePhone(
            accountId,
            candidate.phoneE164,
            candidate.firstName ?? undefined,
          )
        : await this.telegram.resolveUsername(accountId, candidate.usernameKey);
      if (resolved.kind === 'retry') {
        const until = now + IMPORT_THROTTLE_BACKOFF_S;
        await this.limitAccount(accountId, until, 'лимит импорта контактов');
        await this.releaseLead(
          candidate.id,
          accountId,
          'лимит импорта контактов',
          until,
        );
        this.log.warn(
          `outreach: account ${accountId} hit the contact-import limit; lead #${candidate.id} queued with its sender preference preserved`,
        );
        return;
      }
      if (resolved.kind === 'not_found' || resolved.deleted) {
        await this.prisma.phoneNumber.update({
          where: { id: candidate.id },
          data: {
            status: 'dead',
            lastError:
              resolved.kind === 'found'
                ? 'аккаунт Telegram удалён'
                : candidate.phoneE164
                  ? 'номера нет в Telegram или он скрыт приватностью («кто видит мой номер»)'
                  : 'такого @username нет (или это канал/группа)',
            attempts: { increment: 1 },
          },
        });
        return;
      }
      const chatId = resolved.userId;
      if (await this.leads.isLeftoverOfDeletedLead(chatId, candidate.id)) {
        const wiped = await this.leads.wipeChatWithFiles(chatId);
        this.log.log(
          `outreach: lead #${candidate.id} — chat ${chatId} left from a deleted lead wiped (${wiped.messages} message(s)), starting over`,
        );
      }
      await this.prisma.phoneNumber.update({
        where: { id: candidate.id },
        data: {
          status: 'assigned',
          telegramUserId: toChatId(chatId),
          telegramUsername: resolved.username,
          assignedAt: this.clock.ts(),
        },
      });
      await this.history.ensureContact(chatId, accountId);
      await this.history.takeOverEmptyChat(chatId, accountId);
      await this.history.mergeLeadFacts(
        chatId,
        {
          ...(candidate.firstName ? { name: candidate.firstName } : {}),
          ...(candidate.city ? { city: candidate.city } : {}),
          ...(candidate.site ? { site: candidate.site } : {}),
          ...(candidate.age ? { age: candidate.age } : {}),
          ...(candidate.phoneE164 ? { phone: candidate.phoneE164 } : {}),
          _outreach_lead_id: candidate.id,
        },
        true,
      );

      openerStarted = true;
      const text = await this.brain.openLead(chatId, accountId, {
        firstName: candidate.firstName,
        city: candidate.city,
        age: candidate.age,
        site: candidate.site,
      });
      const ts = this.clock.ts();
      await this.prisma.phoneNumber.update({
        where: { id: candidate.id },
        data: { status: 'contacted', firstContactAt: ts, lastError: null },
      });
      await this.history.mergeLeadFacts(
        chatId,
        { [FIRST_CONTACT_TS_KEY]: ts },
        true,
      );
      await this.funnel.emit(chatId, 'outreach_sent', ts, {
        lead_id: candidate.id,
        account_id: accountId,
        chars: text.length,
      });
      this.log.log(
        `outreach: lead #${candidate.id} → chat ${chatId} via account ${accountId}`,
      );
    } catch (e) {
      if (isTelegramTimeout(e)) {
        const until = now + STALLED_ACCOUNT_PAUSE_S;
        await this.limitAccount(
          accountId,
          until,
          'Telegram не отвечает — переподключаем',
        );
        if (!openerStarted) {
          await this.releaseLead(
            candidate.id,
            accountId,
            'Telegram не отвечает',
            until,
          );
          this.log.warn(
            `outreach: ${e.message}; lead #${candidate.id} queued with its sender preference preserved`,
          );
        } else {
          await this.prisma.phoneNumber.update({
            where: { id: candidate.id },
            data: {
              status: 'queued',
              nextAttemptAt: until,
              lastError: `${e.message} при отправке первого сообщения — повтор после паузы`,
            },
          });
          this.log.warn(
            `outreach: ${e.message} while sending the opener to lead #${candidate.id}; retry after the pause`,
          );
        }
        return;
      }
      const flood = floodRetryAfter(e);
      if (flood !== null) {
        const until = now + flood;
        await this.limitAccount(accountId, until, 'флуд от Telegram');
        await this.releaseLead(
          candidate.id,
          accountId,
          'флуд от Telegram',
          until,
        );
        this.log.warn(
          `outreach: account ${accountId} flood-limited for ${flood}s; lead #${candidate.id} queued with its sender preference preserved`,
        );
        return;
      }
      const attempts = candidate.attempts + 1;
      const dead = attempts >= MAX_OUTREACH_ATTEMPTS;
      if (/already has a transcript/.test(String(e?.message ?? ''))) {
        await this.prisma.phoneNumber.update({
          where: { id: candidate.id },
          data: {
            status: 'dead',
            attempts,
            nextAttemptAt: null,
            lastError:
              'с этим человеком уже есть переписка — первое сообщение не отправлено; удалите старого лида или откройте чат',
          },
        });
        this.log.warn(
          `outreach: lead #${candidate.id} — chat already has a conversation, not sending an opener`,
        );
        return;
      }
      await this.prisma.phoneNumber.update({
        where: { id: candidate.id },
        data: {
          status: dead ? 'dead' : 'queued',
          attempts,
          nextAttemptAt: dead ? null : now + RETRY_BACKOFF_S,
          lastError: String(e?.message ?? e).slice(0, 256),
        },
      });
      this.log.warn(
        `outreach: lead #${candidate.id} attempt ${attempts} failed: ${e?.message ?? e}`,
      );
    }
  }

  async personaChoices(scopeAccounts: number[] | null = null) {
    const now = this.clock.ts();
    const [personas, accounts] = await Promise.all([
      this.prisma.persona.findMany({
        where: { enabled: true },
        orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
        select: { slug: true, name: true, isDefault: true },
      }),
      this.prisma.tgAccount.findMany({
        where: {
          status: 'active',
          ...(scopeAccounts === null ? {} : { id: { in: scopeAccounts } }),
        },
        select: { id: true, personaId: true, floodUntil: true },
      }),
    ]);
    return {
      items: personas.map((p) => {
        const mine = accounts.filter((a) => a.personaId === p.slug);
        return {
          slug: p.slug,
          name: p.name,
          is_default: p.isDefault,
          accounts: mine.length,
          accounts_ready: mine.filter(
            (a) =>
              this.telegram.isOnline(a.id) &&
              !(a.floodUntil && a.floodUntil > now),
          ).length,
        };
      }),
    };
  }

  async status(accounts: number[] | null = null) {
    const now = this.clock.ts();
    const rows = await this.prisma.tgAccount.findMany({
      where: {
        status: 'active',
        ...(accounts === null ? {} : { id: { in: accounts } }),
      },
      select: {
        id: true,
        phoneE164: true,
        floodUntil: true,
        floodReason: true,
        personaId: true,
      },
    });
    const perAccount = [];
    for (const a of rows) {
      const usage = await this.usageToday(a.id, now);
      const limited = a.floodUntil !== null && a.floodUntil > now;
      perAccount.push({
        account_id: a.id,
        phone_e164: a.phoneE164,
        persona_id: a.personaId,
        online: this.telegram.isOnline(a.id),
        flood_until: limited ? a.floodUntil : null,
        flood_reason: limited ? a.floodReason : null,
        ...usage,
      });
    }
    return {
      enabled: this.telegram.configured && !this.gate.stopped,
      within_hours: withinOutreachHours(now, appConfig.outreachHours),
      hours_msk: appConfig.outreachHours,
      daily_per_account: appConfig.outreachDailyPerAccount,
      min_gap_s: appConfig.outreachMinGapS,
      accounts: perAccount,
    };
  }
}
