import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { DashboardUser } from '@prisma/client';
import { ConversationsService } from './conversations.service';
import { ChatExportService } from './chat-export.service';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { ScopeService } from 'src/shared/scope.service';
import { AuditService } from 'src/shared/audit.service';
import {
  ChatNoteDto,
  EditMessageDto,
  ExportDto,
  ManualMessageDto,
  PinFactDto,
  SetSlotDto,
  SetStageDto,
} from './dto/conversation.dto';
import {
  ReactionDto,
  SendAlbumDto,
  SendAttachmentDto,
  StickerDto,
} from './dto/attachment.dto';
import { UploadsService } from '../media/uploads.service';
import { kindForFile } from 'src/domain/attachments';
import type { Request } from 'express';
import { Req, UnprocessableEntityException } from '@nestjs/common';

/**
 * Per-chat reads and mutations. Ownership is checked on EVERY `:chatId`
 * route; collection routes are admin-only (managers have /api/manager/*).
 */
@ApiTags('Conversations')
@ApiBearerAuth()
@Auth()
@Roles(Role.MANAGER)
@Controller('api/conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
    private readonly chatExport: ChatExportService,
  ) {}

  /**
   * Файл вложения сырым телом: base64 в JSON раздул бы 50 МБ до 67, а
   * multipart потянул бы ещё одну зависимость ради одной ручки.
   */
  @ApiOperation({
    summary: 'Загрузить файл для отправки: сырое тело, имя в query',
  })
  @Post(':chatId/upload')
  @HttpCode(200)
  async upload(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Query('name') name: string,
    @Req() req: Request,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data))
      throw new UnprocessableEntityException('ожидается сырое тело файла');
    const path = this.uploads.save(chatId, name || 'file', data);
    return {
      path,
      kind: kindForFile(name || '', req.headers['content-type'] ?? ''),
      bytes: data.length,
    };
  }

  @ApiOperation({ summary: 'Отправить вложение: файл, ссылку или стикер' })
  @Post(':chatId/attachment')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async attachment(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: SendAttachmentDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.attachment',
        resource: `chat:${chatId}`,
        payload: { kind: dto.kind },
      },
      () => this.conversations.sendAttachment(chatId, dto),
    );
  }

  @ApiOperation({ summary: 'Все фото и видео чата — вкладка «Медиа»' })
  @Get(':chatId/media-gallery')
  async mediaGallery(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.conversations.mediaGallery(chatId);
  }

  @ApiOperation({ summary: 'Несколько фото и видео одним альбомом' })
  @Post(':chatId/album')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async album(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: SendAlbumDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.album',
        resource: `chat:${chatId}`,
        payload: { files: dto.sources.length },
      },
      () => this.conversations.sendAlbum(chatId, dto),
    );
  }

  @ApiOperation({
    summary: 'Поставить или снять реакцию на сообщение собеседника',
  })
  @Post(':chatId/reaction')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async reaction(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: ReactionDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.reaction',
        resource: `chat:${chatId}`,
      },
      () => this.conversations.reaction(chatId, dto.message_id, dto.emoji),
    );
  }

  @ApiOperation({ summary: 'Отправить стикер из набора аккаунта' })
  @Post(':chatId/sticker')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async sticker(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: StickerDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.sticker',
        resource: `chat:${chatId}`,
      },
      () =>
        this.conversations.sendAttachment(chatId, {
          kind: 'sticker',
          source: dto.file_id,
          reply_to: dto.reply_to,
        }),
    );
  }

  @ApiOperation({ summary: 'All chats (admin)' })
  @Roles(Role.ADMIN)
  @Get()
  async list() {
    return this.conversations.list();
  }

  @ApiOperation({
    summary: 'Bulk export of selected chats as one json/txt file',
  })
  @Post('export')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async export(
    @Body() dto: ExportDto,
    @CurrentUser() user: DashboardUser,
    @Res() res: Response,
  ) {
    const chatIds = [...new Set(dto.chat_ids)];
    for (const id of chatIds) await this.scope.requireChatOwned(user, id);
    const head =
      chatIds.slice(0, 5).join(',') + (chatIds.length > 5 ? '...' : '');
    const out = await this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.export',
        resource: `chats:${head}`,
      },
      () => this.conversations.exportChats(chatIds, dto.format),
    );
    res.setHeader('Content-Type', out.mediaType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.filename}"`,
    );
    res.send(out.content);
  }

  @ApiOperation({
    summary:
      'Переписка одним HTML-файлом: фото, видео, кружки и голосовые внутри файла',
  })
  @Get(':chatId/export.html')
  async exportHtml(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
    @Res() res: Response,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    const out = await this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.export_html',
        resource: `chat:${chatId}`,
      },
      () => this.chatExport.html(chatId, user.username),
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="chat_${chatId}.html"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
    );
    res.send(out.content);
  }

  @ApiOperation({ summary: 'Исправить наше отправленное сообщение (текст)' })
  @Put(':chatId/messages/:messageId')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async editMessage(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: EditMessageDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.edit_message',
        resource: `chat:${chatId}`,
        payload: { message_id: messageId },
      },
      () => this.conversations.editMessage(chatId, messageId, dto.text),
    );
  }

  @ApiOperation({
    summary: 'Отпечаток переписки: изменилась ли она с прошлого запроса',
  })
  @Get(':chatId/revision')
  async revision(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.conversations.revision(chatId);
  }

  @ApiOperation({
    summary: 'Chat detail: messages, lead card, pause, funnel events',
  })
  @Get(':chatId')
  async detail(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    const detail = await this.conversations.detail(chatId);
    await this.conversations.markSeen(chatId);
    return detail;
  }

  @ApiOperation({
    summary: 'Manual reply as the persona (queued; voice=true → voicer)',
  })
  @Post(':chatId/message')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async message(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: ManualMessageDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    const done = await this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.manual_message',
        resource: `chat:${chatId}`,
      },
      () => this.conversations.manualMessage(chatId, dto.text, dto.reply_to),
    );
    return done.payload;
  }

  @ApiOperation({ summary: 'Bot stops answering this chat' })
  @Post(':chatId/pause')
  @HttpCode(200)
  async pause(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    await this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.pause',
        resource: `chat:${chatId}`,
      },
      () => this.conversations.pauseChat(chatId),
    );
    return { ok: true, chat_id: chatId };
  }

  @ApiOperation({
    summary:
      'Бот отвечает на неотвеченные сообщения собеседника (ответ потерялся из-за ошибки)',
  })
  @Post(':chatId/answer')
  @HttpCode(200)
  async answer(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    const scheduled = await this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.answer',
        resource: `chat:${chatId}`,
      },
      () => this.conversations.answerNow(chatId),
    );
    return { ok: true, chat_id: chatId, scheduled };
  }

  @ApiOperation({ summary: 'Bot resumes this chat' })
  @Post(':chatId/resume')
  @HttpCode(200)
  async resume(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    await this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.resume',
        resource: `chat:${chatId}`,
      },
      () => this.conversations.resumeChat(chatId),
    );
    return { ok: true, chat_id: chatId };
  }

  @ApiOperation({
    summary: 'Hide the row from the dashboard (the dialogue goes on)',
  })
  @Post(':chatId/hide')
  @HttpCode(200)
  async hide(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.hide',
        resource: `chat:${chatId}`,
      },
      () => this.conversations.setHidden(chatId, true),
    );
  }

  @ApiOperation({ summary: 'Return the row to the dashboard' })
  @Post(':chatId/unhide')
  @HttpCode(200)
  async unhide(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.unhide',
        resource: `chat:${chatId}`,
      },
      () => this.conversations.setHidden(chatId, false),
    );
  }

  @ApiOperation({
    summary: 'Заметка менеджера о диалоге (пустая строка стирает)',
  })
  @Put(':chatId/note')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async setNote(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: ChatNoteDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.note',
        resource: `chat:${chatId}`,
      },
      () => this.conversations.setNote(chatId, dto.text, user.username),
    );
  }

  @ApiOperation({ summary: 'Set funnel stage by hand' })
  @Post(':chatId/set-stage')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async setStage(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: SetStageDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.set_stage',
        resource: `chat:${chatId}`,
      },
      () => this.conversations.setStage(chatId, dto.stage),
    );
  }

  @ApiOperation({ summary: 'Pin a lead-card fact by hand' })
  @Post(':chatId/pin-fact')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async pinFact(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: PinFactDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.pin_fact',
        resource: `chat:${chatId}`,
      },
      () => this.conversations.pinFact(chatId, dto.key, dto.value),
    );
  }

  @ApiOperation({ summary: 'Отметить тему знакомства вручную (пусто — снять)' })
  @Post(':chatId/slot')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async setSlot(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: SetSlotDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.set_slot',
        resource: `chat:${chatId}`,
        payload: { slot_id: dto.slot_id },
      },
      () => this.conversations.setSlot(chatId, dto.slot_id, dto.value ?? null),
    );
  }

  @ApiOperation({ summary: 'Lift the terminal refusal lock' })
  @Post(':chatId/clear-refusal-lock')
  @HttpCode(200)
  async clearRefusalLock(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'conversation.clear_refusal_lock',
        resource: `chat:${chatId}`,
      },
      () => this.conversations.clearRefusalLock(chatId),
    );
  }
}
