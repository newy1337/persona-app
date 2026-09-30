import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DashboardUser } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { ScopeService } from 'src/shared/scope.service';
import { UploadsService } from './uploads.service';
import { appConfig } from 'src/config/app.config';
import { existsSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
};

@ApiTags('Media')
@ApiBearerAuth()
@Auth()
@Roles(Role.MANAGER)
@Controller('api/files')
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly uploads: UploadsService,
  ) {}

  @ApiOperation({ summary: 'Файл вложения по id сообщения' })
  @Get(':messageId')
  async file(
    @Param('messageId', ParseIntPipe) messageId: number,
    @CurrentUser() user: DashboardUser,
    @Res() res: Response,
  ) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message?.filePath)
      throw new NotFoundException('у сообщения нет вложения');
    await this.scope.requireChatOwned(user, Number(message.chatId));
    const abs = this.resolve(message.filePath);
    res.type(
      TYPES[abs.toLowerCase().split('.').pop() ?? ''] ??
        'application/octet-stream',
    );
    res.setHeader('cache-control', 'private, max-age=31536000, immutable');
    res.sendFile(abs);
  }

  private resolve(path: string): string {
    const abs = resolve(path);
    const rel = relative(appConfig.mediaDir, abs);
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      if (!existsSync(abs)) throw new NotFoundException('файла больше нет');
      return abs;
    }
    return this.uploads.resolveSafe(path);
  }
}
