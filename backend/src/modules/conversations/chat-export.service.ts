import { Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, readFileSync, statSync } from 'fs';
import { extname, isAbsolute, relative, resolve } from 'path';
import { PrismaService } from 'src/prisma.service';
import { HistoryService, StoredMessage } from 'src/shared/history.service';
import { ClockService } from 'src/shared/clock.service';
import { PresenceService } from 'src/shared/presence.service';
import { PersonaService } from 'src/brain/persona.service';
import { appConfig } from 'src/config/app.config';
import { toChatId } from 'src/utils/ids';
import { telegramRead } from './conversations.service';
import { ExportMediaKind, ExportMessage, renderChatHtml } from './html-export';

const EXPORT_LIMIT = 5000;
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const INBOUND_MATCH_S = 5;
const SHOWN_MATCH_S = 600;

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  txt: 'text/plain',
};

const LABEL_KIND: Record<string, ExportMediaKind> = {
  Фото: 'photo',
  'Голосовое сообщение': 'voice',
  Кружок: 'video_note',
  Видео: 'video',
  GIF: 'animation',
  Стикер: 'sticker',
  Файл: 'document',
};

export function splitLabel(text: string): {
  label: string | null;
  rest: string;
} {
  const m = /^\[([^\]\n]+)\](?:\n([\s\S]*))?$/.exec(text.trim());
  if (!m) return { label: null, rest: text };
  return { label: m[1]!.trim(), rest: (m[2] ?? '').trim() };
}

@Injectable()
export class ChatExportService {
  constructor(
    private prisma: PrismaService,
    private history: HistoryService,
    private clock: ClockService,
    private presence: PresenceService,
    private persona: PersonaService,
  ) {}

  async html(
    chatId: number,
    exportedBy: string | null = null,
  ): Promise<{ filename: string; content: string }> {
    const id = toChatId(chatId);
    const contact = await this.prisma.contact.findUnique({
      where: { chatId: id },
    });
    const messages = await this.history.window(chatId, EXPORT_LIMIT);
    if (!contact && !messages.length)
      throw new NotFoundException('чат не найден');

    const [facts, read, inbound, shown, profile, persona] = await Promise.all([
      this.history.getLeadFacts(chatId),
      this.history.telegramReadMarks(chatId),
      this.prisma.inboundMedia.findMany({ where: { chatId: id } }),
      this.prisma.mediaShown.findMany({ where: { chatId: id } }),
      this.prisma.phoneNumber.findFirst({ where: { telegramUserId: id } }),
      this.persona.forChat(chatId).catch(() => null),
    ]);
    const account = contact?.accountId
      ? await this.prisma.tgAccount.findUnique({
          where: { id: contact.accountId },
          select: { id: true, username: true, displayName: true },
        })
      : null;

    const budget = { left: MAX_TOTAL_BYTES, skipped: 0 };
    const embed = (path: string | null): string | null => {
      if (!path) return null;
      const abs = this.safePath(path);
      if (!abs) return null;
      const size = statSync(abs).size;
      if (size > MAX_FILE_BYTES || size > budget.left) {
        budget.skipped += 1;
        return null;
      }
      budget.left -= size;
      const mime =
        MIME[extname(abs).slice(1).toLowerCase()] ?? 'application/octet-stream';
      return `data:${mime};base64,${readFileSync(abs).toString('base64')}`;
    };

    const nearest = <T extends { ts: number }>(
      rows: T[],
      ts: number,
      within: number,
    ): T | null => {
      let best: T | null = null;
      for (const r of rows)
        if (
          Math.abs(r.ts - ts) <= within &&
          (!best || Math.abs(r.ts - ts) < Math.abs(best.ts - ts))
        )
          best = r;
      return best;
    };
    const inboundRows = inbound.map((r) => ({
      ts: r.msgTs,
      kind: r.kind,
      path: r.path,
    }));
    const shownRows = shown.map((r) => ({
      ts: r.shownTs,
      kind: r.kind,
      path: r.path,
    }));

    const out: ExportMessage[] = messages.map((m) =>
      this.message(m, read, inboundRows, shownRows, nearest, embed),
    );

    const stages: Array<{ id: string; title: string }> =
      persona?.config.goals?.['stages'] ?? [];
    const stage =
      stages.find((s) => s.id === facts['_brain_stage'])?.title ??
      stages[0]?.title ??
      null;
    const clientName =
      (facts['name'] as string) ||
      profile?.firstName ||
      (facts['tg_username'] as string) ||
      `Чат ${chatId}`;
    const avatarOf = (path: string) =>
      existsSync(path)
        ? `data:image/jpeg;base64,${readFileSync(path).toString('base64')}`
        : null;

    const content = renderChatHtml({
      chatId,
      clientName,
      clientUsername:
        (facts['tg_username'] as string) ||
        profile?.telegramUsername ||
        profile?.usernameKey ||
        null,
      clientPhone: (facts['phone'] as string) || profile?.phoneE164 || null,
      clientCity: (facts['city'] as string) || profile?.city || null,
      clientAge: Number(facts['age']) || profile?.age || null,
      clientAvatar: avatarOf(this.presence.avatarPath(chatId)),
      accountName: account?.displayName ?? null,
      accountUsername: account?.username ?? null,
      accountAvatar: account
        ? avatarOf(this.presence.accountAvatarPath(account.id))
        : null,
      personaName: persona?.name ?? null,
      stage,
      exportedAt: this.clock.ts(),
      exportedBy,
      messages: out,
      skippedMedia: budget.skipped,
    });
    const safeName =
      clientName
        .replace(/[^\p{L}\p{N}_-]+/gu, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'chat';
    const day = new Date(this.clock.ts() * 1000).toISOString().slice(0, 10);
    return { filename: `${safeName}_${chatId}_${day}.html`, content };
  }

  private message(
    m: StoredMessage,
    read: { outbox: number | null; inbox: number | null },
    inbound: Array<{ ts: number; kind: string; path: string }>,
    shown: Array<{ ts: number; kind: string; path: string }>,
    nearest: <T extends { ts: number }>(
      rows: T[],
      ts: number,
      within: number,
    ) => T | null,
    embed: (path: string | null) => string | null,
  ): ExportMessage {
    const base: ExportMessage = {
      id: m.id,
      ts: m.ts,
      role: m.role,
      author: m.author,
      text: m.text,
      reaction: m.reaction,
      deleted: Boolean(m.deleted_at),
      read: telegramRead(m, read),
    };

    if (m.media_kind && m.file_path) {
      const remote = /^https?:\/\//i.test(m.file_path);
      const src = remote ? null : embed(m.file_path);
      const { label, rest } = splitLabel(m.text);
      const spoken = m.media_kind === 'voice' || m.media_kind === 'video_note';
      return {
        ...base,
        text: label ? (spoken ? '' : rest) : m.text,
        transcript: label && spoken && rest ? rest : null,
        media: {
          kind: m.media_kind as ExportMediaKind,
          src,
          href: remote ? m.file_path : null,
          missing: src
            ? null
            : 'файл вложения не сохранился или слишком большой',
        },
      };
    }

    const placeholder = /^\[media:([a-z_]+)\]$/.exec(m.text.trim());
    if (placeholder) {
      const row = nearest(shown, m.ts, SHOWN_MATCH_S);
      const src = row ? embed(row.path) : null;
      return {
        ...base,
        text: '',
        media: {
          kind: placeholder[1] as ExportMediaKind,
          src,
          missing: src ? null : 'файл не сохранился',
        },
      };
    }

    const { label, rest } = splitLabel(m.text);
    if (label === null) return base;
    const kindFromLabel = LABEL_KIND[label.split(':')[0]!.trim()];
    if (m.role !== 'user' || !kindFromLabel)
      return { ...base, text: rest, label };
    const row = nearest(inbound, m.ts, INBOUND_MATCH_S);
    const spoken = kindFromLabel === 'voice' || kindFromLabel === 'video_note';
    const src = row ? embed(row.path) : null;
    return {
      ...base,
      text: spoken ? '' : rest,
      transcript: spoken && rest ? rest : null,
      label: src ? null : label,
      media: src
        ? { kind: (row!.kind as ExportMediaKind) || kindFromLabel, src }
        : null,
    };
  }

  private safePath(raw: string): string | null {
    const abs = resolve(
      isAbsolute(raw) ? raw : resolve(appConfig.dataDir, '..', raw),
    );
    const candidates = [abs, resolve(raw)];
    for (const p of candidates) {
      const rel = relative(appConfig.dataDir, p);
      if (rel.startsWith('..') || isAbsolute(rel)) continue;
      if (existsSync(p) && statSync(p).isFile()) return p;
    }
    return null;
  }
}
