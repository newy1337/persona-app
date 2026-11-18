import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { DashboardUser } from '@prisma/client';
import { ManagerService } from './manager.service';
import { ConversationPageQuery } from './conversation-page.dto';
import { resolveRange } from 'src/modules/stats/range';
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
    if (active === '1')
      return { items: await this.manager.activeConversations(accounts) };
    if (hidden === '1') {
      const rows = await this.manager.conversations(accounts, {
        includeHidden: true,
      });
      return { items: rows.filter((r) => r.hidden) };
    }
    const rows = await this.manager.conversations(accounts);
    return {
      items: rows,
      total: await this.manager.conversationsTotal(accounts),
    };
  }

  @ApiOperation({
    summary:
      'Page of my chats with server-side filters, sort and filter counts over all chats',
  })
  @Get('conversations/page')
  async conversationPage(
    @CurrentUser() user: DashboardUser,
    @Query() query: ConversationPageQuery,
  ) {
    const accounts = await this.scope.accountsFilter(user);
    const range =
      query.from || query.to
        ? resolveRange({ from: query.from, to: query.to }, this.clock.ts())
        : null;
    return this.manager.conversationPage(accounts, {
      archive: query.archive === '1',
      page: Number(query.page) || 1,
      size: Math.min(Math.max(Number(query.size) || 50, 1), 200),
      filter: {
        q: query.q,
        channel: query.channel,
        deal: query.deal,
        stage: query.stage,
        only_new: query.new === '1',
        lead: query.lead,
        account: query.account,
        since: range?.start,
        until: range?.end,
        sort: query.sort,
        dir: query.dir,
      },
    });
  }

  @ApiOperation({
    summary: 'Stat tiles over my accounts; from/to narrow them to a period',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-10-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-10-07' })
  @Get('stats')
  async stats(
    @CurrentUser() user: DashboardUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const accounts = await this.scope.accountsFilter(user);
    return this.manager.stats(accounts, { from, to });
  }
}
