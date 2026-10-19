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
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { CurrentUser } from 'src/decorators/user.decorator';
import { Role } from 'src/enums/roles.enum';
import { AuditService } from 'src/shared/audit.service';
import type { DashboardUser } from '@prisma/client';
import { DonorsService } from './donors.service';

class CreateDonorDto {
  @IsString() @MinLength(1) @MaxLength(64) name: string;
}

@ApiTags('donors')
@ApiBearerAuth()
@Auth()
@Roles(Role.ADMIN)
@Controller('api/donors')
export class DonorsController {
  constructor(
    private readonly donors: DonorsService,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({ summary: 'Справочник доноров' })
  @Get()
  list() {
    return this.donors.list();
  }

  @ApiOperation({ summary: 'Добавить донора' })
  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  create(@Body() dto: CreateDonorDto, @CurrentUser() user: DashboardUser) {
    return this.audit.wrap(
      { userId: user.id, action: 'donor.create', payload: { name: dto.name } },
      () => this.donors.create(dto.name),
    );
  }

  @ApiOperation({ summary: 'Удалить донора; у менеджеров он отвяжется' })
  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: DashboardUser,
  ) {
    return this.audit.wrap(
      { userId: user.id, action: 'donor.delete', resource: String(id) },
      () => this.donors.remove(id),
    );
  }
}
