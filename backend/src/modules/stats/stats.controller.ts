import {
  Body,
  Controller,
  ForbiddenException,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { StatsService } from './stats.service';
import { BalanceService } from './balance.service';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { AuditService } from 'src/shared/audit.service';
import { DashboardUser } from '@prisma/client';

@ApiTags('Stats')
@ApiBearerAuth()
@Auth()
@Roles(Role.ADMIN)
@Controller('api/stats')
export class StatsController {
  constructor(
    private readonly stats: StatsService,
    private readonly balance: BalanceService,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({ summary: 'Сводка за период: расход, токены, кеш, сообщения' })
  @ApiQuery({ name: 'from', required: false, example: '2026-09-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-09-10' })
  @Get()
  overview(@Query('from') from?: string, @Query('to') to?: string) {
    return this.stats.overview({ from, to });
  }

  @ApiOperation({
    summary: 'Расход и переписка по менеджерам: итог за период и дни',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-09-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-09-10' })
  @Get('managers')
  managers(@Query('from') from?: string, @Query('to') to?: string) {
    return this.stats.byManager({ from, to });
  }

  @ApiOperation({ summary: 'Этапы сделки по дням: сколько чатов вошло в этап' })
  @ApiQuery({ name: 'from', required: false, example: '2026-09-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-09-10' })
  @Get('stages')
  stages(@Query('from') from?: string, @Query('to') to?: string) {
    return this.stats.dealStages({ from, to });
  }

  @ApiOperation({
    summary:
      'Холодка: получено, написали, ответили, активные — всего и по менеджерам',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-09-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-09-10' })
  @Get('cold')
  cold(@Query('from') from?: string, @Query('to') to?: string) {
    return this.stats.coldLeads({ from, to });
  }

  @ApiOperation({
    summary:
      'Лиды по источнику трафика: по регионам, статусам и этапам; фильтр source',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-10-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-10-31' })
  @ApiQuery({
    name: 'source',
    required: false,
    description: 'base | hot_leadgen | cold_leadgen | none; пусто — все',
  })
  @Get('sources')
  sources(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('source') source?: string,
  ) {
    return this.stats.sources({ from, to, source, withCost: true });
  }

  @ApiOperation({
    summary:
      'Аккаунты: сколько добавили и сколько слетело (TG и VK) по менеджерам и командам',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-10-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-10-31' })
  @Get('accounts')
  accounts(@Query('from') from?: string, @Query('to') to?: string) {
    return this.stats.accounts({ from, to });
  }

  @ApiOperation({ summary: 'Расход одного чата' })
  @Get('chat/:chatId')
  forChat(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Query('days') days?: string,
  ) {
    return this.stats.forChat(
      chatId,
      days ? Math.min(Math.max(Number(days), 1), 400) : 30,
    );
  }

  @ApiOperation({
    summary: 'Цена диалога: сейчас и к каждому этапу сделки',
  })
  @Get('chat/:chatId/cost')
  chatCost(@Param('chatId', ParseIntPipe) chatId: number) {
    return this.stats.chatCost(chatId);
  }

  @ApiOperation({
    summary:
      'Средняя цена диалога к этапу: по чатам, дошедшим до этапа в периоде',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-10-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-10-31' })
  @Get('stage-costs')
  stageCosts(@Query('from') from?: string, @Query('to') to?: string) {
    return this.stats.stageCosts({ from, to });
  }

  @ApiOperation({ summary: 'Баланс ключа OpenRouter' })
  @Get('balance')
  balanceOpenRouter() {
    return this.balance.openRouter();
  }

  @ApiOperation({ summary: 'Таблица цен (или умолчания)' })
  @Get('prices')
  prices() {
    return this.stats.prices();
  }

  @ApiOperation({ summary: 'Сохранить свою таблицу цен' })
  @Put('prices')
  @HttpCode(200)
  putPrices(@Body() body: unknown, @CurrentUser('id') userId: number) {
    return this.audit.wrap({ userId, action: 'stats.prices' }, () =>
      this.stats.putPrices(body),
    );
  }

  @ApiOperation({ summary: 'Вернуть цены по умолчанию' })
  @Delete('prices')
  @HttpCode(200)
  resetPrices(@CurrentUser('id') userId: number) {
    return this.audit.wrap({ userId, action: 'stats.prices_reset' }, () =>
      this.stats.resetPrices(),
    );
  }
}

/**
 * Статистика региона — для хедов. Админская «Статистика» им закрыта: там
 * все регионы, цены и баланс. Хед видит только свой регион, админ — любой.
 */
@ApiTags('Stats')
@ApiBearerAuth()
@Auth()
@Roles(Role.HEAD)
@Controller('api/region-stats')
export class RegionStatsController {
  constructor(private readonly stats: StatsService) {}

  @ApiOperation({
    summary:
      'Регион: расход и номера по менеджерам, этапы, холодка, тип трафика',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-10-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-10-31' })
  @ApiQuery({ name: 'region', required: false, description: 'только админу' })
  @Get()
  async region(
    @CurrentUser() user: DashboardUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('region') requested?: string,
  ) {
    const regions = user.role === Role.ADMIN ? await this.stats.regions() : [];
    const region =
      user.role === Role.ADMIN
        ? requested?.trim() && regions.includes(requested.trim())
          ? requested.trim()
          : (regions[0] ?? null)
        : user.regionCode;
    if (!region)
      throw new ForbiddenException(
        'у вас не указан регион — статистика недоступна',
      );
    return { ...(await this.stats.region({ from, to, region })), regions };
  }
}
