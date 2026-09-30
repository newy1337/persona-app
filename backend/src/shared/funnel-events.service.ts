import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { appConfig } from '../config/app.config';
import { toChatId } from '../utils/ids';

export interface FunnelEventView {
  event_type: string;
  metadata: Record<string, unknown>;
  ts: number;
}

@Injectable()
export class FunnelEventsService {
  constructor(private prisma: PrismaService) {}

  async emit(
    chatId: number | null,
    eventType: string,
    ts: number,
    metadata: Record<string, unknown> = {},
  ) {
    try {
      await this.prisma.funnelEvent.create({
        data: {
          personaId: appConfig.personaId,
          chatId: chatId === null ? null : toChatId(chatId),
          eventType,
          eventMeta: JSON.stringify(metadata),
          ts,
        },
      });
    } catch {}
  }

  async forChat(chatId: number, limit = 500): Promise<FunnelEventView[]> {
    const rows = await this.prisma.funnelEvent.findMany({
      where: { chatId: toChatId(chatId) },
      orderBy: { id: 'desc' },
      take: limit,
    });
    return rows.reverse().map((e) => {
      let metadata: Record<string, unknown> = {};
      try {
        metadata = e.eventMeta ? JSON.parse(e.eventMeta) : {};
      } catch {
        metadata = {};
      }
      return { event_type: e.eventType, metadata, ts: e.ts };
    });
  }
}
