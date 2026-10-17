import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  ForbiddenException,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OperatorService } from './operator.service';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { AuditService } from 'src/shared/audit.service';
import { GlobalGateService } from 'src/shared/global-gate.service';
import { RegionGateService } from 'src/shared/region-gate.service';
import { RegionStopDto } from 'src/modules/photo-sets/photo-sets.dto';
import { DashboardUser } from '@prisma/client';
import { RelayDto, TakeoverDto, TicketDto } from './dto/operator.dto';

@ApiTags('Operator')
@ApiBearerAuth()
@Auth()
@Roles(Role.MANAGER)
@Controller('api/operator')
export class OperatorController {
  constructor(
    private readonly operator: OperatorService,
    private readonly audit: AuditService,
    private readonly gate: GlobalGateService,
    private readonly regionGate: RegionGateService,
  ) {}

  /** Регион, которым распоряжается пользователь: хед — своим, админ — любым. */
  private stopRegion(user: DashboardUser, requested?: string): string {
    if (user.role === Role.ADMIN) {
      const region = requested?.trim();
      if (!region) throw new BadRequestException('укажите регион');
      return region;
    }
    if (user.role !== Role.HEAD || !user.regionCode)
      throw new ForbiddenException('остановить регион может только его хед');
    return user.regionCode;
  }

  @ApiOperation({
    summary: 'Стоп региона: включён ли у своего региона (админу — список всех)',
  })
  @Get('region-stop')
  async regionStopStatus(@CurrentUser() user: DashboardUser) {
    const stops = await this.regionGate.list();
    if (user.role === Role.ADMIN)
      return { region_code: null, engaged: false, can_manage: true, stops };
    const own = stops.find((s) => s.region_code === user.regionCode) ?? null;
    return {
      region_code: user.regionCode,
      engaged: Boolean(own),
      reason: own?.reason ?? null,
      since: own?.created_at ?? null,
      can_manage: user.role === Role.HEAD && Boolean(user.regionCode),
    };
  }

  @ApiOperation({
    summary:
      'Экстренно остановить автоматику региона: бот, рассылка, войсер (хед)',
  })
  @Roles(Role.HEAD)
  @Post('region-stop')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async regionStopEngage(
    @Body() dto: RegionStopDto,
    @CurrentUser() user: DashboardUser,
  ) {
    const region = this.stopRegion(user, dto.region_code);
    await this.audit.wrap(
      {
        userId: user.id,
        action: 'operator.region_stop_engage',
        resource: `region:${region}`,
        payload: { reason: dto.reason ?? null },
      },
      () => this.regionGate.engage(region, user.id, dto.reason),
    );
    return { region_code: region, engaged: true };
  }

  @Roles(Role.HEAD)
  @Delete('region-stop')
  @HttpCode(200)
  async regionStopClear(
    @CurrentUser() user: DashboardUser,
    @Query('region') requested?: string,
  ) {
    const region = this.stopRegion(user, requested);
    await this.audit.wrap(
      {
        userId: user.id,
        action: 'operator.region_stop_clear',
        resource: `region:${region}`,
      },
      () => this.regionGate.clear(region),
    );
    return { region_code: region, engaged: false };
  }

  @ApiOperation({
    summary: 'Take the chat over; returns the ticket to echo on relay/resume',
  })
  @Post('takeover')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async takeover(@Body() dto: TakeoverDto, @CurrentUser('id') userId: number) {
    return this.audit.wrap(
      { userId, action: 'operator.takeover', resource: `chat:${dto.chat}` },
      () => this.operator.takeover(dto.persona, dto.chat, dto.operator),
    );
  }

  @ApiOperation({
    summary: 'Relay free text to the client under an active ticket',
  })
  @Post('relay')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async relay(@Body() dto: RelayDto, @CurrentUser('id') userId: number) {
    const deferredId = await this.audit.wrap(
      { userId, action: 'operator.relay', resource: `chat:${dto.chat}` },
      () => this.operator.relayText(dto, dto.text),
    );
    return { deferred_id: deferredId };
  }

  @ApiOperation({ summary: 'Return the chat to the bot under the ticket' })
  @Post('resume')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async resume(@Body() dto: TicketDto, @CurrentUser('id') userId: number) {
    await this.audit.wrap(
      { userId, action: 'operator.resume', resource: `chat:${dto.chat}` },
      () => this.operator.resume(dto),
    );
    return { status: 'resumed' };
  }

  @ApiOperation({
    summary: 'Typed pause state of a chat (why the bot is silent)',
  })
  @Get('status/:chatId')
  async status(@Param('chatId', ParseIntPipe) chatId: number) {
    return this.operator.status(chatId);
  }

  @ApiOperation({ summary: 'Pending operator actions of a chat' })
  @Get('pending')
  async pending(@Query('chat', ParseIntPipe) chat: number) {
    return this.operator.pending(chat);
  }

  @ApiOperation({ summary: 'Emergency stop: silence the whole fleet (admin)' })
  @Roles(Role.ADMIN)
  @Post('emergency-stop')
  @HttpCode(200)
  async emergencyEngage(
    @Query('actor') actor: string,
    @CurrentUser('id') userId: number,
  ) {
    await this.audit.wrap(
      { userId, action: 'operator.emergency_stop_engage', resource: actor },
      async () => this.gate.engage(actor || String(userId)),
    );
    return { engaged: true };
  }

  @Roles(Role.ADMIN)
  @Delete('emergency-stop')
  @HttpCode(200)
  async emergencyClear(
    @Query('actor') actor: string,
    @CurrentUser('id') userId: number,
  ) {
    await this.audit.wrap(
      { userId, action: 'operator.emergency_stop_clear', resource: actor },
      async () => this.gate.clear(),
    );
    return { engaged: false };
  }

  @Roles(Role.ADMIN)
  @Get('emergency-stop')
  async emergencyStatus() {
    const snap = this.gate.status();
    return { engaged: snap.stopped, reason: snap.reason };
  }
}
