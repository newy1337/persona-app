import {
  Body,
  Controller,
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
