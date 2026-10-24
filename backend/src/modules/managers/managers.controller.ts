import {
  Body,
  Query,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiQuery,
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ManagersService } from './managers.service';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { DashboardUser } from '@prisma/client';
import { AuditService } from 'src/shared/audit.service';
import {
  AccountOwnerDto,
  BulkOwnerDto,
  CreateManagerDto,
  UpdateManagerDto,
} from './dto/manager.dto';

@ApiTags('Managers')
@ApiBearerAuth()
@Auth()
@Roles(Role.HEAD)
@Controller('api/managers')
export class ManagersController {
  constructor(
    private readonly managers: ManagersService,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({ summary: 'All panel users with role and assigned accounts' })
  @ApiQuery({ name: 'from', required: false, example: '2026-10-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-10-07' })
  @Get()
  async list(
    @CurrentUser() user: DashboardUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.managers.list(user, { from, to });
  }

  @Get(':userId/credentials')
  @Roles(Role.ADMIN)
  @Header('Cache-Control', 'no-store')
  async credentials(
    @Param('userId', ParseIntPipe) target: number,
    @CurrentUser('id') userId: number,
  ) {
    return this.audit.wrap(
      {
        userId,
        action: 'manager.credentials_view',
        resource: `user:${target}`,
      },
      () => this.managers.credentials(target),
    );
  }

  @Post(':userId/password')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async regeneratePassword(
    @Param('userId', ParseIntPipe) target: number,
    @CurrentUser('id') userId: number,
  ) {
    return this.audit.wrap(
      {
        userId,
        action: 'manager.password_regenerate',
        resource: `user:${target}`,
      },
      () => this.managers.regeneratePassword(target),
    );
  }

  @ApiOperation({ summary: 'Create a panel user' })
  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async create(
    @Body() dto: CreateManagerDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.audit.wrap(
      { userId, action: 'manager.create', resource: dto.username },
      () => this.managers.create(dto),
    );
  }

  @ApiOperation({
    summary: 'Assign several accounts to one manager (null releases)',
  })
  @Put('accounts')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async setOwnerBulk(
    @Body() dto: BulkOwnerDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.audit.wrap(
      {
        userId,
        action: 'manager.assign_bulk',
        resource: `user:${dto.user_id}`,
      },
      () => this.managers.setOwnerBulk(dto.tg_account_ids, dto.user_id),
    );
  }

  @ApiOperation({ summary: 'Set the owner of one account (null releases)' })
  @Put('accounts/:accountId')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async setOwner(
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() dto: AccountOwnerDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.audit.wrap(
      {
        userId,
        action: 'manager.assign',
        resource: `tg_account:${accountId}`,
      },
      () => this.managers.setAccountOwner(accountId, dto.user_id),
    );
  }

  @ApiOperation({ summary: 'Update role, password and the full account set' })
  @Put(':userId')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async update(
    @Param('userId', ParseIntPipe) target: number,
    @Body() dto: UpdateManagerDto,
    @CurrentUser() user: DashboardUser,
  ) {
    return this.audit.wrap(
      { userId: user.id, action: 'manager.update', resource: `user:${target}` },
      () => this.managers.update(target, dto, user),
    );
  }

  @ApiOperation({ summary: 'Delete a panel user (not yourself)' })
  @Delete(':userId')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  async remove(
    @Param('userId', ParseIntPipe) target: number,
    @CurrentUser('id') userId: number,
  ) {
    return this.audit.wrap(
      { userId, action: 'manager.delete', resource: `user:${target}` },
      () => this.managers.remove(target, userId),
    );
  }
}
