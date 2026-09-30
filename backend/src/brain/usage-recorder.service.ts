import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { toChatId } from 'src/utils/ids';
import type { UsageDb } from './nastya/memory/client';
import type { UsageRow } from './nastya/llm/usage';

export interface UsageScope {
  chatId?: number | null;
  personaId?: string | null;
}

@Injectable()
export class UsageRecorderService implements UsageDb {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  record(row: UsageRow): Promise<void> {
    return this.write(row, {});
  }

  scoped(scope: UsageScope): UsageDb {
    return { record: (row: UsageRow) => this.write(row, scope) };
  }

  private async write(row: UsageRow, scope: UsageScope): Promise<void> {
    await this.prisma.modelUsage.create({
      data: {
        createdAt: this.clock.ts(),
        chatId: scope.chatId == null ? null : toChatId(scope.chatId),
        personaId: scope.personaId ?? null,
        provider: row.provider,
        model: row.model,
        stage: row.stage,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cachedTokens: row.cachedTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        cacheWrite1hTokens: row.cacheWrite1hTokens,
        providerEstimatedCostUsd: row.providerEstimatedCostUsd,
        elapsedMs: row.elapsedMs,
      },
    });
  }
}
