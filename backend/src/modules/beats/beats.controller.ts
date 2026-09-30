import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UnprocessableEntityException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { DashboardUser } from '@prisma/client';
import { BeatsService } from './beats.service';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { ScopeService } from 'src/shared/scope.service';
import { AuditService } from 'src/shared/audit.service';
import { ClockService } from 'src/shared/clock.service';
import { OperatorService } from '../operator/operator.service';

export class ConfirmBeatsDto {
  @ApiProperty() @IsString() persona: string;
  @ApiProperty() @IsInt() chat: number;
  @ApiProperty() @IsString() operator: string;
  @ApiProperty() @IsNumber() issued_ts: number;
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  confirmed?: string[] = [];
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  rejected?: string[] = [];
}

@ApiTags('Beats')
@ApiBearerAuth()
@Auth()
@Roles(Role.MANAGER)
@Controller('api/conversations')
export class BeatsController {
  constructor(
    private readonly beats: BeatsService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly operator: OperatorService,
  ) {}

  @ApiOperation({ summary: 'Scenario state of a chat' })
  @Get(':chatId/beats')
  async beatsOf(
    @Param('chatId', ParseIntPipe) chatId: number,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    return this.beats.snapshot(chatId);
  }

  @ApiOperation({
    summary: 'Manager marks beats under an active takeover ticket',
  })
  @Post(':chatId/beats/confirm')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  async confirm(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: ConfirmBeatsDto,
    @CurrentUser() user: DashboardUser,
  ) {
    await this.scope.requireChatOwned(user, chatId);
    const ts = this.clock.now().getTime() / 1000;
    let error: string | null =
      dto.chat === chatId ? null : 'тикет выписан на другой чат';
    if (!error) {
      try {
        this.operator.requireActive({
          persona: dto.persona,
          chat: dto.chat,
          operator: dto.operator,
          issued_ts: dto.issued_ts,
        });
      } catch (e) {
        error = String(e.message ?? e);
      }
    }
    if (error) {
      await this.audit.log({
        userId: user.id,
        action: 'beats.confirm',
        resource: `chat:${chatId}`,
        error,
      });
      throw new UnprocessableEntityException(error);
    }
    return this.audit.wrap(
      { userId: user.id, action: 'beats.confirm', resource: `chat:${chatId}` },
      () =>
        this.beats.confirm(
          chatId,
          dto.operator,
          dto.confirmed ?? [],
          dto.rejected ?? [],
          ts,
        ),
    );
  }
}
