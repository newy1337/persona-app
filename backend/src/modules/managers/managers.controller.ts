import {
  Body,
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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ManagersService } from './managers.service';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { AuditService } from 'src/shared/audit.service';
import {
  AccountOwnerDto,
  BulkOwnerDto,
  CreateManagerDto,
  UpdateManagerDto,
} from './dto/manager.dto';

// В журнал уходят только названия изменённых полей: значения (пароль) туда не пишем.
const UPDATE_FIELDS = [
  'username',
  'role',
  'region_code',
  'voicer_id',
  'account_ids',
  'password',
  'regenerate_password',
] as const;

@ApiTags('Managers')
@ApiBearerAuth()
@Auth()
@Roles(Role.ADMIN)
@Controller('api/managers')
export class ManagersController {
  constructor(
    private readonly managers: ManagersService,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({ summary: 'All panel users with role and assigned accounts' })
  @Get()
  async list() {
    return this.managers.list();
  }

  @ApiOperation({
    summary: 'Everything the account editor shows, the stored password too',
  })
  @Get(':userId')
  @Header('Cache-Control', 'no-store')
  async editor(
    @Param('userId', ParseIntPipe) target: number,
    @CurrentUser('id') userId: number,
  ) {
    return this.audit.wrap(
      {
        userId,
        action: 'manager.credentials_view',
        resource: `user:${target}`,
      },
      () => this.managers.editor(target),
    );
  }

  @ApiOperation({ summary: 'Create a panel user' })
  @Post()
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
  @Put('accounts/:tgAccountId')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async setOwner(
    @Param('tgAccountId', ParseIntPipe) tgAccountId: number,
    @Body() dto: AccountOwnerDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.audit.wrap(
      {
        userId,
        action: 'manager.assign',
        resource: `tg_account:${tgAccountId}`,
      },
      () => this.managers.setAccountOwner(tgAccountId, dto.user_id),
    );
  }

  @ApiOperation({
    summary: 'Update login, role, region, voicer, password and the account set',
  })
  @Put(':userId')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UsePipes(ValidationPipe)
  async update(
    @Param('userId', ParseIntPipe) target: number,
    @Body() dto: UpdateManagerDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.audit.wrap(
      {
        userId,
        // Случайный пароль — отдельное событие журнала, как до объединения запросов.
        action: dto.regenerate_password
          ? 'manager.password_regenerate'
          : 'manager.update',
        resource: `user:${target}`,
        payload: {
          fields: UPDATE_FIELDS.filter((key) => dto[key] !== undefined),
        },
      },
      () => this.managers.update(target, dto),
    );
  }

  @ApiOperation({ summary: 'Delete a panel user (not yourself)' })
  @Delete(':userId')
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
