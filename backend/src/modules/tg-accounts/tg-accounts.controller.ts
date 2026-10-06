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
  Req,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { TgAccountsService } from './tg-accounts.service';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { AuditService } from 'src/shared/audit.service';
import { PresenceService } from 'src/shared/presence.service';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { LoginService } from '../telegram/login.service';
import { ScopeService } from 'src/shared/scope.service';
import { ManagerAttributionService } from 'src/shared/manager-attribution.service';
import { DashboardUser } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import {
  AddTgAccountDto,
  TgPrivacyDto,
  SetProxyDto,
  SetStatusDto,
  SmsCodeDto,
  StartAuthDto,
  TwoFaDto,
  UpdateTgAccountDto,
  UpdateTgProfileDto,
} from './dto/tg-account.dto';

@ApiTags('Telegram accounts')
@ApiBearerAuth()
@Auth()
@Roles(Role.MANAGER)
@Controller('api')
export class TgAccountsController {
  constructor(
    private readonly accounts: TgAccountsService,
    private readonly login: LoginService,
    private readonly audit: AuditService,
    private readonly presence: PresenceService,
    private readonly scope: ScopeService,
    private readonly attribution: ManagerAttributionService,
  ) {}

  private async own(user: DashboardUser, id: number): Promise<void> {
    const accounts = await this.scope.accountsFilter(user);
    if (accounts !== null && !accounts.includes(id))
      throw new NotFoundException('аккаунт не найден');
  }

  private async ownJob(user: DashboardUser, jobId: string): Promise<void> {
    let accountId: number | null = null;
    try {
      accountId = this.login.get(jobId).account_id;
    } catch {
      return;
    }
    await this.own(user, accountId);
  }

  @ApiOperation({ summary: 'Фото профиля Telegram-аккаунта' })
  @Get('tg-accounts/:id/avatar')
  async avatar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: DashboardUser,
    @Res() res: Response,
  ) {
    await this.own(user, id);
    const path = this.presence.accountAvatarPath(id);
    if (!existsSync(path)) {
      res.status(404).json({ statusCode: 404, message: 'аватарки нет' });
      return;
    }
    res.type('image/jpeg');
    res.setHeader('cache-control', 'private, max-age=86400');
    res.sendFile(path);
  }

  @ApiOperation({ summary: 'List accounts' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'persona_id', required: false })
  @ApiQuery({ name: 'purpose', required: false })
  @Get('tg-accounts')
  async list(
    @CurrentUser() user: DashboardUser,
    @Query('status') status?: string,
    @Query('persona_id') persona_id?: string,
    @Query('purpose') purpose?: string,
  ) {
    const rows = await this.accounts.list({ status, persona_id, purpose });
    const accounts = await this.scope.accountsFilter(user);
    const visible =
      accounts === null ? rows : rows.filter((a) => accounts.includes(a.id));
    const directory = await this.attribution.directory();
    return visible.map((account) => ({
      ...account,
      ...directory.forAccount(account.id),
    }));
  }

  @ApiOperation({
    summary:
      'Register an account (unauthorized until the login wizard completes)',
  })
  @Post('tg-accounts')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  add(@Body() dto: AddTgAccountDto, @CurrentUser() user: DashboardUser) {
    const owner = user.role === Role.ADMIN ? null : user.id;
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'tg_account.add',
        resource: `tg_account:${dto.phone_e164}`,
      },
      () => this.accounts.add(dto, owner),
    );
  }

  @ApiOperation({ summary: 'Имя и ник аккаунта в самом Telegram' })
  @Put('tg-accounts/:id/profile')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async updateProfile(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTgProfileDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.own(user, id);
    const userId = user.id;
    return this.audit.wrap(
      {
        userId,
        action: 'tg_account.profile',
        resource: `tg_account:${id}`,
        payload: dto,
      },
      () => this.accounts.updateProfile(id, dto),
    );
  }

  @ApiOperation({
    summary:
      'Скрыт ли «был в сети» у аккаунта (настройка приватности Telegram)',
  })
  @Get('tg-accounts/:id/privacy')
  async privacy(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.own(user, id);
    return this.accounts.privacy(id);
  }

  @ApiOperation({ summary: 'Скрыть или показать «был в сети»' })
  @Put('tg-accounts/:id/privacy')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async setPrivacy(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TgPrivacyDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.own(user, id);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'tg_account.privacy',
        resource: `tg_account:${id}`,
        payload: dto,
      },
      () => this.accounts.setPrivacy(id, dto.hide_last_seen),
    );
  }

  @ApiOperation({
    summary: 'Фото профиля аккаунта в Telegram (тело — картинка)',
  })
  @Post('tg-accounts/:id/avatar')
  @HttpCode(200)
  async setAvatar(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { body: Buffer },
    @CurrentUser() user: DashboardUser,
  ) {
    await this.own(user, id);
    const userId = user.id;
    return this.audit.wrap(
      { userId, action: 'tg_account.avatar', resource: `tg_account:${id}` },
      () => this.accounts.setAvatar(id, req.body),
    );
  }

  @ApiOperation({ summary: 'Изменить аккаунт: личность, назначение, лимит' })
  @Put('tg-accounts/:id')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTgAccountDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.own(user, id);
    const userId = user.id;
    return this.audit.wrap(
      {
        userId,
        action: 'tg_account.update',
        resource: `tg_account:${id}`,
        payload: dto,
      },
      () => this.accounts.update(id, dto),
    );
  }

  @ApiOperation({
    summary: 'Top-bar live state: accounts, heartbeat, counters',
  })
  @Roles(Role.ADMIN)
  @Get('state')
  state() {
    return this.accounts.liveState();
  }

  @ApiOperation({ summary: 'Poll the login job' })
  @Get('tg-accounts/auth/:jobId')
  async authStatus(
    @Param('jobId') jobId: string,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.ownJob(user, jobId);
    return this.login.status(jobId);
  }

  @ApiOperation({ summary: 'Supply the SMS/app code' })
  @Post('tg-accounts/auth/:jobId/sms-code')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async smsCode(
    @Param('jobId') jobId: string,
    @Body() dto: SmsCodeDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.ownJob(user, jobId);
    return this.login.supplyCode(jobId, dto.code);
  }

  @ApiOperation({ summary: 'Supply the 2FA password' })
  @Post('tg-accounts/auth/:jobId/2fa')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async twoFa(
    @Param('jobId') jobId: string,
    @Body() dto: TwoFaDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.ownJob(user, jobId);
    return this.login.supplyPassword(jobId, dto.password);
  }

  @ApiOperation({ summary: 'Cancel the login job' })
  @Delete('tg-accounts/auth/:jobId')
  @HttpCode(200)
  async cancelAuth(
    @Param('jobId') jobId: string,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.ownJob(user, jobId);
    const snap = this.login.cancel(jobId);
    void this.audit.log({
      userId: user.id,
      action: 'tg_account.auth',
      resource: `job:${jobId}`,
      error: 'cancelled',
    });
    return snap;
  }

  @ApiOperation({
    summary: 'Start the login wizard: phone → code → 2FA, or scan a QR code',
  })
  @Post('tg-accounts/:id/auth')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async startAuth(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StartAuthDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.own(user, id);
    const userId = user.id;
    const method = dto.method ?? 'phone';
    return this.audit.wrap(
      {
        userId,
        action: 'tg_account.auth',
        resource: `tg_account:${id}`,
        payload: { method },
      },
      () => this.login.start(id, method),
    );
  }

  @ApiOperation({ summary: 'Attach a proxy (stored encrypted)' })
  @Post('tg-accounts/:id/set-proxy')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async setProxy(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetProxyDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.own(user, id);
    const userId = user.id;
    return this.audit.wrap(
      { userId, action: 'tg_account.set_proxy', resource: `tg_account:${id}` },
      () => this.accounts.setProxy(id, dto.proxy_config),
    );
  }

  @ApiOperation({ summary: 'Переподключить аккаунт к Telegram' })
  @Post('tg-accounts/:id/reconnect')
  @HttpCode(200)
  async reconnect(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.own(user, id);
    const userId = user.id;
    return this.audit.wrap(
      { userId, action: 'tg_account.reconnect', resource: `tg_account:${id}` },
      () => this.accounts.reconnect(id),
    );
  }

  @ApiOperation({
    summary: 'Снять метку флуда: аккаунт снова берёт новых лидов',
  })
  @Post('tg-accounts/:id/clear-flood')
  @HttpCode(200)
  async clearFlood(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.own(user, id);
    const userId = user.id;
    return this.audit.wrap(
      {
        userId,
        action: 'tg_account.clear_flood',
        resource: `tg_account:${id}`,
      },
      () => this.accounts.clearFlood(id),
    );
  }

  @ApiOperation({
    summary: 'Change status: active connects, anything else disconnects',
  })
  @Put('tg-accounts/:id/status')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetStatusDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.own(user, id);
    const userId = user.id;
    return this.audit.wrap(
      { userId, action: 'tg_account.set_status', resource: `tg_account:${id}` },
      () => this.accounts.setStatus(id, dto.status, dto.reason),
    );
  }

  @ApiOperation({ summary: 'Remove the account; its chats stay, ownerless' })
  @Delete('tg-accounts/:id')
  @HttpCode(200)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.own(user, id);
    const userId = user.id;
    return this.audit.wrap(
      { userId, action: 'tg_account.delete', resource: `tg_account:${id}` },
      () => this.accounts.remove(id),
    );
  }
}
