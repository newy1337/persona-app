import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { CurrentUser } from 'src/decorators/user.decorator';
import { Role } from 'src/enums/roles.enum';
import { PrismaService } from 'src/prisma.service';
import { AuditService } from 'src/shared/audit.service';
import { ClockService } from 'src/shared/clock.service';

/** Ключ в settings: общий список шаблонов ответа для всей команды. */
export const QUICK_REPLIES_KEY = 'quick_replies';
const MAX_ITEMS = 100;

export class QuickReplyDto {
  @IsString() @MinLength(1) @MaxLength(60) title: string;
  @IsString() @MinLength(1) @MaxLength(1000) text: string;
}

export class QuickRepliesDto {
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => QuickReplyDto)
  items: QuickReplyDto[];
}

/**
 * Быстрые ответы: готовые фразы, которые менеджер вставляет в чат одним
 * выбором (в тексте можно {name} — подставит имя собеседника на панели).
 * Читают все, кто ведёт диалоги; правят админ и хед.
 */
@ApiTags('Quick replies')
@ApiBearerAuth()
@Auth()
@Controller('api/quick-replies')
export class QuickRepliesController {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private audit: AuditService,
  ) {}

  private async read(): Promise<QuickReplyDto[]> {
    const row = await this.prisma.setting.findUnique({
      where: { key: QUICK_REPLIES_KEY },
    });
    try {
      const items: unknown = JSON.parse(row?.value ?? '[]');
      return Array.isArray(items)
        ? items.filter(
            (i): i is QuickReplyDto =>
              typeof i?.title === 'string' && typeof i?.text === 'string',
          )
        : [];
    } catch {
      return [];
    }
  }

  @ApiOperation({ summary: 'Шаблоны ответов команды' })
  @Roles(Role.MANAGER, Role.TEAMLEAD, Role.HEAD, Role.ADMIN)
  @Get()
  async list() {
    return { items: await this.read() };
  }

  @ApiOperation({ summary: 'Заменить список шаблонов целиком' })
  @Roles(Role.HEAD, Role.ADMIN)
  @Put()
  async put(@Body() dto: QuickRepliesDto, @CurrentUser('id') userId: number) {
    const items = dto.items.map((i) => ({
      title: i.title.trim(),
      text: i.text.trim(),
    }));
    return this.audit.wrap(
      {
        userId,
        action: 'quick_replies.update',
        payload: { count: items.length },
      },
      async () => {
        const value = JSON.stringify(items);
        await this.prisma.setting.upsert({
          where: { key: QUICK_REPLIES_KEY },
          create: { key: QUICK_REPLIES_KEY, value, updatedAt: this.clock.ts() },
          update: { value, updatedAt: this.clock.ts() },
        });
        return { items };
      },
    );
  }
}
