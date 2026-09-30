import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ClockService } from './clock.service';

@Injectable()
export class AuditService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  async log(params: {
    userId: number | null;
    action: string;
    resource?: string | null;
    payload?: unknown;
    error?: string | null;
  }) {
    const { userId, action, resource = null, payload, error = null } = params;
    await this.prisma.dashboardAuditLog.create({
      data: {
        ts: this.clock.ts(),
        userId,
        action,
        resource,
        payloadJson: payload === undefined ? null : JSON.stringify(payload),
        result: error ? 'failure' : 'success',
        error,
      },
    });
  }

  async wrap<T>(
    params: {
      userId: number | null;
      action: string;
      resource?: string | null;
      payload?: unknown;
    },
    body: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await body();
      await this.log(params);
      return result;
    } catch (e) {
      await this.log({ ...params, error: String(e?.message ?? e) });
      throw e;
    }
  }
}
