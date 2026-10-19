import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { DashboardUser } from '@prisma/client';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { CurrentUser } from 'src/decorators/user.decorator';
import { Role } from 'src/enums/roles.enum';
import { AuditService } from 'src/shared/audit.service';
import { SourcesService } from './sources.service';

class CreateSourceDto {
  @IsString() @MinLength(1) @MaxLength(64) name: string;
}

@ApiTags('sources')
@ApiBearerAuth()
@Auth()
@Roles(Role.ADMIN)
@Controller('api/sources')
export class SourcesController {
  constructor(
    private readonly sources: SourcesService,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({ summary: 'Справочник источников лидов' })
  @Get()
  list() {
    return this.sources.list();
  }

  @ApiOperation({ summary: 'Добавить источник' })
  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  create(@Body() dto: CreateSourceDto, @CurrentUser() user: DashboardUser) {
    return this.audit.wrap(
      { userId: user.id, action: 'source.create', payload: { name: dto.name } },
      () => this.sources.create(dto.name),
    );
  }

  @ApiOperation({ summary: 'Удалить источник; у менеджеров он снимется' })
  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: DashboardUser,
  ) {
    return this.audit.wrap(
      { userId: user.id, action: 'source.delete', resource: String(id) },
      () => this.sources.remove(id),
    );
  }
}
