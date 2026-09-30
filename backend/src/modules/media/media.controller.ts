import { Controller, Get, Param, ParseIntPipe, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { DashboardUser } from '@prisma/client';
import { MediaService } from './media.service';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { ScopeService } from 'src/shared/scope.service';
import { PresenceService } from 'src/shared/presence.service';
import { existsSync } from 'fs';

@ApiTags('Media')
@ApiBearerAuth()
@Auth()
@Roles(Role.MANAGER)
@Controller('api/conversations')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly scope: ScopeService,
    private readonly presence: PresenceService,
  ) {}

  @ApiOperation({ summary: 'Аватарка собеседника из Telegram' })
  @Get(':chatId/avatar')
  async avatar(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
    @Res() res: Response,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    const path = this.presence.avatarPath(chatId);
    if (!existsSync(path)) {
      res.status(404).json({ statusCode: 404, message: 'аватарки нет' });
      return;
    }
    res.type('image/jpeg');
    res.setHeader('cache-control', 'private, max-age=86400');
    res.sendFile(path);
  }

  @ApiOperation({ summary: "Client's saved media turns: [{ts, kind}]" })
  @Get(':chatId/media/inbound/list')
  async inboundList(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.media.inboundList(chatId);
  }

  @ApiOperation({ summary: 'Media file nearest to a message ts' })
  @Get(':chatId/media/:msgTs')
  async file(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Param('msgTs', ParseIntPipe) msgTs: number,
    @CurrentUser() user: DashboardUser,
    @Res() res: Response,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    const path = await this.media.nearestFile(chatId, msgTs);
    res.sendFile(path);
  }
}
