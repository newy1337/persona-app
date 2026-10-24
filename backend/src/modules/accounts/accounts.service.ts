import {
  BadRequestException,
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
} from 'src/channels/telegram/profile';
import { ChannelAccount } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { CryptoService } from 'src/shared/crypto.service';
import { HistoryService } from 'src/shared/history.service';
import { appConfig } from 'src/config/app.config';
import { TelegramService } from '../../channels/telegram/telegram.service';
import {
  AddTelegramAccountDto,
  AddVkAccountDto,
  ProxyConfigDto,
  UpdateAccountDto,
  UpdateTelegramProfileDto,
} from './dto/account.dto';
import { proxyLabel, proxyTypeError } from 'src/domain/proxy';
import { ChannelRegistry } from 'src/channels/registry';
import {
  hasSession,
  pickCookies,
  type VkSessionData,
} from 'src/channels/vk/session';

const HEARTBEAT_ALIVE_S = 120;

export interface AccountSummary {
  id: number;
  photo_set_id: number | null;
  photo_set_name: string | null;
  photo_auto_send: boolean;
  /** Номер; у VK-аккаунта без номера — логин, чтобы панели было что показать. */
  phone_e164: string;
  channel: string;
  login: string;
  persona_id: string;
  status: string;
  needs_proxy_setup: boolean;
  proxy_geo: string | null;
  proxy_label: string | null;
  flood_until: number | null;
  chats: number;
  persona_name: string | null;
  flood_reason: string | null;
  last_login_at: number | null;
  last_heartbeat_at: number | null;
  routing_weight: number;
  daily_msg_quota: number | null;
  purpose: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  lost_at: number | null;
  lost_reason: string | null;
  online: boolean;
  has_session: boolean;
  /** Почему не в сети; null — в сети. */
  offline_reason?: string | null;
}

@Injectable()
export class AccountsService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private crypto: CryptoService,
    private history: HistoryService,
    private telegram: TelegramService,
    private channels: ChannelRegistry,
    private presence: PresenceService,
  ) {}

  summary(
    a: ChannelAccount,
    extra: {
      chats?: number;
      personaName?: string | null;
      photoSetId?: number | null;
      photoSetName?: string | null;
    } = {},
  ): AccountSummary {
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
      phone_e164: a.phoneE164 ?? a.login,
      channel: a.channel,
      login: a.login,
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
      photo_set_id: extra.photoSetId ?? null,
      photo_set_name: extra.photoSetName ?? null,
      photo_auto_send: a.photoAutoSend,
      avatar_url: this.presence.accountAvatarUrl(a.id),
      lost_at:
        a.status === 'banned' || a.status === 'unauthorized'
          ? a.bannedAt
          : null,
      lost_reason:
        a.status === 'banned' || a.status === 'unauthorized'
          ? a.banReason
          : null,
      online: this.channels.isOnline(a.id),
      offline_reason: this.channels.offlineReason(a.id, a.channel),
      has_session: Boolean(a.sessionEncrypted),
    };
  }

  async list(
    filter: { status?: string; persona_id?: string; purpose?: string } = {},
  ) {
    const rows = await this.prisma.channelAccount.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.persona_id ? { personaId: filter.persona_id } : {}),
        ...(filter.purpose ? { purpose: filter.purpose } : {}),
      },
      orderBy: { id: 'asc' },
    });
    const [chats, personas, sets, links, regional] = await Promise.all([
      this.prisma.contact.groupBy({
        by: ['accountId'],
        _count: { _all: true },
      }),
      this.prisma.persona.findMany({ select: { slug: true, name: true } }),
      this.prisma.photoSet.findMany({ select: { id: true, name: true } }),
      this.prisma.managerAccount.findMany({
        where: { accountId: { in: rows.map((a) => a.id) } },
        select: { accountId: true, userId: true },
      }),
      this.prisma.managerPhotoSet.findMany(),
    ]);
    const setNames = new Map(sets.map((s) => [s.id, s.name]));
    const managerOf = new Map(links.map((l) => [l.accountId, l.userId]));
    const assigned = new Map(
      regional
        .filter((r) => r.personaSlug)
        .map((r) => [`${r.userId}:${r.personaSlug}`, r.setId]),
    );
    // Образ для новых диалогов — тот образ менеджера аккаунта, который он
    // привязал к личности этого аккаунта.
    const currentSet = (a: (typeof rows)[number]) =>
      assigned.get(`${managerOf.get(a.id)}:${a.personaId}`) ?? null;
    const chatsBy = new Map(chats.map((c) => [c.accountId, c._count._all]));
    const names = new Map(personas.map((p) => [p.slug, p.name]));
    return rows.map((a) =>
      this.summary(a, {
        chats: chatsBy.get(a.id) ?? 0,
        personaName: names.get(a.personaId) ?? null,
        photoSetId: currentSet(a),
        photoSetName: currentSet(a)
          ? (setNames.get(currentSet(a)!) ?? null)
          : null,
      }),
    );
  }

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

  async updateProfile(id: number, dto: UpdateTelegramProfileDto) {
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

  async update(id: number, dto: UpdateAccountDto) {
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
      ? await this.prisma.channelAccount.update({ where: { id }, data })
      : before;

    if (data.personaId) {
      const released = await this.prisma.lead.updateMany({
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

  async get(id: number): Promise<ChannelAccount> {
    const a = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!a) throw new NotFoundException(`tg_account id=${id} not found`);
    return a;
  }

  async add(dto: AddTelegramAccountDto, ownerUserId: number | null = null) {
    const phone = dto.phone_e164.startsWith('+')
      ? dto.phone_e164
      : `+${dto.phone_e164}`;
    if (dto.persona_id) await this.assertPersona(dto.persona_id);
    const wrong = dto.proxy_config
      ? proxyTypeError('telegram', dto.proxy_config.type)
      : null;
    if (wrong) throw new BadRequestException(wrong);
    try {
      const created = await this.prisma.channelAccount.create({
        data: {
          phoneE164: phone,
          login: phone,
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
          data: { userId: ownerUserId, accountId: created.id },
        });
      return this.summary(created);
    } catch (e) {
      if (String(e?.code) === 'P2002')
        throw new ConflictException(`phone ${phone} already exists`);
      throw e;
    }
  }

  /** VK-аккаунт по кукам браузера: сразу активен и подключается. */
  async addVk(dto: AddVkAccountDto, ownerUserId: number | null = null) {
    if (dto.persona_id) await this.assertPersona(dto.persona_id);
    const wrong = proxyTypeError('vk', dto.proxy_config.type);
    if (wrong) throw new BadRequestException(wrong);
    const cookies = pickCookies(dto.cookies ?? []);
    if (!hasSession(cookies))
      throw new BadRequestException(
        'в куках нет сессии VK (remixsid) — выгрузите куки vk.ru после входа',
      );
    const login = dto.login.trim();
    const phone = /^\+?\d{10,15}$/.test(login)
      ? `+${login.replace(/^\+/, '')}`
      : null;
    const session: VkSessionData = {
      cookies,
      userAgent: dto.user_agent?.trim() || null,
      savedAt: this.clock.ts(),
    };
    let created: ChannelAccount;
    try {
      created = await this.prisma.channelAccount.create({
        data: {
          channel: 'vk',
          login,
          phoneE164: phone,
          personaId: dto.persona_id || appConfig.personaId,
          status: 'active',
          addedAt: this.clock.ts(),
          purpose: dto.purpose ?? 'prod',
          sessionEncrypted: this.crypto.encrypt(JSON.stringify(session)),
          proxyConfigEncrypted: this.crypto.encrypt(
            JSON.stringify({
              type: dto.proxy_config.type,
              host: dto.proxy_config.host.trim(),
              port: dto.proxy_config.port,
              username: dto.proxy_config.username?.trim() || null,
              password: dto.proxy_config.password || null,
              secret: null,
            }),
          ),
          needsProxySetup: 0,
          dailyMsgQuota: dto.daily_msg_quota ?? null,
        },
      });
    } catch (e) {
      if (String(e?.code) === 'P2002')
        throw new ConflictException(`VK-аккаунт ${login} уже есть`);
      throw e;
    }
    if (ownerUserId !== null)
      await this.prisma.managerAccount.create({
        data: { userId: ownerUserId, accountId: created.id },
      });
    let connectError: string | null = null;
    try {
      await (await this.channels.forAccount(created.id)).connect(created.id);
    } catch (e) {
      connectError = e?.message ?? String(e);
    }
    return {
      ...this.summary(await this.get(created.id)),
      connect_error: connectError,
    };
  }

  async setProxy(id: number, proxy: ProxyConfigDto) {
    const account = await this.get(id);
    const wrong = proxyTypeError(account.channel, proxy.type);
    if (wrong) throw new BadRequestException(wrong);
    const clean = {
      type: proxy.type,
      host: proxy.host.trim(),
      port: proxy.port,
      username: proxy.username?.trim() || null,
      password: proxy.password || null,
      secret: proxy.type === 'mtproto' ? proxy.secret?.trim() || null : null,
    };
    const updated = await this.prisma.channelAccount.update({
      where: { id },
      data: {
        proxyConfigEncrypted: this.crypto.encrypt(JSON.stringify(clean)),
        needsProxySetup: 0,
      },
    });
    let reconnectError: string | null = null;
    if (this.channels.isOnline(id) && updated.status === 'active') {
      try {
        await (await this.channels.forAccount(id)).reconnect(id);
      } catch (e) {
        reconnectError = String(e?.message ?? e);
      }
    }
    return {
      ...this.summary(updated),
      online: this.channels.isOnline(id),
      reconnect_error: reconnectError,
    };
  }

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
      await (await this.channels.forAccount(id)).reconnect(id);
    } catch (e) {
      error = String(e?.message ?? e);
    }
    const updated = await this.get(id);
    return {
      ...this.summary(updated),
      online: this.channels.isOnline(id),
      reconnect_error: error,
    };
  }

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

  async clearFlood(id: number) {
    await this.get(id);
    const updated = await this.prisma.channelAccount.update({
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
    const updated = await this.prisma.channelAccount.update({
      where: { id },
      data,
    });
    if (
      status === 'active' &&
      updated.sessionEncrypted &&
      !this.channels.isOnline(id)
    ) {
      await (
        await this.channels.forAccount(id)
      )
        .connect(id)
        .catch(() => undefined);
    }
    if (status !== 'active')
      await (await this.channels.forAccount(id)).disconnect(id);
    return this.summary(await this.get(id));
  }

  async remove(id: number) {
    await this.get(id);
    await (await this.channels.forAccount(id)).disconnect(id);
    const orphaned = await this.prisma.contact.updateMany({
      where: { accountId: id },
      data: { accountId: null },
    });
    await this.prisma.channelAccount.delete({ where: { id } });
    return { deleted: true, orphaned_chats: orphaned.count };
  }

  async liveState() {
    const now = this.clock.ts();
    const accounts = await this.prisma.channelAccount.findMany({
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
          this.channels.isOnline(a.id) ||
          (a.lastHeartbeatAt !== null &&
            now - a.lastHeartbeatAt <= HEARTBEAT_ALIVE_S),
        offline_reason: this.channels.offlineReason(a.id, a.channel),
        purpose: a.purpose,
      })),
      active_conversations: Number(active[0]?.n ?? 0),
      pending_replies: pending.length,
      online_accounts: this.channels.onlineIds().length,
      ts: now,
    };
  }
}
