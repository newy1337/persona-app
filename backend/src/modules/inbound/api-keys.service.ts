import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';

export interface ApiKeyView {
  id: number;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

const hashOf = (raw: string) => createHash('sha256').update(raw).digest('hex');
/** last_used_at обновляем не чаще раза в минуту, чтобы не писать на каждый запрос */
const TOUCH_EVERY_S = 60;

/** Ключи внешних систем: создать (ключ виден один раз), отозвать, проверить. */
@Injectable()
export class ApiKeysService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  private view(k: {
    id: number;
    name: string;
    prefix: string;
    createdAt: number;
    lastUsedAt: number | null;
    revokedAt: number | null;
  }): ApiKeyView {
    return {
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      created_at: k.createdAt,
      last_used_at: k.lastUsedAt,
      revoked_at: k.revokedAt,
    };
  }

  async list(): Promise<{ items: ApiKeyView[] }> {
    const rows = await this.prisma.apiKey.findMany({
      orderBy: [{ revokedAt: 'asc' }, { id: 'desc' }],
    });
    return { items: rows.map((k) => this.view(k)) };
  }

  async create(
    rawName: string,
    createdById: number | null,
  ): Promise<{ key: string; item: ApiKeyView }> {
    const name = rawName.trim();
    if (!name) throw new UnprocessableEntityException('название ключа пустое');
    const key = `sk_${randomBytes(24).toString('base64url')}`;
    const row = await this.prisma.apiKey.create({
      data: {
        name,
        keyHash: hashOf(key),
        prefix: key.slice(0, 7),
        createdAt: this.clock.ts(),
        createdById,
      },
    });
    return { key, item: this.view(row) };
  }

  async revoke(id: number): Promise<{ items: ApiKeyView[] }> {
    const row = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('нет такого ключа');
    if (!row.revokedAt)
      await this.prisma.apiKey.update({
        where: { id },
        data: { revokedAt: this.clock.ts() },
      });
    return this.list();
  }

  /** Действующий ключ по сырому значению; null — нет или отозван. */
  async verify(raw: string): Promise<ApiKeyView | null> {
    if (!raw || raw.length > 128) return null;
    const row = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashOf(raw) },
    });
    if (!row || row.revokedAt) return null;
    const now = this.clock.ts();
    if (!row.lastUsedAt || now - row.lastUsedAt >= TOUCH_EVERY_S)
      await this.prisma.apiKey.update({
        where: { id: row.id },
        data: { lastUsedAt: now },
      });
    return this.view(row);
  }
}
