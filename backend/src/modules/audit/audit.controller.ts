import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { PrismaService } from 'src/prisma.service';
import { resolveRange } from 'src/modules/stats/range';
import { ClockService } from 'src/shared/clock.service';

const PAGE = 100;
const PAYLOAD_MAX = 2000;

/**
 * Журнал действий в панели (dashboard_audit_log) — то, что пишут audit.wrap
 * и audit.log по всем модулям. Только чтение и только админу: кто, что,
 * над чем и чем закончилось. Листается назад по id (before).
 */
@ApiTags('Audit')
@ApiBearerAuth()
@Auth()
@Roles(Role.ADMIN)
@Controller('api/audit')
export class AuditController {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
  ) {}

  @ApiOperation({ summary: 'Журнал действий: новые сверху, по 100' })
  @ApiQuery({ name: 'from', required: false, example: '2026-10-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-10-27' })
  @ApiQuery({ name: 'user_id', required: false })
  @ApiQuery({
    name: 'action',
    required: false,
    description: 'начало имени действия: lead, persona.section',
  })
  @ApiQuery({
    name: 'failed',
    required: false,
    description: '1 — только ошибки',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'поиск по объекту и данным',
  })
  @ApiQuery({
    name: 'before',
    required: false,
    description: 'id — листать дальше',
  })
  @Get()
  async list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('user_id') userId?: string,
    @Query('action') action?: string,
    @Query('failed') failed?: string,
    @Query('q') q?: string,
    @Query('before') before?: string,
  ) {
    const range =
      from || to ? resolveRange({ from, to }, this.clock.ts()) : null;
    const text = q?.trim();
    const where: Prisma.DashboardAuditLogWhereInput = {
      AND: [
        range ? { ts: { gte: range.start, lt: range.end } } : {},
        userId ? { userId: Number(userId) } : {},
        action?.trim() ? { action: { startsWith: action.trim() } } : {},
        failed === '1' ? { result: 'failure' } : {},
        text
          ? {
              OR: [
                { resource: { contains: text, mode: 'insensitive' } },
                { payloadJson: { contains: text, mode: 'insensitive' } },
              ],
            }
          : {},
        before ? { id: { lt: Number(before) } } : {},
      ],
    };
    const rows = await this.prisma.dashboardAuditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: PAGE + 1,
      include: { user: { select: { username: true, role: true } } },
    });
    const users = await this.prisma.dashboardUser.findMany({
      select: { id: true, username: true, role: true },
      orderBy: { username: 'asc' },
    });
    return {
      items: rows.slice(0, PAGE).map((r) => ({
        id: r.id,
        ts: r.ts,
        user_id: r.userId,
        username: r.user?.username ?? null,
        role: r.user?.role ?? null,
        action: r.action,
        resource: r.resource,
        payload:
          r.payloadJson && r.payloadJson.length > PAYLOAD_MAX
            ? `${r.payloadJson.slice(0, PAYLOAD_MAX)}…`
            : r.payloadJson,
        result: r.result,
        error: r.error,
      })),
      more: rows.length > PAGE,
      users,
    };
  }
}
