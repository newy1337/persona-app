import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PresenceService } from 'src/shared/presence.service';
import sharp from 'sharp';
import {
  cleanUsername,
  profileErrorText,
  usernameError,
} from 'src/domain/tg-profile';
import { TgAccount } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { CryptoService } from 'src/shared/crypto.service';
import { HistoryService } from 'src/shared/history.service';
import { appConfig } from 'src/config/app.config';
import { TelegramService } from '../telegram/telegram.service';
import {
  AddTgAccountDto,
  ProxyConfigDto,
  UpdateTgAccountDto,
  UpdateTgProfileDto,
} from './dto/tg-account.dto';
import { proxyLabel } from 'src/domain/proxy';

const HEARTBEAT_ALIVE_S = 120;

/** Public shape of an account: never the session, never proxy credentials. */
export interface TgAccountSummary {
  id: number;
  phone_e164: string;
  persona_id: string;
  status: string;
  needs_proxy_setup: boolean;
  proxy_geo: string | null;
  /** «socks5 1.2.3.4:1080 · user» — какой прокси стоит, без пароля и секрета. */
  proxy_label: string | null;
  /** Telegram ограничил аккаунт до этого времени (unix): новых лидов не берёт. null — не ограничен. */
  flood_until: number | null;
  /** Сколько диалогов ведёт аккаунт: при смене личности все они продолжатся от новой. */
  chats: number;
  /** Имя личности — подпись в таблице. */
  persona_name: string | null;
  flood_reason: string | null;
  last_login_at: number | null;
  last_heartbeat_at: number | null;
  routing_weight: number;
  daily_msg_quota: number | null;
  purpose: string;
  username: string | null;
  /** Имя профиля в Telegram. */
  display_name: string | null;
  /** Фото профиля аккаунта; null — нет или ещё не подключался. */
  avatar_url: string | null;
  /** Когда Telegram заблокировал аккаунт или завершил сессию; null — не терялся. */
  lost_at: number | null;
  /** Что случилось словами: «Telegram заблокировал аккаунт», «сессия завершена…». */
  lost_reason: string | null;
  online: boolean;
  has_session: boolean;
}

@Injectable()
export class TgAccountsService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private crypto: CryptoService,
    private history: HistoryService,
    private telegram: TelegramService,
    private presence: PresenceService,
  ) {}

  summary(
    a: TgAccount,
    extra: { chats?: number; personaName?: string | null } = {},
  ): TgAccountSummary {
    let geo: string | null = null;
    try {
      const meta = a.metaJson ? JSON.parse(a.metaJson) : {};
      geo = typeof meta?.proxy_geo === 'string' ? meta.proxy_geo : null;
    } catch {
      geo = null;
    }
    let label: string | null = null;
    try {
      label = a.proxyConfigEncrypted
        ? proxyLabel(JSON.parse(this.crypto.decrypt(a.proxyConfigEncrypted)))
        : null;
    } catch {
      label = null;
    }
    return {
      id: a.id,
      phone_e164: a.phoneE164,
      persona_id: a.personaId,
      status: a.status,
      needs_proxy_setup: Boolean(a.needsProxySetup),
      proxy_geo: geo,
      proxy_label: label,
      chats: extra.chats ?? 0,
      persona_name: extra.personaName ?? null,
      flood_until:
        a.floodUntil && a.floodUntil > this.clock.ts() ? a.floodUntil : null,
      flood_reason:
        a.floodUntil && a.floodUntil > this.clock.ts() ? a.floodReason : null,
      last_login_at: a.lastLoginAt,
      last_heartbeat_at: a.lastHeartbeatAt,
      routing_weight: a.routingWeight,
      daily_msg_quota: a.dailyMsgQuota,
      purpose: a.purpose,
      username: a.username,
      display_name: a.displayName ?? null,
      avatar_url: this.presence.accountAvatarUrl(a.id),
      lost_at:
        a.status === 'banned' || a.status === 'unauthorized'
          ? a.bannedAt
          : null,
      lost_reason:
        a.status === 'banned' || a.status === 'unauthorized'
          ? a.banReason
          : null,
      online: this.telegram.isOnline(a.id),
      has_session: Boolean(a.sessionEncrypted),
    };
  }

  async list(
    filter: { status?: string; persona_id?: string; purpose?: string } = {},
  ) {
    const rows = await this.prisma.tgAccount.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.persona_id ? { personaId: filter.persona_id } : {}),
        ...(filter.purpose ? { purpose: filter.purpose } : {}),
      },
      orderBy: { id: 'asc' },
    });
    const [chats, personas] = await Promise.all([
      this.prisma.contact.groupBy({
        by: ['accountId'],
        _count: { _all: true },
      }),
      this.prisma.persona.findMany({ select: { slug: true, name: true } }),
    ]);
    const chatsBy = new Map(chats.map((c) => [c.accountId, c._count._all]));
    const names = new Map(personas.map((p) => [p.slug, p.name]));
    return rows.map((a) =>
      this.summary(a, {
        chats: chatsBy.get(a.id) ?? 0,
        personaName: names.get(a.personaId) ?? null,
      }),
    );
  }

  /** Личность должна существовать и быть включена — иначе аккаунту некем говорить. */
  private async assertPersona(slug: string): Promise<void> {
    const persona = await this.prisma.persona.findUnique({
      where: { slug },
      select: { enabled: true },
    });
    if (!persona)
      throw new UnprocessableEntityException(`личности «${slug}» нет`);
    if (!persona.enabled)
      throw new UnprocessableEntityException(`личность «${slug}» выключена`);
  }

  /**
   * Правка аккаунта. Смена личности действует со следующего сообщения во всех его
   * диалогах. Лиды, которых аккаунт взял под другую личность, но ещё не написал,
   * отпускаются — их напишет аккаунт нужной личности.
   */
  /** Имя и ник аккаунта в самом Telegram. */
  async updateProfile(id: number, dto: UpdateTgProfileDto) {
    await this.get(id);
    const username =
      dto.username === undefined ? undefined : cleanUsername(dto.username);
    const bad = username === undefined ? null : usernameError(username);
    if (bad) throw new UnprocessableEntityException(bad);
    if (dto.first_name !== undefined && !dto.first_name.trim())
      throw new UnprocessableEntityException('имя не может быть пустым');
    try {
      await this.telegram.updateOwnProfile(id, {
        firstName: dto.first_name?.trim(),
        lastName:
          dto.last_name === undefined ? undefined : dto.last_name.trim(),
        username,
      });
    } catch (e) {
      throw new UnprocessableEntityException(profileErrorText(e));
    }
    return this.summary(await this.get(id));
  }

  /** Фото профиля: любая картинка → JPEG до 1280 px, Telegram сам сделает круг. */
  async setAvatar(id: number, body: Buffer) {
    await this.get(id);
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new UnprocessableEntityException('пустой файл');
    let jpeg: Buffer;
    try {
      jpeg = await sharp(body, {
        failOn: 'error',
        limitInputPixels: 40_000_000,
      })
        .rotate()
        .resize({
          width: 1280,
          height: 1280,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch {
      throw new UnprocessableEntityException(
        'это не картинка: нужен JPG, PNG или WebP',
      );
    }
    try {
      await this.telegram.setOwnPhoto(id, jpeg);
    } catch (e) {
      throw new UnprocessableEntityException(profileErrorText(e));
    }
    return this.summary(await this.get(id));
  }

  async update(id: number, dto: UpdateTgAccountDto) {
    const before = await this.get(id);
    const data: Record<string, unknown> = {};
    let releasedLeads = 0;
    if (dto.persona_id !== undefined && dto.persona_id !== before.personaId) {
      const chats = await this.prisma.contact.findMany({
        where: { accountId: id },
        select: { chatId: true },
      });
      if (
        chats.length &&
        (await this.prisma.message.count({
          where: { chatId: { in: chats.map((c) => c.chatId) } },
        }))
      ) {
        throw new UnprocessableEntityException(
          'У аккаунта уже есть переписка. Для другой личности добавьте отдельный аккаунт: смена смешает истории персонажей.',
        );
      }
      await this.assertPersona(dto.persona_id);
      data.personaId = dto.persona_id;
    }
    if (dto.purpose !== undefined) data.purpose = dto.purpose;
    if (dto.daily_msg_quota !== undefined)
      data.dailyMsgQuota = dto.daily_msg_quota;
    const updated = Object.keys(data).length
      ? await this.prisma.tgAccount.update({ where: { id }, data })
      : before;

    if (data.personaId) {
      const released = await this.prisma.phoneNumber.updateMany({
        where: {
          assignedAccountId: id,
          firstContactAt: null,
          personaId: { not: null },
          NOT: { personaId: String(data.personaId) },
        },
        data: {
          assignedAccountId: null,
          assignedAt: null,
          status: 'queued',
          nextAttemptAt: null,
        },
      });
      releasedLeads = released.count;
    }

    const [chats, persona] = await Promise.all([
      this.prisma.contact.count({ where: { accountId: id } }),
      this.prisma.persona.findUnique({
        where: { slug: updated.personaId },
        select: { name: true },
      }),
    ]);
    return {
      ...this.summary(updated, { chats, personaName: persona?.name ?? null }),
      released_leads: releasedLeads,
    };
  }

  async get(id: number): Promise<TgAccount> {
    const a = await this.prisma.tgAccount.findUnique({ where: { id } });
    if (!a) throw new NotFoundException(`tg_account id=${id} not found`);
    return a;
  }

  async add(dto: AddTgAccountDto, ownerUserId: number | null = null) {
    const phone = dto.phone_e164.startsWith('+')
      ? dto.phone_e164
      : `+${dto.phone_e164}`;
    if (dto.persona_id) await this.assertPersona(dto.persona_id);
    try {
      const created = await this.prisma.tgAccount.create({
        data: {
          phoneE164: phone,
          personaId: dto.persona_id || appConfig.personaId,
          status: 'unauthorized',
          addedAt: this.clock.ts(),
          purpose: dto.purpose ?? 'prod',
          proxyConfigEncrypted: dto.proxy_config
            ? this.crypto.encrypt(JSON.stringify(dto.proxy_config))
            : null,
          needsProxySetup: dto.proxy_config ? 0 : 1,
          dailyMsgQuota: dto.daily_msg_quota ?? null,
        },
      });
      if (ownerUserId !== null)
        await this.prisma.managerAccount.create({
          data: { userId: ownerUserId, tgAccountId: created.id },
        });
      return this.summary(created);
    } catch (e) {
      if (String(e?.code) === 'P2002')
        throw new ConflictException(`phone ${phone} already exists`);
      throw e;
    }
  }

  /**
   * Новый прокси начинает работать сразу: подключённый аккаунт переподключается через
   * него. Не подключился — это видно по `online` и `reconnect_error`, старый прокси не
   * возвращаем: оператор сохранил новый намеренно.
   */
  async setProxy(id: number, proxy: ProxyConfigDto) {
    await this.get(id);
    const clean = {
      type: proxy.type,
      host: proxy.host.trim(),
      port: proxy.port,
      username: proxy.username?.trim() || null,
      password: proxy.password || null,
      secret: proxy.type === 'mtproto' ? proxy.secret?.trim() || null : null,
    };
    const updated = await this.prisma.tgAccount.update({
      where: { id },
      data: {
        proxyConfigEncrypted: this.crypto.encrypt(JSON.stringify(clean)),
        needsProxySetup: 0,
      },
    });
    let reconnectError: string | null = null;
    if (this.telegram.isOnline(id) && updated.status === 'active') {
      try {
        await this.telegram.reconnect(id);
      } catch (e) {
        reconnectError = String(e?.message ?? e);
      }
    }
    return {
      ...this.summary(updated),
      online: this.telegram.isOnline(id),
      reconnect_error: reconnectError,
    };
  }

  /**
   * Поднять аккаунт руками: оператору есть что нажать, когда тот выпал из сети —
   * ждать сторожа не нужно, а ошибка подключения возвращается словами.
   */
  async reconnect(id: number) {
    const account = await this.get(id);
    if (!account.sessionEncrypted)
      throw new UnprocessableEntityException(
        'у аккаунта нет сессии — войдите заново',
      );
    if (account.status !== 'active') {
      throw new UnprocessableEntityException(
        `аккаунт в статусе «${account.status}» — переподключать нечего`,
      );
    }
    let error: string | null = null;
    try {
      await this.telegram.reconnect(id);
    } catch (e) {
      error = String(e?.message ?? e);
    }
    const updated = await this.get(id);
    return {
      ...this.summary(updated),
      online: this.telegram.isOnline(id),
      reconnect_error: error,
    };
  }

  /** «Был в сети» у аккаунта: читается из самого Telegram, пока аккаунт в сети. */
  async privacy(id: number) {
    await this.get(id);
    try {
      return { hide_last_seen: await this.telegram.lastSeenHidden(id) };
    } catch (e) {
      throw new UnprocessableEntityException(profileErrorText(e));
    }
  }

  async setPrivacy(id: number, hide: boolean) {
    await this.get(id);
    try {
      return {
        hide_last_seen: await this.telegram.setLastSeenHidden(id, hide),
      };
    } catch (e) {
      throw new UnprocessableEntityException(profileErrorText(e));
    }
  }

  /** Снять метку ограничения вручную: оператор знает, что аккаунт снова в порядке. */
  async clearFlood(id: number) {
    await this.get(id);
    const updated = await this.prisma.tgAccount.update({
      where: { id },
      data: { floodUntil: null, floodReason: null },
    });
    return this.summary(updated);
  }

  async setStatus(id: number, status: string, reason?: string) {
    await this.get(id);
    const data: any = { status };
    if (status === 'banned') {
      data.bannedAt = this.clock.ts();
      data.banReason = reason ?? null;
    }
    if (status === 'active') {
      data.bannedAt = null;
      data.banReason = null;
    }
    const updated = await this.prisma.tgAccount.update({ where: { id }, data });
    if (
      status === 'active' &&
      updated.sessionEncrypted &&
      !this.telegram.isOnline(id)
    ) {
      await this.telegram.connect(id).catch(() => undefined);
    }
    if (status !== 'active') await this.telegram.disconnect(id);
    return this.summary(await this.get(id));
  }

  /**
   * Removes the account. Chats are NOT deleted: their owner is cleared, the
   * transcript stays. An ownerless chat is invisible to managers, and the
   * owner can be written back later.
   */
  async remove(id: number) {
    await this.get(id);
    await this.telegram.disconnect(id);
    const orphaned = await this.prisma.contact.updateMany({
      where: { accountId: id },
      data: { accountId: null },
    });
    await this.prisma.tgAccount.delete({ where: { id } });
    return { deleted: true, orphaned_chats: orphaned.count };
  }

  /** Top-bar snapshot: accounts with a heartbeat dot and a few live counters. */
  async liveState() {
    const now = this.clock.ts();
    const accounts = await this.prisma.tgAccount.findMany({
      orderBy: { id: 'asc' },
    });
    const since6h = now - 6 * 3600;
    const active = await this.prisma.$queryRaw<{ n: bigint | number }[]>`
      SELECT COUNT(DISTINCT chat_id) AS n FROM messages WHERE ts >= ${since6h}`;
    const pending = await this.history.pendingReplyChats();
    return {
      engine: {
        backend_type: 'anthropic',
        model_name: appConfig.generatorModel,
      },
      tg_accounts: accounts.map((a) => ({
        id: a.id,
        phone_e164: a.phoneE164,
        persona_id: a.personaId,
        status: a.status,
        last_heartbeat_at: a.lastHeartbeatAt,
        alive:
          this.telegram.isOnline(a.id) ||
          (a.lastHeartbeatAt !== null &&
            now - a.lastHeartbeatAt <= HEARTBEAT_ALIVE_S),
        purpose: a.purpose,
      })),
      active_conversations: Number(active[0]?.n ?? 0),
      pending_replies: pending.length,
      online_accounts: this.telegram.onlineIds().length,
      ts: now,
    };
  }
}
