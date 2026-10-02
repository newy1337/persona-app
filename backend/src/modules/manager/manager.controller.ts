import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { DashboardUser } from '@prisma/client';
import { ManagerService, ACTIVE_WINDOW_S } from './manager.service';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { ScopeService } from 'src/shared/scope.service';
import { ClockService } from 'src/shared/clock.service';

@ApiTags('Manager')
@ApiBearerAuth()
@Auth()
@Roles(Role.MANAGER)
@Controller('api/manager')
export class ManagerController {
  constructor(
    private readonly manager: ManagerService,
    private readonly scope: ScopeService,
    private readonly clock: ClockService,
  ) {}

  @ApiOperation({ summary: 'Chats waiting for a person, with the reason' })
  @Get('queue')
  async queue(@CurrentUser() user: DashboardUser) {
    const accounts = await this.scope.accountsFilter(user);
    return { items: await this.manager.queue(accounts) };
  }

  @ApiOperation({
    summary: 'My chats. ?active=1 — last 24h; ?hidden=1 — only manually hidden',
  })
  @ApiQuery({ name: 'active', required: false })
  @ApiQuery({ name: 'hidden', required: false })
  @Get('conversations')
  async conversations(
    @CurrentUser() user: DashboardUser,
    @Query('active') active?: string,
    @Query('hidden') hidden?: string,
  ) {
    const accounts = await this.scope.accountsFilter(user);
    if (hidden === '1') {
      const rows = await this.manager.conversations(accounts, {
        includeHidden: true,
      });
      return { items: rows.filter((r) => r.hidden) };
    }
    let rows = await this.manager.conversations(accounts);
    if (active === '1') {
      const cutoff = this.clock.ts() - ACTIVE_WINDOW_S;
      rows = rows.filter((r) => r.last_message_ts >= cutoff);
    }
    return {
      items: rows,
      total: await this.manager.conversationsTotal(accounts),
    };
  }

  @ApiOperation({ summary: 'Stat tiles over my accounts' })
  @Get('stats')
  async stats(@CurrentUser() user: DashboardUser) {
    const accounts = await this.scope.accountsFilter(user);
    return this.manager.stats(accounts);
  }
}
