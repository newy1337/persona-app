import { Injectable } from '@nestjs/common';
import type { Prisma, PhotoSet, PhotoSetPhoto } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { toChatId } from '../utils/ids';
import { characterDate } from 'src/brain/nastya/kernel/clock';
import {
  parseTags,
  photoAvailability,
  photoNote,
  type PhotoAvailability,
  type PhotoFacts,
} from 'src/domain/photo-library';

export interface LibraryPhoto extends PhotoFacts {
  setId: number;
  filePath: string;
}

export interface PhotoSendInput {
  chatId: number;
  photoId: number;
  accountId?: number | null;
  messageId?: number | null;
  tgMsgId?: number | null;
  caption: string;
  note: string;
  source: 'bot' | 'manager';
  actor?: string | null;
  sentAt: number;
}

type Db = PrismaService | Prisma.TransactionClient;

export const facts = (p: PhotoSetPhoto): LibraryPhoto => ({
  id: p.id,
  setId: p.setId,
  filePath: p.filePath,
  description: p.description,
  place: p.place,
  takenOn: p.takenOn,
  details: p.details,
  tags: parseTags(p.tags),
});

/**
 * Библиотека образа глазами диалога: что можно показать этому собеседнику и
 * что он уже видел. Отметки об отправке живут по чату и фото.
 */
@Injectable()
export class PhotoLibraryService {
  constructor(private prisma: PrismaService) {}

  /**
   * Образ, который сейчас получают новые диалоги аккаунта: назначенный хедом
   * личности аккаунта в регионе его менеджера. Нет назначения — нет образа.
   */
  async currentSetId(accountId: number, db: Db = this.prisma) {
    const account = await db.tgAccount.findUnique({
      where: { id: accountId },
      select: {
        personaId: true,
        manager: { select: { user: { select: { regionCode: true } } } },
      },
    });
    if (!account) return null;
    const region = account.manager?.user.regionCode;
    const assigned = region
      ? await db.regionPhotoSet.findUnique({
          where: {
            regionCode_personaSlug: {
              regionCode: region,
              personaSlug: account.personaId,
            },
          },
          select: { setId: true },
        })
      : null;
    return assigned?.setId ?? null;
  }

  /**
   * Образ диалога. Диалог закрепляется за образом при первом обращении и
   * дальше на нём остаётся: смена образа в регионе касается только новых
   * собеседников. Архивный образ больше ничего не отправляет.
   */
  async setForChat(
    chatId: number,
    accountId?: number | null,
  ): Promise<PhotoSet | null> {
    const id = toChatId(chatId);
    const contact = await this.prisma.contact.findUnique({
      where: { chatId: id },
      select: { accountId: true, photoSet: true },
    });
    if (contact?.photoSet)
      return contact.photoSet.archivedAt ? null : contact.photoSet;
    const owner = accountId ?? contact?.accountId ?? null;
    if (!contact || owner == null) return null;
    const setId = await this.currentSetId(owner);
    if (setId == null) return null;
    await this.prisma.contact.updateMany({
      where: { chatId: id, photoSetId: null },
      data: { photoSetId: setId },
    });
    const bound = await this.prisma.contact.findUnique({
      where: { chatId: id },
      select: { photoSet: true },
    });
    const set = bound?.photoSet ?? null;
    return set && !set.archivedAt ? set : null;
  }

  async sends(chatId: number) {
    return this.prisma.photoSend.findMany({
      where: { chatId: toChatId(chatId) },
      orderBy: { sentAt: 'asc' },
    });
  }

  /** Что бот может отправить сейчас; undefined — у аккаунта нет образа. */
  async context(
    chatId: number,
    accountId: number,
    timeZone: string,
    now: number,
  ): Promise<PhotoAvailability | undefined> {
    const [account, set] = await Promise.all([
      this.prisma.tgAccount.findUnique({
        where: { id: accountId },
        select: { photoAutoSend: true },
      }),
      this.setForChat(chatId, accountId),
    ]);
    if (!account || !set) return undefined;
    const [photos, sends] = await Promise.all([
      this.prisma.photoSetPhoto.findMany({
        where: { setId: set.id, deletedAt: null },
        orderBy: { id: 'asc' },
      }),
      this.sends(chatId),
    ]);
    // Показанное из прошлых наборов тоже считается: описания берём из самих снимков.
    const shownElsewhere = sends.some(
      (s) => !photos.some((p) => p.id === s.photoId),
    )
      ? await this.prisma.photoSetPhoto.findMany({
          where: {
            id: { in: sends.map((s) => s.photoId) },
            setId: { not: set.id },
          },
        })
      : [];
    return photoAvailability({
      rules: set,
      accountAutoSend: account.photoAutoSend,
      photos: [...shownElsewhere, ...photos].map((p) => ({
        ...facts(p),
        autoSend: p.setId === set.id && p.autoSend,
      })),
      sends: sends.map((s) => ({
        photoId: s.photoId,
        sentAt: s.sentAt,
        date: characterDate(new Date(s.sentAt * 1000), timeZone),
      })),
      now,
      today: characterDate(new Date(now * 1000), timeZone),
    });
  }

  async photo(id: number): Promise<LibraryPhoto | null> {
    const row = await this.prisma.photoSetPhoto.findFirst({
      where: { id, deletedAt: null },
    });
    return row ? facts(row) : null;
  }

  note(photo: PhotoFacts, today?: string): string {
    return photoNote(photo, today);
  }

  /** Повтор той же доставки (тот же message_id) не создаёт вторую отметку. */
  async recordSend(input: PhotoSendInput, db: Db = this.prisma) {
    const data = {
      chatId: toChatId(input.chatId),
      photoId: input.photoId,
      accountId: input.accountId ?? null,
      messageId: input.messageId ?? null,
      tgMsgId: input.tgMsgId ?? null,
      caption: input.caption,
      note: input.note,
      source: input.source,
      actor: input.actor ?? null,
      sentAt: input.sentAt,
    };
    if (input.messageId == null) return db.photoSend.create({ data });
    return db.photoSend.upsert({
      where: { messageId: input.messageId },
      create: data,
      update: {},
    });
  }
}
