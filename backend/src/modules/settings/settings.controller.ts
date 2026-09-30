import {
  Body,
  Controller,
  Get,
  HttpCode,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SettingsService } from './settings.service';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { AuditService } from 'src/shared/audit.service';

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class UpdateSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  initiative_enabled?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2)
  proactive_max_per_day?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CLOCK, { message: 'quiet_start must be HH:mm' })
  quiet_start?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CLOCK, { message: 'quiet_end must be HH:mm' })
  quiet_end?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  custom_prompt?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pause_on_manual_message?: boolean;
}

@ApiTags('Settings')
@ApiBearerAuth()
@Auth()
@Roles(Role.ADMIN)
@Controller('api/settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({
    summary:
      'Initiative schedule, custom instructions, takeover-on-manual flag',
  })
  @Get()
  get() {
    return this.settings.get();
  }

  @ApiOperation({ summary: 'Update settings' })
  @Put()
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  update(@Body() dto: UpdateSettingsDto, @CurrentUser('id') userId: number) {
    return this.audit.wrap(
      { userId, action: 'settings.update', payload: dto },
      () => this.settings.update(dto),
    );
  }

  @ApiOperation({ summary: 'Model spend per provider/model/stage' })
  @Get('usage')
  usage(@Query('days') days?: string) {
    const d = Number(days) || 7;
    return this.settings.usageSummary([1, 7, 30, 90].includes(d) ? d : 7);
  }
}
