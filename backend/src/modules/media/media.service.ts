import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, statSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import { PrismaService } from 'src/prisma.service';
import { appConfig } from 'src/config/app.config';
import { toChatId } from 'src/utils/ids';

const MATCH_TOLERANCE_S = 600;

@Injectable()
export class MediaService {
  constructor(private prisma: PrismaService) {}

  private resolvePath(raw: string): string {
    const p = isAbsolute(raw) ? raw : resolve(appConfig.dataDir, '..', raw);
    const resolved = resolve(p);
    const rel = relative(appConfig.dataDir, resolved);
    if (rel.startsWith('..') || isAbsolute(rel))
      throw new ForbiddenException('path outside data dir');
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      throw new NotFoundException('media file missing on disk');
    }
    return resolved;
  }

  async nearestFile(chatId: number, msgTs: number): Promise<string> {
    const id = toChatId(chatId);
    const [shown, inbound] = await Promise.all([
      this.prisma.mediaShown.findMany({ where: { chatId: id } }),
      this.prisma.inboundMedia.findMany({ where: { chatId: id } }),
    ]);
    let best: { path: string; diff: number } | null = null;
    for (const row of [
      ...shown.map((s) => ({ path: s.path, ts: s.shownTs })),
      ...inbound.map((i) => ({ path: i.path, ts: i.msgTs })),
    ]) {
      const diff = Math.abs(row.ts - msgTs);
      if (diff < MATCH_TOLERANCE_S && (!best || diff < best.diff))
        best = { path: row.path, diff };
    }
    if (!best)
      throw new NotFoundException('no media delivery near this message');
    return this.resolvePath(best.path);
  }

  async inboundList(chatId: number) {
    const rows = await this.prisma.inboundMedia.findMany({
      where: { chatId: toChatId(chatId) },
      orderBy: { msgTs: 'asc' },
    });
    return { items: rows.map((r) => ({ ts: r.msgTs, kind: r.kind })) };
  }
}
