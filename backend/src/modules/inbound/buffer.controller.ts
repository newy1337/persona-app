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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { DashboardUser } from '@prisma/client';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { CurrentUser } from 'src/decorators/user.decorator';
import { Role } from 'src/enums/roles.enum';
import { AuditService } from 'src/shared/audit.service';
import { BufferService } from './buffer.service';
import { RegionSettingsService } from './region-settings.service';
import { ParseRegionPipe } from './region.pipe';

class DeclineDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class ReassignedDto {
  @IsBoolean({ message: 'accept_reassigned — true или false' })
  accept_reassigned: boolean;
}

@ApiTags('buffer')
@ApiBearerAuth()
@Auth()
@Roles(Role.TEAMLEAD)
@Controller('api/buffer')
export class BufferController {
  constructor(
    private readonly buffer: BufferService,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({
    summary: 'Лиды только с ником: хеду и тимлидам — их регион, админу — все',
  })
  @ApiQuery({ name: 'region', required: false })
  @Get()
  list(@CurrentUser() user: DashboardUser, @Query('region') region?: string) {
    return this.buffer.list(user, region);
  }

  @ApiOperation({ summary: 'Взять лид из буфера в работу (в свои лиды)' })
  @Post(':id/take')
  @HttpCode(200)
  take(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: DashboardUser,
  ) {
    return this.audit.wrap(
      { userId: user.id, action: 'buffer.take', resource: `lead:${id}` },
      () => this.buffer.take(user, id),
    );
  }

  @ApiOperation({
    summary: 'Отклонить лид: удаляется, слепок остаётся в архиве отклонённых',
  })
  @Post(':id/decline')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  decline(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeclineDto,
    @CurrentUser() user: DashboardUser,
  ) {
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'buffer.decline',
        resource: `lead:${id}`,
        payload: dto,
      },
      () => this.buffer.decline(user, id, dto.reason),
    );
  }
}

@ApiTags('region-settings')
@ApiBearerAuth()
@Auth()
@Roles(Role.TEAMLEAD)
@Controller('api/region-settings')
export class RegionSettingsController {
  constructor(
    private readonly settings: RegionSettingsService,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({ summary: 'Принимает ли регион перезабив' })
  @Get()
  list(@CurrentUser() user: DashboardUser) {
    return this.settings.list(user);
  }

  @ApiOperation({
    summary: 'Получать перезабив: хед — свой регион, админ — любой',
  })
  @Roles(Role.HEAD)
  @Put(':region')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  setReassigned(
    @Param('region', ParseRegionPipe) region: string,
    @Body() dto: ReassignedDto,
    @CurrentUser() user: DashboardUser,
  ) {
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'region.accept_reassigned',
        resource: `region:${region}`,
        payload: dto,
      },
      () =>
        this.settings.setAcceptReassigned(user, region, dto.accept_reassigned),
    );
  }
}
