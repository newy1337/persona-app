import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DashboardUser, PhoneNumber } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { Role } from 'src/enums/roles.enum';
import { BUFFER_STATUS } from 'src/domain/leads';

/** Буфер виден хеду и тимлидам региона лида, админу — весь. */
const BUFFER_ROLES: string[] = [Role.HEAD, Role.TEAMLEAD];

export interface BufferItem {
  id: number;
  username: string | null;
  first_name: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  region_code: string | null;
  person: string | null;
  persona_id: string | null;
  source: string;
  donor: string | null;
  account: string | null;
  external_id: string | null;
  profile_url: string | null;
  last_messages: string | null;
  reassigned: boolean;
  buffered_at: number | null;
  /** этого собеседника уже отклоняли: сколько раз и последний раз */
  declined_before: {
    count: number;
    last_at: number;
    last_reason: string | null;
  } | null;
}

@Injectable()
export class BufferService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  /** Регион, буфер которого видит пользователь; null — все (админ). */
  private regionOf(user: DashboardUser): string | null {
    if (user.role === Role.ADMIN) return null;
    if (!BUFFER_ROLES.includes(user.role) || !user.regionCode)
      throw new ForbiddenException('буфер доступен хеду и тимлидам региона');
    return user.regionCode;
  }

  private where(user: DashboardUser, region?: string | null) {
    const own = this.regionOf(user);
    const target = own ?? (region?.trim() || null);
    return {
      status: BUFFER_STATUS,
      ...(target ? { requestedRegion: target } : {}),
    };
  }

  async list(user: DashboardUser, region?: string | null) {
    const rows = await this.prisma.phoneNumber.findMany({
      where: this.where(user, region),
      orderBy: { id: 'asc' },
    });
    const usernames = rows
      .map((r) => r.usernameKey)
      .filter((x): x is string => Boolean(x));
    const declined = usernames.length
      ? await this.prisma.declinedLead.findMany({
          where: { usernameKey: { in: usernames } },
          orderBy: { declinedAt: 'desc' },
          select: { usernameKey: true, declinedAt: true, reason: true },
        })
      : [];
    const history = new Map<
      string,
      { count: number; last_at: number; last_reason: string | null }
    >();
    for (const d of declined) {
      const key = d.usernameKey!;
      const was = history.get(key);
      if (was) was.count += 1;
      else
        history.set(key, {
          count: 1,
          last_at: d.declinedAt,
          last_reason: d.reason,
        });
    }
    return {
      items: rows.map((r) => this.view(r, history)),
      total: rows.length,
    };
  }

  private view(
    r: PhoneNumber,
    history: Map<
      string,
      { count: number; last_at: number; last_reason: string | null }
    >,
  ): BufferItem {
    return {
      id: r.id,
      username: r.usernameKey,
      first_name: r.firstName,
      age: r.age,
      gender: r.gender,
      city: r.city,
      region_code: r.requestedRegion,
      person: r.requestedPersona,
      persona_id: r.personaId,
      source: r.sourceType,
      donor: r.donor,
      account: r.accountLabel,
      external_id: r.externalId,
      profile_url: r.profileUrl,
      last_messages: r.lastMessages,
      reassigned: r.reassigned,
      buffered_at: r.bufferedAt,
      declined_before: r.usernameKey
        ? (history.get(r.usernameKey) ?? null)
        : null,
    };
  }

  private async requireBuffered(user: DashboardUser, id: number) {
    const lead = await this.prisma.phoneNumber.findFirst({
      where: { id, ...this.where(user) },
    });
    if (!lead) throw new NotFoundException('лида нет в буфере');
    return lead;
  }

  /**
   * Взять в работу: лид уходит из буфера в «Лиды» нажавшего. Писать ему будут
   * аккаунты его команды, как любому лиду руководителя.
   */
  async take(user: DashboardUser, id: number) {
    await this.requireBuffered(user, id);
    const moved = await this.prisma.phoneNumber.updateMany({
      where: { id, status: BUFFER_STATUS },
      data: { status: 'pending', ownerUserId: user.id },
    });
    if (!moved.count) throw new NotFoundException('лида нет в буфере');
    return this.list(user);
  }

  /** Отклонить: лид удаляется, а слепок его данных остаётся в архиве отклонённых. */
  async decline(user: DashboardUser, id: number, reason?: string | null) {
    const lead = await this.requireBuffered(user, id);
    const snapshot = JSON.stringify(lead, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    await this.prisma.$transaction([
      this.prisma.declinedLead.create({
        data: {
          phoneE164: lead.phoneE164,
          usernameKey: lead.usernameKey,
          regionCode: lead.requestedRegion,
          snapshot,
          reason: reason?.trim() || null,
          declinedAt: this.clock.ts(),
          declinedById: user.id,
        },
      }),
      this.prisma.phoneNumber.deleteMany({
        where: { id, status: BUFFER_STATUS },
      }),
    ]);
    return this.list(user);
  }
}
