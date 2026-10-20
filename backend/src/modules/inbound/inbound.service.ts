import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { MANAGER_ROLES } from 'src/enums/roles.enum';
import {
  leadKey,
  mskDayStart,
  normalizePhone,
  normalizeUsername,
} from 'src/domain/leads';
import {
  pickRecipient,
  skipReason,
  type Recipient,
} from 'src/domain/lead-distribution';
import { InboundLeadDto } from './dto/inbound-lead.dto';

export interface InboundResult {
  id: number;
  status: string;
  assigned_to: { user_id: number; username: string };
}

@Injectable()
export class InboundService {
  private readonly log = new Logger(InboundService.name);

  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  /**
   * Кто может принять входящий лид прямо сейчас: менеджеры, тимлиды и хеды с
   * их счётчиками за сегодня. Имена нужны ответу, чтобы не читать владельца
   * отдельным запросом.
   */
  async recipients(
    now = this.clock.ts(),
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<{ list: Recipient[]; names: Map<number, string> }> {
    const users = await db.dashboardUser.findMany({
      where: { role: { in: [...MANAGER_ROLES] } },
      select: {
        id: true,
        username: true,
        regionCode: true,
        online: true,
        leadQuota: true,
        leadSources: true,
        leadPersonas: true,
        donors: { select: { donor: { select: { name: true } } } },
      },
    });
    const names = new Map(users.map((u) => [u.id, u.username]));
    if (!users.length) return { list: [], names };
    const today = await db.phoneNumber.findMany({
      where: {
        ownerUserId: { in: users.map((u) => u.id) },
        inboundAt: { gte: mskDayStart(now) },
      },
      select: { ownerUserId: true, inboundAt: true },
    });
    const stats = new Map<number, { count: number; last: number | null }>();
    for (const t of today) {
      if (t.ownerUserId === null) continue;
      const row = stats.get(t.ownerUserId) ?? { count: 0, last: null };
      row.count += 1;
      row.last = Math.max(row.last ?? 0, t.inboundAt ?? 0) || null;
      stats.set(t.ownerUserId, row);
    }
    const list = users.map((u) => ({
      id: u.id,
      region: u.regionCode,
      online: u.online,
      quota: u.leadQuota,
      sources: u.leadSources,
      personas: u.leadPersonas,
      donors: u.donors.map((d) => d.donor.name),
      todayCount: stats.get(u.id)?.count ?? 0,
      lastReceivedAt: stats.get(u.id)?.last ?? null,
    }));
    return { list, names };
  }

  /**
   * slug личности по slug или имени без учёта регистра; null — такой нет.
   * Отключённая личность — отказ: у неё нет аккаунтов в прозвоне, лид с ней
   * никогда не ушёл бы.
   */
  private async personaSlug(raw: string): Promise<string | null> {
    const row = await this.prisma.persona.findFirst({
      where: {
        OR: [
          { slug: { equals: raw, mode: 'insensitive' } },
          { name: { equals: raw, mode: 'insensitive' } },
        ],
      },
      select: { slug: true, enabled: true },
    });
    if (row && !row.enabled)
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'persona_disabled',
        message: `личность «${raw}» отключена`,
      });
    return row?.slug ?? null;
  }

  async accept(dto: InboundLeadDto): Promise<InboundResult> {
    const username = dto.username ? normalizeUsername(dto.username) : null;
    const phone = dto.phone ? normalizePhone(dto.phone) : null;
    if (dto.username && !username)
      throw new UnprocessableEntityException(
        `не похоже на @username: «${dto.username}»`,
      );
    if (dto.phone && !phone)
      throw new UnprocessableEntityException(
        `не похоже на телефон: «${dto.phone}»`,
      );
    if (!phone && !username)
      throw new BadRequestException('нужен phone или username');
    const contact = { phone_e164: phone, username };
    // Личность от поставщика узнаём по slug или имени; не узнали — сравниваем как есть.
    const person = dto.person.trim();
    const persona = await this.personaSlug(person);
    const tags = {
      source: dto.source?.trim() || null,
      donor: dto.donor.trim(),
      region: dto.region.trim(),
      persona: persona ?? person,
    };
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Раздача читает счётчики и тут же пишет лид: без общей блокировки
          // параллельные запросы видят одни и те же счётчики и обходят лимит.
          // Дубль проверяем под той же блокировкой.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('inbound_leads'))`;
          const existing = await tx.phoneNumber.findFirst({
            where: {
              OR: [
                ...(phone ? [{ phoneE164: phone }] : []),
                ...(username ? [{ usernameKey: username }] : []),
              ],
            },
          });
          if (existing)
            throw new ConflictException(
              `${leadKey(contact)} уже в базе (лид #${existing.id}, ${existing.status})`,
            );
          const now = this.clock.ts();
          const { list, names } = await this.recipients(now, tx);
          const picked = pickRecipient(list, tags);
          // Никто не подошёл — лид не берём: отправитель уведёт его в другое место.
          if (!picked) {
            const reason = skipReason(list, tags);
            this.log.log(`inbound ${leadKey(contact)} rejected: ${reason}`);
            throw new UnprocessableEntityException({
              statusCode: 422,
              error: 'no_recipient',
              message: reason,
            });
          }
          const owner = {
            id: picked.id,
            username: names.get(picked.id) ?? String(picked.id),
          };
          const row = await tx.phoneNumber.create({
            data: {
              phoneE164: phone,
              usernameKey: username,
              firstName: dto.name?.trim() || null,
              city: dto.city?.trim() || null,
              age: dto.age ?? null,
              gender: dto.gender ?? null,
              sourceType: tags.source ?? 'api',
              donor: tags.donor,
              accountLabel: dto.account?.trim() || null,
              externalId: dto.external_id?.trim() || null,
              profileUrl: dto.profile_url?.trim() || null,
              lastMessages: dto.last_messages?.trim() || null,
              requestedRegion: tags.region,
              requestedPersona: person,
              personaId: persona,
              ownerUserId: owner.id,
              inboundAt: now,
              insertedAt: now,
            },
          });
          this.log.log(
            `inbound lead #${row.id} ${leadKey(contact)} → ${owner.username}`,
          );
          return {
            id: row.id,
            status: row.status,
            assigned_to: { user_id: owner.id, username: owner.username },
          };
        },
        { maxWait: 10_000, timeout: 15_000 },
      );
    } catch (e) {
      // Тот же номер или ник успел занять другой путь (ручное добавление) —
      // уникальный индекс всё равно отдаём как дубль, не как 500.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException(`${leadKey(contact)} уже в базе`);
      throw e;
    }
  }
}
