import { VoicerCallService } from './voicer-call.service';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { DashboardUser } from '@prisma/client';
import { Response } from 'express';
import { Auth } from 'src/decorators/auth.decorator';
import { CurrentUser } from 'src/decorators/user.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { AuditService } from 'src/shared/audit.service';
import { VoicerService } from './voicer.service';
import { VoicerBotService } from './voicer-bot.service';
import {
  CreateVoiceTaskDto,
  SendRecordingDto,
  RecordingTitleDto,
  VoiceTaskActionDto,
  VoiceTaskChatDto,
} from './voicer.dto';
import { VoicerChatService } from './voicer-chat.service';
import { VoicerBriefService } from './voicer-brief.service';

const pageNumber = (value?: string) =>
  Math.max(1, Math.min(10000, Number.parseInt(value ?? '1', 10) || 1));

@Auth()
@Roles(Role.MANAGER, Role.VOICE)
@Controller('api/voicer')
export class VoicerController {
  constructor(
    private voicer: VoicerService,
    private bot: VoicerBotService,
    private audit: AuditService,
    private chats: VoicerChatService,
    private calls: VoicerCallService,
    private briefs: VoicerBriefService,
  ) {}

  @Get('tasks/:id/brief')
  @Header('Cache-Control', 'private, no-store')
  brief(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.briefs.get(user, id);
  }

  @Post('tasks/:id/call/ticket')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  callTicket(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'voicer.call_start',
        resource: `voice_task:${id}`,
      },
      () => this.calls.ticket(user, id),
    );
  }

  @Get('tasks/:id/call')
  @Header('Cache-Control', 'private, no-store')
  callStatus(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.calls.status(user, id);
  }

  @Get('conversations')
  @Roles(Role.MANAGER)
  choices(
    @CurrentUser() user: DashboardUser,
    @Query('manager_id') manager?: string,
    @Query('persona') persona = '',
    @Query('q') q = '',
  ) {
    return this.chats.choices(
      user,
      Number(manager),
      String(persona).slice(0, 100),
      String(q).trim().slice(0, 160),
    );
  }

  @Get('tasks/:id/conversation')
  @Header('Cache-Control', 'private, no-store')
  conversation(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('before', new ParseIntPipe({ optional: true })) before?: number,
  ) {
    return this.chats.conversation(user, id, before);
  }

  @Put('tasks/:id/conversation')
  @Roles(Role.MANAGER)
  linkChat(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoiceTaskChatDto,
  ) {
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'voicer.chat_link',
        resource: `voice_task:${id}`,
      },
      () => this.chats.link(user, id, dto.chat_id),
    );
  }

  @Get('tasks/:id/conversation/files/:messageId')
  async chatFile(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Res() response: Response,
  ) {
    const path = await this.chats.attachment(user, id, messageId);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "sandbox; default-src 'none'",
    );
    response.setHeader('Content-Disposition', 'attachment');
    response.sendFile(path);
  }

  @Get('send-targets')
  @Roles(Role.MANAGER)
  sendTargets(@CurrentUser() user: DashboardUser, @Query('q') q = '') {
    return this.chats.sendTargets(user, String(q).trim().slice(0, 160));
  }

  @Get('notices')
  @Roles(Role.MANAGER)
  @Header('Cache-Control', 'private, no-store')
  notices(@CurrentUser() user: DashboardUser) {
    return this.voicer.notices(user);
  }

  @Post('notices/:id/read')
  @Roles(Role.MANAGER)
  @HttpCode(200)
  readNotice(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.voicer.readNotice(user, id);
  }

  @Post('recordings/:id/send')
  @Roles(Role.MANAGER)
  @HttpCode(200)
  send(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendRecordingDto,
  ) {
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'voicer.recording_send',
        resource: `voice_recording:${id}`,
      },
      () => this.voicer.sendRecording(user, id, dto.chat_id, dto.request_id),
    );
  }

  @Get('deliveries/:id')
  @Roles(Role.MANAGER)
  delivery(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.voicer.deliveryDetail(user, id);
  }

  @Post('deliveries/:id/retry')
  @Roles(Role.MANAGER)
  @HttpCode(200)
  retry(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'voicer.delivery_retry',
        resource: `voice_delivery:${id}`,
      },
      () => this.voicer.retryDelivery(user, id),
    );
  }

  @Get('options')
  async options(@CurrentUser() user: DashboardUser) {
    return { ...(await this.voicer.options(user)), bot: this.bot.status() };
  }

  @Get('tasks')
  list(
    @CurrentUser() user: DashboardUser,
    @Query('status') status = 'active',
    @Query('q') q = '',
    @Query('page') page?: string,
  ) {
    return this.voicer.list(
      user,
      status,
      String(q).slice(0, 160),
      pageNumber(page),
    );
  }

  @Post('tasks')
  @HttpCode(200)
  @Roles(Role.MANAGER)
  create(@CurrentUser() user: DashboardUser, @Body() dto: CreateVoiceTaskDto) {
    return this.audit.wrap(
      { userId: user.id, action: 'voicer.task_create' },
      () => this.voicer.create(user, dto),
    );
  }

  @Get('tasks/:id')
  async detail(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.voicer.publicTask(await this.voicer.task(user, id), true);
  }

  @Post('tasks/:id/action')
  @HttpCode(200)
  action(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoiceTaskActionDto,
  ) {
    return this.audit.wrap(
      {
        userId: user.id,
        action: `voicer.${dto.action}`,
        resource: `voice_task:${id}`,
      },
      () => this.voicer.action(user, id, dto),
    );
  }

  @Post('users/:id/link')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  link(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.audit.wrap(
      { userId: user.id, action: 'voicer.link_create', resource: `user:${id}` },
      () => this.voicer.link(user, id, this.bot.username),
    );
  }

  @Post('users/:id/disconnect')
  @HttpCode(200)
  disconnect(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.audit.wrap(
      { userId: user.id, action: 'voicer.disconnect', resource: `user:${id}` },
      () => this.voicer.disconnect(user, id),
    );
  }

  @Get('recordings')
  recordings(
    @CurrentUser() user: DashboardUser,
    @Query('q') q = '',
    @Query('page') page?: string,
  ) {
    return this.voicer.recordings(
      user,
      String(q).slice(0, 160),
      pageNumber(page),
    );
  }

  @Get('recordings/:id/file')
  async file(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    const file = await this.voicer.file(user, id);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="voice-${id}.ogg"; filename*=UTF-8''${encodeURIComponent(file.title + '.ogg')}`,
    );
    response.type('audio/ogg').send(file.data);
  }

  @Put('recordings/:id')
  @Roles(Role.MANAGER)
  rename(
    @CurrentUser() user: DashboardUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecordingTitleDto,
  ) {
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'voicer.recording_rename',
        resource: `voice_recording:${id}`,
      },
      () => this.voicer.rename(user, id, dto.title),
    );
  }
}
