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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { DashboardUser } from '@prisma/client';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { AuditService } from 'src/shared/audit.service';
import { ScopeService } from 'src/shared/scope.service';
import { PhotoSetsService } from './photo-sets.service';
import {
  AccountAutoSendDto,
  AssignRegionPhotoSetDto,
  CreatePhotoSetDto,
  UpdatePhotoDto,
  UpdatePhotoSetDto,
} from './photo-sets.dto';

@ApiTags('Photo sets')
@ApiBearerAuth()
@Auth()
@Roles(Role.MANAGER)
@Controller('api/photo-sets')
export class PhotoSetsController {
  constructor(
    private readonly sets: PhotoSetsService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  @ApiOperation({ summary: 'Образы, доступные пользователю' })
  @Get()
  list(@CurrentUser() user: DashboardUser) {
    this.scope.requireManager(user);
    return this.sets.list(user);
  }

  @ApiOperation({ summary: 'Создать образ (хед — в своём регионе)' })
  @Post()
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  create(@Body() dto: CreatePhotoSetDto, @CurrentUser() user: DashboardUser) {
    this.sets.requireCreator(user);
    return this.audit.wrap(
      { userId: user.id, action: 'photo_set.create', payload: dto },
      () => this.sets.create(user, dto.name, dto.region_code),
    );
  }

  @ApiOperation({
    summary: 'Личности региона и их образы (для новых собеседников)',
  })
  @Get('assignments')
  assignments(
    @CurrentUser() user: DashboardUser,
    @Query('region') region?: string,
  ) {
    this.scope.requireManager(user);
    return this.sets.regionAssignments(user, region);
  }

  @ApiOperation({
    summary:
      'Назначить образ личности региона (хед); начатые диалоги остаются на прежнем',
  })
  @Put('assignments')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  assignRegion(
    @Body() dto: AssignRegionPhotoSetDto,
    @CurrentUser() user: DashboardUser,
  ) {
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'photo_set.assign_region',
        resource: `persona:${dto.persona_slug}`,
        payload: dto,
      },
      () =>
        this.sets.assignRegion(
          user,
          dto.persona_slug,
          dto.set_id ?? null,
          dto.region_code,
        ),
    );
  }

  @ApiOperation({ summary: 'Автоотправка фото для одного аккаунта' })
  @Put('accounts/:accountId/auto-send')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async accountAutoSend(
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() dto: AccountAutoSendDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.sets.accountOwnedBy(user, accountId);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'tg_account.photo_auto_send',
        resource: `tg_account:${accountId}`,
        payload: dto,
      },
      () => this.sets.setAccountAutoSend(accountId, dto.enabled),
    );
  }

  @ApiOperation({
    summary: 'Библиотека образа для диалога с отметками о показах',
  })
  @Get('chat/:chatId')
  async chatLibrary(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
    @Query('q') q?: string,
    @Query('tag') tag?: string,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.sets.chatLibrary(chatId, { q, tag });
  }

  @ApiOperation({ summary: 'Файл снимка; ?thumb=1 — превью' })
  @Get('photos/:photoId/file')
  async file(
    @Param('photoId', ParseIntPipe) photoId: number,
    @Query('thumb') thumb: string | undefined,
    @CurrentUser() user: DashboardUser,
    @Res() res: Response,
  ) {
    const path = await this.sets.photoFile(user, photoId, thumb === '1');
    res.type('image/jpeg');
    res.setHeader('cache-control', 'private, max-age=31536000, immutable');
    res.sendFile(path);
  }

  @ApiOperation({ summary: 'Исправить описание, место, дату, теги снимка' })
  @Put('photos/:photoId')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async updatePhoto(
    @Param('photoId', ParseIntPipe) photoId: number,
    @Body() dto: UpdatePhotoDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.sets.requirePhoto(user, photoId, true);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'photo_set.photo_update',
        resource: `photo:${photoId}`,
        payload: dto,
      },
      () => this.sets.updatePhoto(photoId, dto),
    );
  }

  @ApiOperation({ summary: 'Убрать снимок из образа' })
  @Delete('photos/:photoId')
  async removePhoto(
    @Param('photoId', ParseIntPipe) photoId: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.sets.requirePhoto(user, photoId, true);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'photo_set.photo_remove',
        resource: `photo:${photoId}`,
      },
      () => this.sets.removePhoto(photoId),
    );
  }

  @ApiOperation({ summary: 'Снимки образа; поиск q и тег tag' })
  @Get(':id/photos')
  async photos(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: DashboardUser,
    @Query('q') q?: string,
    @Query('tag') tag?: string,
  ) {
    await this.sets.requireVisible(user, id);
    return this.sets.photos(id, { q, tag });
  }

  @ApiOperation({
    summary:
      'Загрузить снимок: сырое тело, имя в query. Система предложит описание',
  })
  @Post(':id/photos')
  @HttpCode(200)
  async upload(
    @Param('id', ParseIntPipe) id: number,
    @Query('name') name: string,
    @Req() req: Request,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.sets.requireEditable(user, id);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'photo_set.upload',
        resource: `photo_set:${id}`,
        payload: { name },
      },
      () => this.sets.upload(id, name, req.body as Buffer),
    );
  }

  @ApiOperation({
    summary: 'Настройки образа: название, обложка, автоотправка',
  })
  @Put(':id')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePhotoSetDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.sets.requireEditable(user, id);
    if (dto.region_code !== undefined) this.sets.requireAdmin(user);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'photo_set.update',
        resource: `photo_set:${id}`,
        payload: dto,
      },
      () => this.sets.update(id, dto),
    );
  }

  @ApiOperation({
    summary:
      'Удалить образ (хед региона): только когда все его диалоги дошли до лида или архива',
  })
  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.sets.requireEditable(user, id);
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'photo_set.remove',
        resource: `photo_set:${id}`,
      },
      () => this.sets.remove(id),
    );
  }
}
