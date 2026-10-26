import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { PrismaService } from 'src/prisma.service';
import { resolveRange } from 'src/modules/stats/range';
import { ClockService } from 'src/shared/clock.service';

const PAGE = 100;
const PAYLOAD_MAX = 2000;

/** Параметры журнала: числа проверяются до запроса, иначе NaN уходил бы в фильтр Prisma. */
export class AuditQuery {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;
  @ApiPropertyOptional({ example: '2026-10-27' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  user_id?: number;
  @ApiPropertyOptional({
    description: 'начало имени действия: lead, persona.section',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;
  @ApiPropertyOptional({ description: '1 — только ошибки' })
  @IsOptional()
  @IsIn(['1', '0'])
  failed?: string;
  @ApiPropertyOptional({ description: 'поиск по объекту и данным' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  q?: string;
  @ApiPropertyOptional({ description: 'id — листать дальше' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  before?: number;
}

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
  @Get()
  async list(@Query() query: AuditQuery) {
    const { from, to, action, failed, q, before } = query;
    const userId = query.user_id;
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
