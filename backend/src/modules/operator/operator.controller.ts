import {
  Body,
  Controller,
  Delete,
  Get,
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
  ) {}

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
