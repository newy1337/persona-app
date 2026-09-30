import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardUser } from '@prisma/client';
import { LeadScope, LeadsService } from './leads.service';
import { OutreachWorker } from './outreach.worker';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { ScopeService } from 'src/shared/scope.service';
import { AuditService } from 'src/shared/audit.service';
import {
  CreateLeadDto,
  ImportLeadsDto,
  LeadIdsDto,
  ListLeadsQuery,
  UpdateLeadDto,
} from './dto/lead.dto';

@ApiTags('Leads')
@ApiBearerAuth()
@Auth()
@Roles(Role.MANAGER)
@Controller('api/leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly outreach: OutreachWorker,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  private async leadScope(user: DashboardUser): Promise<LeadScope | null> {
    const accounts = await this.scope.accountsFilter(user);
    return accounts === null ? null : { userId: user.id, accounts };
  }

  @ApiOperation({ summary: 'Leads in scope with per-status counts' })
  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async list(
    @Query() query: ListLeadsQuery,
    @CurrentUser() user: DashboardUser,
  ) {
    const scope = await this.leadScope(user);
    return this.leads.list(scope, query);
  }

  @ApiOperation({
    summary:
      'Личности для выбора у лида и сколько у каждой аккаунтов в рассылке',
  })
  @Get('personas')
  async personas(@CurrentUser() user: DashboardUser) {
    return this.outreach.personaChoices(await this.scope.accountsFilter(user));
  }

  @ApiOperation({
    summary: 'Outreach worker status: limits, hours, per-account usage today',
  })
  @Get('outreach')
  async outreachStatus(@CurrentUser() user: DashboardUser) {
    return this.outreach.status(await this.scope.accountsFilter(user));
  }

  @ApiOperation({ summary: 'Add one lead' })
  @Post()
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async create(@Body() dto: CreateLeadDto, @CurrentUser() user: DashboardUser) {
    const scope = await this.leadScope(user);
    return this.audit.wrap(
      { userId: user.id, action: 'lead.create', resource: dto.phone },
      () => this.leads.create(dto, user.id, scope),
    );
  }

  @ApiOperation({
    summary: 'Import many leads (pasted text and/or items); duplicates skipped',
  })
  @Post('import')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async import(
    @Body() dto: ImportLeadsDto,
    @CurrentUser() user: DashboardUser,
  ) {
    const scope = await this.leadScope(user);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'lead.import',
        payload: {
          items: dto.items?.length ?? 0,
          text_chars: dto.text?.length ?? 0,
        },
      },
      () => this.leads.import(dto, user.id, scope),
    );
  }

  @ApiOperation({
    summary: 'Queue leads for outreach (ids or every pending lead in scope)',
  })
  @Post('start')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async start(@Body() dto: LeadIdsDto, @CurrentUser() user: DashboardUser) {
    const scope = await this.leadScope(user);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'lead.queue',
        payload: { ids: dto.ids ?? 'all_pending' },
      },
      () => this.leads.queue(scope, dto.ids),
    );
  }

  @ApiOperation({ summary: 'Pull queued leads back to pending' })
  @Post('stop')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async stop(@Body() dto: LeadIdsDto, @CurrentUser() user: DashboardUser) {
    const scope = await this.leadScope(user);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'lead.unqueue',
        payload: { ids: dto.ids ?? 'all_queued' },
      },
      () => this.leads.unqueue(scope, dto.ids),
    );
  }

  @ApiOperation({
    summary:
      'Написать с другого аккаунта: лид снова в очередь, текущий аккаунт его не возьмёт',
  })
  @Post(':id/write-from-another')
  @HttpCode(200)
  async writeFromAnother(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: DashboardUser,
  ) {
    const scope = await this.leadScope(user);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'lead.write_from_another',
        resource: `lead:${id}`,
      },
      () => this.leads.writeFromAnother(scope, id),
    );
  }

  @ApiOperation({ summary: 'Edit lead card fields' })
  @Put(':id')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() user: DashboardUser,
  ) {
    const scope = await this.leadScope(user);
    return this.audit.wrap(
      { userId: user.id, action: 'lead.update', resource: `lead:${id}` },
      () => this.leads.update(scope, id, dto),
    );
  }

  @ApiOperation({
    summary:
      'Удалить лида вместе с его чатом в панели — добавленный снова начнёт с нуля',
  })
  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Query('telegram') telegram: string | undefined,
    @CurrentUser() user: DashboardUser,
  ) {
    const scope = await this.leadScope(user);
    const deleteTelegram = telegram === '1' || telegram === 'true';
    const r = await this.audit.wrap(
      {
        userId: user.id,
        action: 'lead.delete',
        resource: `lead:${id}`,
        payload: { telegram: deleteTelegram },
      },
      () => this.leads.remove(scope, id, { deleteTelegram }),
    );
    return { ok: true, ...r };
  }
}
