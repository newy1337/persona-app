import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DashboardUser, PhotoSet, PhotoSetPhoto } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve, sep } from 'path';
import sharp from 'sharp';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { HistoryService } from 'src/shared/history.service';
import { ScopeService } from 'src/shared/scope.service';
import { Role } from 'src/enums/roles.enum';
import { appConfig } from 'src/config/app.config';
import { toChatId } from 'src/utils/ids';
import {
  exifDate,
  formatTakenOn,
  normalizeTakenOn,
  parseTags,
} from 'src/domain/photo-library';
import { PersonaService } from 'src/brain/persona.service';
import { UsageRecorderService } from 'src/brain/usage-recorder.service';
import { suggestPhotoCard } from 'src/brain/nastya/media/library-photo';
import type { UpdatePhotoDto, UpdatePhotoSetDto } from './photo-sets.dto';

export const PHOTO_SETS_DIR = resolve(join(appConfig.dataDir, 'photo-sets'));
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 2560;
const THUMB_SIDE = 480;

export function insidePhotoStore(path: string): boolean {
  const abs = resolve(path);
  return abs.startsWith(PHOTO_SETS_DIR + sep);
}

@Injectable()
export class PhotoSetsService {
  private readonly log = new Logger(PhotoSetsService.name);

  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private history: HistoryService,
    private scope: ScopeService,
    private persona: PersonaService,
    private usage: UsageRecorderService,
  ) {}

  // ── Права ────────────────────────────────────────────────────────────────

  isAdmin(user: DashboardUser): boolean {
    return user.role === Role.ADMIN;
  }

  canEdit(user: DashboardUser): boolean {
    return this.isAdmin(user) || Boolean(user.canEditPhotoSets);
  }

  requireAdmin(user: DashboardUser): void {
    if (!this.isAdmin(user))
      throw new ForbiddenException(
        'создавать и назначать образы может администратор',
      );
  }

  /**
   * null — видны все наборы; иначе только назначенные аккаунтам из области
   * пользователя (у тимлида и хеда — включая аккаунты подчинённых).
   */
  private async visibleSetIds(user: DashboardUser): Promise<number[] | null> {
    if (this.isAdmin(user)) return null;
    const rows = await this.prisma.tgAccount.findMany({
      where: {
        id: { in: await this.ownAccounts(user) },
        photoSetId: { not: null },
      },
      select: { photoSetId: true },
      distinct: ['photoSetId'],
    });
    return rows.map((r) => r.photoSetId!);
  }

  async requireVisible(user: DashboardUser, setId: number): Promise<PhotoSet> {
    const set = await this.prisma.photoSet.findUnique({ where: { id: setId } });
    const visible = await this.visibleSetIds(user);
    if (!set || set.archivedAt || (visible && !visible.includes(setId)))
      throw new NotFoundException('образ не найден');
    return set;
  }

  /**
   * Менять общий набор можно только с отдельным правом: правка сразу видна
   * на всех аккаунтах, которым он назначен.
   */
  async requireEditable(user: DashboardUser, setId: number): Promise<PhotoSet> {
    const set = await this.requireVisible(user, setId);
    if (!this.canEdit(user))
      throw new ForbiddenException('нет права менять образы');
    return set;
  }

  async requirePhoto(user: DashboardUser, photoId: number, edit: boolean) {
    const photo = await this.prisma.photoSetPhoto.findFirst({
      where: { id: photoId, deletedAt: null },
    });
    if (!photo) throw new NotFoundException('фото не найдено');
    if (edit) await this.requireEditable(user, photo.setId);
    else await this.requireVisible(user, photo.setId);
    return photo;
  }

  // ── Наборы ───────────────────────────────────────────────────────────────

  private setView(
    s: PhotoSet,
    extra: { photos?: number; accounts?: number; review?: number } = {},
  ) {
    return {
      id: s.id,
      name: s.name,
      cover_photo_id: s.coverPhotoId,
      auto_send: s.autoSend,
      send_mode: s.sendMode,
      min_interval_min: s.minIntervalMin,
      max_per_day: s.maxPerDay,
      no_repeat: s.noRepeat,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
      photos: extra.photos ?? 0,
      accounts: extra.accounts ?? 0,
      needs_review: extra.review ?? 0,
    };
  }

  async list(user: DashboardUser) {
    const visible = await this.visibleSetIds(user);
    const sets = await this.prisma.photoSet.findMany({
      where: { archivedAt: null, ...(visible ? { id: { in: visible } } : {}) },
      orderBy: { id: 'asc' },
    });
    const ids = sets.map((s) => s.id);
    const [photos, review, accounts] = await Promise.all([
      this.prisma.photoSetPhoto.groupBy({
        by: ['setId'],
        where: { setId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.photoSetPhoto.groupBy({
        by: ['setId'],
        where: { setId: { in: ids }, deletedAt: null, reviewed: false },
        _count: { _all: true },
      }),
      this.prisma.tgAccount.groupBy({
        by: ['photoSetId'],
        where: { photoSetId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const count = (rows: any[], key: string) =>
      new Map(rows.map((r) => [r[key], r._count._all as number]));
    const p = count(photos, 'setId');
    const r = count(review, 'setId');
    const a = count(accounts, 'photoSetId');
    return {
      can_edit: this.canEdit(user),
      can_manage: this.isAdmin(user),
      items: sets.map((s) =>
        this.setView(s, {
          photos: p.get(s.id),
          review: r.get(s.id),
          accounts: a.get(s.id),
        }),
      ),
    };
  }

  async create(name: string) {
    const now = this.clock.ts();
    const set = await this.prisma.photoSet.create({
      data: { name: name.trim(), createdAt: now, updatedAt: now },
    });
    return this.setView(set);
  }

  async update(setId: number, dto: UpdatePhotoSetDto) {
    if (dto.cover_photo_id != null) {
      const cover = await this.prisma.photoSetPhoto.findFirst({
        where: { id: dto.cover_photo_id, setId, deletedAt: null },
      });
      if (!cover)
        throw new UnprocessableEntityException(
          'обложка должна быть из этого образа',
        );
    }
    const set = await this.prisma.photoSet.update({
      where: { id: setId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.cover_photo_id !== undefined
          ? { coverPhotoId: dto.cover_photo_id }
          : {}),
        ...(dto.auto_send !== undefined ? { autoSend: dto.auto_send } : {}),
        ...(dto.send_mode !== undefined ? { sendMode: dto.send_mode } : {}),
        ...(dto.min_interval_min !== undefined
          ? { minIntervalMin: dto.min_interval_min }
          : {}),
        ...(dto.max_per_day !== undefined
          ? { maxPerDay: dto.max_per_day }
          : {}),
        ...(dto.no_repeat !== undefined ? { noRepeat: dto.no_repeat } : {}),
        updatedAt: this.clock.ts(),
      },
    });
    return this.setView(set);
  }

  /**
   * Образ снимается со всех аккаунтов. Если его снимки уже показывали,
   * он уходит в архив: отметки о показах должны пережить удаление.
   */
  async remove(setId: number) {
    const now = this.clock.ts();
    const shown = await this.prisma.photoSend.count({
      where: { photo: { setId } },
    });
    await this.prisma.tgAccount.updateMany({
      where: { photoSetId: setId },
      data: { photoSetId: null },
    });
    if (shown)
      await this.prisma.photoSet.update({
        where: { id: setId },
        data: { archivedAt: now, autoSend: false, updatedAt: now },
      });
    else await this.prisma.photoSet.delete({ where: { id: setId } });
    return { ok: true, archived: Boolean(shown) };
  }

  // ── Фото ─────────────────────────────────────────────────────────────────

  photoView(p: PhotoSetPhoto, sent?: { at: number; count: number }) {
    return {
      id: p.id,
      set_id: p.setId,
      width: p.width,
      height: p.height,
      description: p.description,
      place: p.place,
      taken_on: p.takenOn,
      taken_label: formatTakenOn(p.takenOn),
      details: p.details,
      tags: parseTags(p.tags),
      auto_send: p.autoSend,
      reviewed: p.reviewed,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
      sent_at: sent?.at ?? null,
      sent_count: sent?.count ?? 0,
    };
  }

  async photos(setId: number, query: { q?: string; tag?: string } = {}) {
    const rows = await this.prisma.photoSetPhoto.findMany({
      where: { setId, deletedAt: null },
      orderBy: { id: 'desc' },
    });
    return { items: filterPhotos(rows, query).map((p) => this.photoView(p)) };
  }

  async upload(setId: number, name: string, data: Buffer) {
    if (!Buffer.isBuffer(data) || !data.length)
      throw new UnprocessableEntityException('пустой файл');
    if (data.length > MAX_PHOTO_BYTES)
      throw new UnprocessableEntityException('файл больше 25 МБ');
    const sha256 = createHash('sha256').update(data).digest('hex');
    const existing = await this.prisma.photoSetPhoto.findUnique({
      where: { setId_sha256: { setId, sha256 } },
    });
    if (existing && !existing.deletedAt)
      return { duplicate: true, photo: this.photoView(existing) };

    let image: Buffer, thumb: Buffer, width: number, height: number;
    let takenOn: string | null = null;
    try {
      const source = sharp(data, {
        failOn: 'error',
        limitInputPixels: 80_000_000,
      });
      const meta = await source.metadata();
      takenOn = exifDate(meta.exif);
      // Метаданные (в том числе GPS) не сохраняем: в Telegram уходит чистый снимок.
      const out = await source
        .rotate()
        .resize({
          width: MAX_SIDE,
          height: MAX_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 90 })
        .toBuffer({ resolveWithObject: true });
      image = out.data;
      width = out.info.width;
      height = out.info.height;
      thumb = await sharp(image)
        .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside' })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch {
      throw new UnprocessableEntityException(
        `«${name || 'файл'}» — не изображение или формат не поддерживается`,
      );
    }
    const dir = join(PHOTO_SETS_DIR, String(setId));
    mkdirSync(dir, { recursive: true });
    const stem = randomUUID();
    const filePath = join(dir, `${stem}.jpg`);
    const thumbPath = join(dir, `${stem}_thumb.jpg`);
    writeFileSync(filePath, image);
    writeFileSync(thumbPath, thumb);

    const card = await suggestPhotoCard(image, {
      client: this.persona.anthropic,
      provider: this.persona.provider,
      usageDb: this.usage.scoped({}),
      logger: {
        info: (m) => this.log.log(m),
        warn: (m) => this.log.warn(m),
        error: (m) => this.log.error(m),
      },
    }).catch((e) => {
      this.log.warn(`photo description failed: ${e?.message ?? e}`);
      return null;
    });
    const now = this.clock.ts();
    const data_ = {
      filePath,
      thumbPath,
      width,
      height,
      description: card?.description ?? '',
      place: card?.place ?? null,
      takenOn,
      details: card?.details ?? '',
      tags: JSON.stringify(card?.tags ?? []),
      autoSend: true,
      reviewed: false,
      updatedAt: now,
      deletedAt: null,
    };
    const photo = existing
      ? await this.prisma.photoSetPhoto.update({
          where: { id: existing.id },
          data: data_,
        })
      : await this.prisma.photoSetPhoto.create({
          data: { ...data_, setId, sha256, createdAt: now },
        });
    const set = await this.prisma.photoSet.findUnique({ where: { id: setId } });
    if (set && !set.coverPhotoId)
      await this.prisma.photoSet.update({
        where: { id: setId },
        data: { coverPhotoId: photo.id },
      });
    await this.prisma.photoSet.update({
      where: { id: setId },
      data: { updatedAt: now },
    });
    return {
      duplicate: false,
      described: Boolean(card?.description),
      photo: this.photoView(photo),
    };
  }

  async updatePhoto(photoId: number, dto: UpdatePhotoDto) {
    const takenOn =
      dto.taken_on === undefined
        ? undefined
        : dto.taken_on === null || !dto.taken_on.trim()
          ? null
          : normalizeTakenOn(dto.taken_on);
    if (takenOn === null && dto.taken_on && dto.taken_on.trim())
      throw new UnprocessableEntityException(
        'дата: ГГГГ, ГГГГ-ММ или ГГГГ-ММ-ДД, либо пусто — «дата неизвестна»',
      );
    const photo = await this.prisma.photoSetPhoto.update({
      where: { id: photoId },
      data: {
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.place !== undefined
          ? { place: dto.place?.trim() || null }
          : {}),
        ...(takenOn !== undefined ? { takenOn } : {}),
        ...(dto.details !== undefined ? { details: dto.details.trim() } : {}),
        ...(dto.tags !== undefined
          ? { tags: JSON.stringify(parseTags(dto.tags)) }
          : {}),
        ...(dto.auto_send !== undefined ? { autoSend: dto.auto_send } : {}),
        reviewed: true,
        updatedAt: this.clock.ts(),
      },
    });
    return this.photoView(photo);
  }

  /** Мягкое удаление: файл и отметки о показах остаются для истории диалогов. */
  async removePhoto(photoId: number) {
    const photo = await this.prisma.photoSetPhoto.update({
      where: { id: photoId },
      data: { deletedAt: this.clock.ts() },
    });
    await this.prisma.photoSet.updateMany({
      where: { id: photo.setId, coverPhotoId: photoId },
      data: { coverPhotoId: null },
    });
    return { ok: true };
  }

  async photoFile(user: DashboardUser, photoId: number, thumb: boolean) {
    const photo = await this.prisma.photoSetPhoto.findUnique({
      where: { id: photoId },
    });
    if (!photo) throw new NotFoundException('фото не найдено');
    // Удалённый снимок остаётся виден там, где его уже отправляли.
    if (!this.isAdmin(user) && photo.deletedAt) {
      const own = await this.prisma.photoSend.findFirst({
        where: { photoId, accountId: { in: await this.ownAccounts(user) } },
      });
      if (!own) throw new NotFoundException('фото не найдено');
    } else if (!photo.deletedAt) await this.requireVisible(user, photo.setId);
    const path = thumb ? photo.thumbPath : photo.filePath;
    if (!insidePhotoStore(path) || !existsSync(path))
      throw new NotFoundException('файла больше нет');
    return path;
  }

  private async ownAccounts(user: DashboardUser): Promise<number[]> {
    return (await this.scope.accountsFilter(user)) ?? [];
  }

  // ── Аккаунты ─────────────────────────────────────────────────────────────

  async assign(accountIds: number[], setId: number | null) {
    if (setId != null) {
      const set = await this.prisma.photoSet.findUnique({
        where: { id: setId },
      });
      if (!set || set.archivedAt)
        throw new NotFoundException('образ не найден');
    }
    const ids = [...new Set(accountIds)];
    const { count } = await this.prisma.tgAccount.updateMany({
      where: { id: { in: ids } },
      data: { photoSetId: setId },
    });
    return { ok: true, updated: count, set_id: setId };
  }

  async setAccountAutoSend(accountId: number, enabled: boolean) {
    const account = await this.prisma.tgAccount.update({
      where: { id: accountId },
      data: { photoAutoSend: enabled },
      select: { id: true, photoAutoSend: true },
    });
    return { id: account.id, photo_auto_send: account.photoAutoSend };
  }

  async accountOwnedBy(user: DashboardUser, accountId: number): Promise<void> {
    if (this.isAdmin(user)) return;
    if (!(await this.ownAccounts(user)).includes(accountId))
      throw new NotFoundException('аккаунт не найден');
  }

  // ── Диалог ───────────────────────────────────────────────────────────────

  /** Библиотека образа, назначенного аккаунту чата, с отметками о показах этому собеседнику. */
  async chatLibrary(chatId: number, query: { q?: string; tag?: string } = {}) {
    const accountId = await this.history.chatOwnerAccount(chatId);
    const account = accountId
      ? await this.prisma.tgAccount.findUnique({
          where: { id: accountId },
          include: { photoSet: true },
        })
      : null;
    const sends = await this.prisma.photoSend.findMany({
      where: { chatId: toChatId(chatId) },
      orderBy: { sentAt: 'asc' },
    });
    const sentBy = new Map<number, { at: number; count: number }>();
    for (const s of sends) {
      const prev = sentBy.get(s.photoId);
      sentBy.set(s.photoId, { at: s.sentAt, count: (prev?.count ?? 0) + 1 });
    }
    const set = account?.photoSet ?? null;
    const rows = set
      ? await this.prisma.photoSetPhoto.findMany({
          where: { setId: set.id, deletedAt: null },
          orderBy: { id: 'desc' },
        })
      : [];
    const tags = [...new Set(rows.flatMap((r) => parseTags(r.tags)))].sort();
    return {
      set: set ? this.setView(set, { photos: rows.length }) : null,
      account_auto_send: account?.photoAutoSend ?? false,
      tags,
      items: filterPhotos(rows, query).map((p) =>
        this.photoView(p, sentBy.get(p.id)),
      ),
      sent_total: sends.length,
    };
  }

  /** Снимок для ручной отправки: только из образа, назначенного аккаунту этого чата. */
  async photoForChat(chatId: number, photoId: number) {
    const accountId = await this.history.chatOwnerAccount(chatId);
    const account = accountId
      ? await this.prisma.tgAccount.findUnique({
          where: { id: accountId },
          select: { photoSetId: true },
        })
      : null;
    const photo = await this.prisma.photoSetPhoto.findFirst({
      where: { id: photoId, deletedAt: null },
    });
    if (!photo || !account?.photoSetId || photo.setId !== account.photoSetId)
      throw new NotFoundException('фото нет в образе этого аккаунта');
    return photo;
  }
}

export function filterPhotos<T extends PhotoSetPhoto>(
  rows: T[],
  query: { q?: string; tag?: string },
): T[] {
  const q = (query.q ?? '').trim().toLowerCase();
  const tag = (query.tag ?? '').trim().toLowerCase();
  return rows.filter((p) => {
    const tags = parseTags(p.tags);
    if (tag && !tags.includes(tag)) return false;
    if (!q) return true;
    return [p.description, p.place ?? '', p.details, tags.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(q);
  });
}
