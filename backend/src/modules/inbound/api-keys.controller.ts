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
import { ApiKeysService } from './api-keys.service';

class CreateApiKeyDto {
  @IsString() @MinLength(1) @MaxLength(64) name: string;
}

@ApiTags('api-keys')
@ApiBearerAuth()
@Auth()
@Roles(Role.ADMIN)
@Controller('api/api-keys')
export class ApiKeysController {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({ summary: 'Ключи внешних систем: без самих значений' })
  @Get()
  list() {
    return this.keys.list();
  }

  @ApiOperation({
    summary: 'Создать ключ; значение в ответе показывается один раз',
  })
  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: DashboardUser) {
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'api_key.create',
        payload: { name: dto.name },
      },
      () => this.keys.create(dto.name, user.id),
    );
  }

  @ApiOperation({ summary: 'Отозвать ключ: запросы с ним получают 401' })
  @Delete(':id')
  revoke(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: DashboardUser,
  ) {
    return this.audit.wrap(
      { userId: user.id, action: 'api_key.revoke', resource: String(id) },
      () => this.keys.revoke(id),
    );
  }
}
