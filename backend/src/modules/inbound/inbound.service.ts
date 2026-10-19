import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
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

  /** Кто может принять входящий лид прямо сейчас: менеджеры, тимлиды и хеды с их счётчиками за сегодня. */
  async recipients(now = this.clock.ts()): Promise<Recipient[]> {
    const users = await this.prisma.dashboardUser.findMany({
      where: { role: { in: [...MANAGER_ROLES] } },
      select: {
        id: true,
        regionCode: true,
        online: true,
        leadQuota: true,
        leadSources: true,
        leadPersonas: true,
        donors: { select: { donor: { select: { name: true } } } },
      },
    });
    if (!users.length) return [];
    const today = await this.prisma.phoneNumber.findMany({
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
    return users.map((u) => ({
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
  }

  /** slug личности по slug или имени без учёта регистра; null — такой нет. */
  private async personaSlug(raw: string): Promise<string | null> {
    const row = await this.prisma.persona.findFirst({
      where: {
        OR: [
          { slug: { equals: raw, mode: 'insensitive' } },
          { name: { equals: raw, mode: 'insensitive' } },
        ],
      },
      select: { slug: true },
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
      throw new UnprocessableEntityException('нужен phone или username');
    const contact = { phone_e164: phone, username };
    // Дубль ищем и по телефону, и по нику: оба уникальны в базе.
    const existing = await this.prisma.phoneNumber.findFirst({
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
    // Личность от поставщика узнаём по slug или имени; не узнали — сравниваем как есть.
    const person = dto.person.trim();
    const persona = await this.personaSlug(person);
    const tags = {
      source: dto.source?.trim() || null,
      donor: dto.donor?.trim() || null,
      region: dto.region.trim(),
      persona: persona ?? person,
    };
    const list = await this.recipients(now);
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
    const owner = await this.prisma.dashboardUser.findUniqueOrThrow({
      where: { id: picked.id },
      select: { id: true, username: true },
    });

    const row = await this.prisma.phoneNumber.create({
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
  }
}
