import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { rmSync } from 'fs';
import { appConfig } from 'src/config/app.config';
import { join } from 'path';
import { HistoryService } from 'src/shared/history.service';
import { TelegramService } from 'src/modules/telegram/telegram.service';
import { profileErrorText } from 'src/domain/tg-profile';
import { UPLOADS_DIR } from '../media/uploads.service';
import { PhoneNumber, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import {
  LEAD_STATUSES,
  LeadDraft,
  leadKey,
  normalizeUsername,
  parseLeadContact,
  parseLeadLines,
} from 'src/domain/leads';
import { fromChatId } from 'src/utils/ids';
import { CreateLeadDto, ImportLeadsDto, UpdateLeadDto } from './dto/lead.dto';
import {
  ManagerAttributionService,
  ManagerAttribution,
  ManagerDirectory,
  UNASSIGNED_MANAGER,
} from 'src/shared/manager-attribution.service';

export interface LeadView extends ManagerAttribution {
  id: number;
  phone_e164: string | null;
  username: string | null;
  first_name: string | null;
  city: string | null;
  age: number | null;
  site: string | null;
  gender: string | null;
  source_type: string;
  status: string;
  telegram_user_id: number | null;
  telegram_username: string | null;
  assigned_account_id: number | null;
  preferred_account_id: number | null;
  preferred_account_username: string | null;
  assigned_account_username: string | null;
  avoid_account_id: number | null;
  persona_id: string | null;
  persona_name: string | null;
  assigned_at: number | null;
  first_contact_at: number | null;
  attempts: number;
  next_attempt_at: number | null;
  last_error: string | null;
  notes: string | null;
  inserted_at: number;
}

export interface ImportResult {
  created: number;
  duplicates: number;
  errors: string[];
}

export interface TelegramCleanup {
  deleted_in: number[];
  failed: Array<{ account_id: number | null; error: string }>;
}

export interface LeadScope {
  userId: number;
  accounts: number[];
}

/**
 * Поиск по лидам: без учёта регистра, по телефону, нику, имени, городу,
 * заметке и по id чата в Telegram, если ввели число.
 */
export function leadSearchClauses(raw: string): Prisma.PhoneNumberWhereInput[] {
  const q = raw.trim();
  const ci = (field: keyof Prisma.PhoneNumberWhereInput, value: string) =>
    ({
      [field]: { contains: value, mode: 'insensitive' },
    }) as Prisma.PhoneNumberWhereInput;
  const out: Prisma.PhoneNumberWhereInput[] = [
    ci('phoneE164', q.replace(/[\s()-]/g, '')),
    ci('usernameKey', q.replace(/^@/, '')),
    ci('telegramUsername', q.replace(/^@/, '')),
    ci('firstName', q),
    ci('city', q),
    ci('notes', q),
  ];
  if (/^\d{5,}$/.test(q)) out.push({ telegramUserId: BigInt(q) });
  return out;
}

@Injectable()
export class LeadsService {
  private readonly log = new Logger(LeadsService.name);

  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private history: HistoryService,
    private telegram: TelegramService,
    private attribution: ManagerAttributionService,
  ) {}

  private scopeWhere(scope: LeadScope | null): Prisma.PhoneNumberWhereInput {
    if (scope === null) return {};
    return {
      OR: [
        { ownerUserId: scope.userId },
        ...(scope.accounts.length
          ? [{ assignedAccountId: { in: scope.accounts } }]
          : []),
      ],
    };
  }

  private async accountNames(): Promise<Map<number, string | null>> {
    const rows = await this.prisma.tgAccount.findMany({
      select: { id: true, username: true },
    });
    return new Map(rows.map((a) => [a.id, a.username]));
  }

  private async personaNames(): Promise<Map<string, string>> {
    const rows = await this.prisma.persona.findMany({
      select: { slug: true, name: true },
    });
    return new Map(rows.map((p) => [p.slug, p.name]));
  }

  private async personaOf(
    value: string | null | undefined,
  ): Promise<string | null> {
    const slug = String(value ?? '').trim();
    if (!slug) return null;
    const persona = await this.prisma.persona.findUnique({
      where: { slug },
      select: { enabled: true },
    });
    if (!persona)
      throw new UnprocessableEntityException(`личности «${slug}» нет`);
    if (!persona.enabled)
      throw new UnprocessableEntityException(
        `личность «${slug}» выключена — ею никто не пишет`,
      );
    return slug;
  }

  private async senderOf(dto: CreateLeadDto, scope: LeadScope | null) {
    const personaId = await this.personaOf(dto.persona_id);
    const preferredAccountId = dto.preferred_account_id ?? null;
    if (preferredAccountId === null) return { personaId, preferredAccountId };
    if (scope !== null && !scope.accounts.includes(preferredAccountId)) {
      throw new UnprocessableEntityException(
        'можно выбрать только свой Telegram-аккаунт',
      );
    }
    const account = await this.prisma.tgAccount.findUnique({
      where: { id: preferredAccountId },
      select: { status: true, personaId: true },
    });
    if (!account || account.status !== 'active') {
      throw new UnprocessableEntityException(
        'выбранный Telegram-аккаунт недоступен — включите его или выберите другой',
      );
    }
    const accountPersona = await this.personaOf(account.personaId);
    if (personaId && personaId !== accountPersona) {
      throw new UnprocessableEntityException(
        'выбранный аккаунт относится к другой личности',
      );
    }
    return { personaId: personaId ?? accountPersona, preferredAccountId };
  }

  toView(
    row: PhoneNumber,
    names: Map<number, string | null> = new Map(),
    personas: Map<string, string> = new Map(),
    managers?: ManagerDirectory,
  ): LeadView {
    return {
      ...(managers?.forLead(
        row.assignedAccountId ?? row.preferredAccountId,
        row.ownerUserId,
      ) ?? UNASSIGNED_MANAGER),
      id: row.id,
      phone_e164: row.phoneE164,
      username: row.usernameKey,
      first_name: row.firstName,
      city: row.city,
      age: row.age,
      site: row.site,
      gender: row.gender,
      source_type: row.sourceType,
      status: row.status,
      telegram_user_id: fromChatId(row.telegramUserId),
      telegram_username: row.telegramUsername,
      assigned_account_id: row.assignedAccountId,
      preferred_account_id: row.preferredAccountId,
      preferred_account_username:
        row.preferredAccountId === null
          ? null
          : (names.get(row.preferredAccountId) ?? null),
      assigned_account_username:
        row.assignedAccountId === null
          ? null
          : (names.get(row.assignedAccountId) ?? null),
      avoid_account_id: row.avoidAccountId,
      persona_id: row.personaId,
      persona_name: row.personaId
        ? (personas.get(row.personaId) ?? row.personaId)
        : null,
      assigned_at: row.assignedAt,
      first_contact_at: row.firstContactAt,
      attempts: row.attempts,
      next_attempt_at: row.nextAttemptAt,
      last_error: row.lastError,
      notes: row.notes,
      inserted_at: row.insertedAt,
    };
  }

  async list(
    scope: LeadScope | null,
    filter: { status?: string; q?: string; limit?: number },
  ) {
    return this.listLeads(scope, filter);
  }

  private async listLeads(
    scope: LeadScope | null,
    filter: { status?: string; q?: string; limit?: number },
  ) {
    await this.markReplied();
    const q = filter.q?.trim();
    const where: Prisma.PhoneNumberWhereInput = {
      AND: [
        this.scopeWhere(scope),
        filter.status ? { status: filter.status } : {},
        q ? { OR: leadSearchClauses(q) } : {},
      ],
    };
    const rows = await this.prisma.phoneNumber.findMany({
      where,
      orderBy: { id: 'desc' },
      take: filter.limit ?? 200,
    });
    const [names, personas, managers] = await Promise.all([
      this.accountNames(),
      this.personaNames(),
      this.attribution.directory(),
    ]);
    return {
      items: rows.map((r) => this.toView(r, names, personas, managers)),
      counts: await this.counts(scope),
    };
  }

  async counts(scope: LeadScope | null): Promise<Record<string, number>> {
    const grouped = await this.prisma.phoneNumber.groupBy({
      by: ['status'],
      where: this.scopeWhere(scope),
      _count: { _all: true },
    });
    const out: Record<string, number> = Object.fromEntries(
      LEAD_STATUSES.map((s) => [s, 0]),
    );
    for (const g of grouped) out[g.status] = g._count._all;
    out['total'] = Object.values(out).reduce((a, b) => a + b, 0);
    return out;
  }

  private async markReplied(): Promise<void> {
    const contacted = await this.prisma.phoneNumber.findMany({
      where: { status: 'contacted', telegramUserId: { not: null } },
      select: { id: true, telegramUserId: true },
    });
    if (!contacted.length) return;
    const replied = await this.prisma.message.findMany({
      where: {
        role: 'user',
        chatId: { in: contacted.map((c) => c.telegramUserId) },
      },
      distinct: ['chatId'],
      select: { chatId: true },
    });
    const ids = new Set(replied.map((r) => String(r.chatId)));
    const hit = contacted
      .filter((c) => ids.has(String(c.telegramUserId)))
      .map((c) => c.id);
    if (hit.length)
      await this.prisma.phoneNumber.updateMany({
        where: { id: { in: hit } },
        data: { status: 'replied' },
      });
  }

  async get(scope: LeadScope | null, id: number): Promise<PhoneNumber> {
    const row = await this.prisma.phoneNumber.findFirst({
      where: { AND: [{ id }, this.scopeWhere(scope)] },
    });
    if (!row) throw new NotFoundException('лид не найден');
    return row;
  }

  private contactOf(dto: {
    phone?: string;
    username?: string;
  }): Pick<LeadDraft, 'phone_e164' | 'username'> {
    if (dto.username) {
      const username = normalizeUsername(dto.username);
      if (!username)
        throw new UnprocessableEntityException(
          `не похоже на @username: «${dto.username}»`,
        );
      return { username, phone_e164: null };
    }
    if (!dto.phone)
      throw new UnprocessableEntityException('нужен телефон или @username');
    const contact = parseLeadContact(dto.phone);
    if (!contact)
      throw new UnprocessableEntityException(
        `не похоже на телефон или @username: «${dto.phone}»`,
      );
    return contact;
  }

  async create(
    dto: CreateLeadDto,
    ownerUserId: number | null = null,
    scope: LeadScope | null = null,
  ): Promise<LeadView> {
    const contact = this.contactOf(dto);
    const sender = await this.senderOf(dto, scope);
    const existing = contact.phone_e164
      ? await this.prisma.phoneNumber.findUnique({
          where: { phoneE164: contact.phone_e164 },
        })
      : await this.prisma.phoneNumber.findUnique({
          where: { usernameKey: contact.username },
        });
    if (existing) {
      const foreign =
        scope !== null &&
        existing.ownerUserId !== scope.userId &&
        !(
          existing.assignedAccountId !== null &&
          scope.accounts.includes(existing.assignedAccountId)
        );
      throw new UnprocessableEntityException(
        foreign
          ? `${leadKey(contact)} уже в базе у другого пользователя`
          : `${leadKey(contact)} уже в базе (лид #${existing.id}, ${existing.status})`,
      );
    }
    const row = await this.prisma.phoneNumber.create({
      data: {
        phoneE164: contact.phone_e164 ?? null,
        usernameKey: contact.username ?? null,
        firstName: dto.first_name?.trim() || null,
        city: dto.city?.trim() || null,
        age: dto.age ?? null,
        site: dto.site?.trim() || null,
        ...sender,
        gender: dto.gender ?? null,
        sourceType: dto.source_type?.trim() || 'manual',
        notes: dto.notes?.trim() || null,
        ownerUserId,
        insertedAt: this.clock.ts(),
      },
    });
    return this.toView(
      row,
      await this.accountNames(),
      await this.personaNames(),
      await this.attribution.directory(),
    );
  }

  async import(
    dto: ImportLeadsDto,
    ownerUserId: number | null = null,
    scope: LeadScope | null = null,
  ): Promise<ImportResult> {
    const batchPersona = await this.personaOf(dto.persona_id);
    const drafts: Array<LeadDraft & { preferred_account_id?: number | null }> =
      [];
    const errors: string[] = [];
    let duplicates = 0;
    if (dto.text) {
      const parsed = parseLeadLines(dto.text);
      drafts.push(...parsed.items);
      errors.push(...parsed.errors);
      duplicates += parsed.duplicates;
    }
    for (const item of dto.items ?? []) {
      let contact: Pick<LeadDraft, 'phone_e164' | 'username'>;
      try {
        contact = this.contactOf(item);
      } catch (e) {
        errors.push(String(e?.message ?? e));
        continue;
      }
      const sender = await this.senderOf(
        { ...item, persona_id: item.persona_id || batchPersona },
        scope,
      );
      drafts.push({
        ...contact,
        first_name: item.first_name ?? null,
        city: item.city ?? null,
        age: item.age ?? null,
        site: item.site ?? null,
        persona_id: sender.personaId,
        preferred_account_id: sender.preferredAccountId,
      });
    }
    if (!drafts.length && !errors.length)
      throw new BadRequestException('пустой импорт: нужен text или items');

    const wanted = [...new Map(drafts.map((d) => [leadKey(d), d])).values()];
    const known = new Set<string>();
    for (let i = 0; i < wanted.length; i += 500) {
      const chunk = wanted.slice(i, i + 500);
      const phones = chunk.map((d) => d.phone_e164).filter(Boolean);
      const names = chunk.map((d) => d.username).filter(Boolean);
      const rows = await this.prisma.phoneNumber.findMany({
        where: {
          OR: [{ phoneE164: { in: phones } }, { usernameKey: { in: names } }],
        },
        select: { phoneE164: true, usernameKey: true },
      });
      rows.forEach((r) =>
        known.add(
          leadKey({ phone_e164: r.phoneE164, username: r.usernameKey }),
        ),
      );
    }
    const fresh = wanted.filter((d) => !known.has(leadKey(d)));
    const now = this.clock.ts();
    if (fresh.length) {
      await this.prisma.phoneNumber.createMany({
        data: fresh.map((d) => ({
          phoneE164: d.phone_e164 ?? null,
          usernameKey: d.username ?? null,
          firstName: d.first_name?.trim() || null,
          city: d.city?.trim() || null,
          age: d.age ?? null,
          site: d.site?.trim() || null,
          personaId: d.persona_id || batchPersona,
          preferredAccountId: d.preferred_account_id ?? null,
          sourceType: dto.source_type?.trim() || 'import',
          status: dto.queue ? 'queued' : 'pending',
          ownerUserId,
          insertedAt: now,
        })),
      });
    }
    duplicates +=
      wanted.length - fresh.length + (drafts.length - wanted.length);
    return { created: fresh.length, duplicates, errors };
  }

  async update(
    scope: LeadScope | null,
    id: number,
    dto: UpdateLeadDto,
  ): Promise<LeadView> {
    await this.get(scope, id);
    const data: Prisma.PhoneNumberUpdateInput = {};
    if (dto.first_name !== undefined)
      data.firstName = dto.first_name?.trim() || null;
    if (dto.city !== undefined) data.city = dto.city?.trim() || null;
    if (dto.age !== undefined) data.age = dto.age;
    if (dto.site !== undefined) data.site = dto.site?.trim() || null;
    if (dto.persona_id !== undefined) {
      const row = await this.get(scope, id);
      if (row.firstContactAt)
        throw new UnprocessableEntityException(
          'лиду уже написали — личность ведёт диалог, сменить её нельзя',
        );
      data.personaId = await this.personaOf(dto.persona_id);
      if (row.preferredAccountId !== null && data.personaId) {
        const chosen = await this.prisma.tgAccount.findUnique({
          where: { id: row.preferredAccountId },
          select: { personaId: true },
        });
        if (chosen?.personaId !== data.personaId) {
          throw new UnprocessableEntityException(
            'у лида выбран аккаунт другой личности — сначала нажмите «Написать с другого»',
          );
        }
      }
      if (row.assignedAccountId !== null && row.status !== 'contacted') {
        const acc = await this.prisma.tgAccount.findUnique({
          where: { id: row.assignedAccountId },
          select: { personaId: true },
        });
        if (data.personaId && acc?.personaId !== data.personaId) {
          data.assignedAccountId = null;
        }
      }
    }
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    const row = await this.prisma.phoneNumber.update({ where: { id }, data });
    const [names, personas, managers] = await Promise.all([
      this.accountNames(),
      this.personaNames(),
      this.attribution.directory(),
    ]);
    return this.toView(row, names, personas, managers);
  }

  async remove(
    scope: LeadScope | null,
    id: number,
    opts: { deleteTelegram?: boolean } = {},
  ): Promise<{
    wiped_chat: number | null;
    messages: number;
    telegram: TelegramCleanup | null;
  }> {
    const row = await this.get(scope, id);

    let chatId =
      row.telegramUserId === null ? null : Number(row.telegramUserId);
    if (chatId === null) {
      const marked = await this.prisma.leadFacts.findFirst({
        where: {
          OR: [
            { facts: { contains: `"_outreach_lead_id":${id},` } },
            { facts: { contains: `"_outreach_lead_id":${id}}` } },
          ],
        },
        select: { chatId: true },
      });
      chatId = marked ? Number(marked.chatId) : null;
    }
    const shared =
      chatId === null
        ? 0
        : await this.prisma.phoneNumber.count({
            where: { telegramUserId: BigInt(chatId), id: { not: id } },
          });

    let telegram: TelegramCleanup | null = null;
    if (opts.deleteTelegram && chatId !== null && !shared) {
      telegram = { deleted_in: [], failed: [] };
      const owner = await this.history.chatOwnerAccount(chatId);
      const accountIds = [
        ...new Set(
          [owner, row.assignedAccountId].filter((a): a is number => a !== null),
        ),
      ];
      if (!accountIds.length)
        telegram.failed.push({
          account_id: null,
          error: 'у чата нет аккаунта — удалять не из чего',
        });
      for (const accountId of accountIds) {
        try {
          await this.telegram.deleteDialogForEveryone(accountId, chatId, {
            username: row.telegramUsername ?? row.usernameKey,
          });
          telegram.deleted_in.push(accountId);
        } catch (e) {
          telegram.failed.push({
            account_id: accountId,
            error: profileErrorText(e),
          });
          this.log.warn(
            `lead #${id}: telegram chat ${chatId} not deleted in account ${accountId}: ${(e as Error)?.message ?? e}`,
          );
        }
      }
    }

    await this.prisma.phoneNumber.delete({ where: { id } });
    if (chatId === null || shared)
      return { wiped_chat: null, messages: 0, telegram };

    const wiped = await this.wipeChatWithFiles(chatId);
    this.log.log(
      `lead #${id} deleted with chat ${chatId}: ${wiped.messages} message(s) wiped${telegram ? `, telegram: ${telegram.deleted_in.length} ok / ${telegram.failed.length} failed` : ''}`,
    );
    return { wiped_chat: chatId, messages: wiped.messages, telegram };
  }

  async wipeChatWithFiles(chatId: number): Promise<{ messages: number }> {
    const wiped = await this.history.wipeChat(chatId);
    for (const path of [
      ...wiped.files,
      join(UPLOADS_DIR, String(chatId)),
      join(appConfig.mediaDir, 'avatars', `${chatId}.jpg`),
    ]) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch (e) {
        this.log.warn(
          `chat ${chatId}: could not remove ${path}: ${e?.message ?? e}`,
        );
      }
    }
    return { messages: wiped.messages };
  }

  async isLeftoverOfDeletedLead(
    chatId: number,
    currentLeadId: number,
  ): Promise<boolean> {
    const id = BigInt(chatId);
    if (!(await this.prisma.message.count({ where: { chatId: id } })))
      return false;
    const factsRow = await this.prisma.leadFacts.findUnique({
      where: { chatId: id },
      select: { facts: true },
    });
    let previous: unknown;
    try {
      previous = factsRow
        ? JSON.parse(factsRow.facts)['_outreach_lead_id']
        : undefined;
    } catch {
      previous = undefined;
    }
    if (typeof previous !== 'number' || previous === currentLeadId)
      return false;
    if (await this.prisma.phoneNumber.count({ where: { id: previous } }))
      return false;
    const others = await this.prisma.phoneNumber.count({
      where: { telegramUserId: id, id: { not: currentLeadId } },
    });
    return others === 0;
  }

  async queue(
    scope: LeadScope | null,
    ids?: number[],
  ): Promise<{ queued: number }> {
    const where: Prisma.PhoneNumberWhereInput = {
      AND: [
        this.scopeWhere(scope),
        ids?.length
          ? { id: { in: ids }, status: { in: ['pending', 'dead'] } }
          : { status: 'pending' },
      ],
    };
    const r = await this.prisma.phoneNumber.updateMany({
      where,
      data: {
        status: 'queued',
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
      },
    });
    return { queued: r.count };
  }

  async writeFromAnother(
    scope: LeadScope | null,
    id: number,
  ): Promise<LeadView> {
    const row = await this.get(scope, id);
    if (row.firstContactAt) {
      throw new UnprocessableEntityException(
        'этому лиду уже написали — второе первое сообщение с другого аккаунта будет спамом',
      );
    }
    const updated = await this.prisma.phoneNumber.update({
      where: { id },
      data: {
        status: 'queued',
        avoidAccountId:
          row.assignedAccountId ?? row.preferredAccountId ?? row.avoidAccountId,
        assignedAccountId: null,
        preferredAccountId: null,
        assignedAt: null,
        nextAttemptAt: null,
        attempts: 0,
        lastError: null,
      },
    });
    return this.toView(
      updated,
      await this.accountNames(),
      await this.personaNames(),
      await this.attribution.directory(),
    );
  }

  async unqueue(
    scope: LeadScope | null,
    ids?: number[],
  ): Promise<{ unqueued: number }> {
    const where: Prisma.PhoneNumberWhereInput = {
      AND: [
        this.scopeWhere(scope),
        { status: 'queued' },
        ids?.length ? { id: { in: ids } } : {},
      ],
    };
    const r = await this.prisma.phoneNumber.updateMany({
      where,
      data: { status: 'pending', assignedAccountId: null },
    });
    return { unqueued: r.count };
  }
}
