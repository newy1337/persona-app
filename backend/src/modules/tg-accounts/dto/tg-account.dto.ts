import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { PROXY_TYPES, type ProxyType } from 'src/domain/proxy';

export const TG_ACCOUNT_STATUSES = [
  'unauthorized',
  'active',
  'paused',
  'banned',
  'retired',
] as const;

export class ProxyConfigDto {
  @ApiProperty({ enum: PROXY_TYPES })
  @IsIn(PROXY_TYPES, {
    message:
      'тип прокси: socks5, socks4 или mtproto — HTTP Telegram не поддерживает',
  })
  type: ProxyType;

  @ApiProperty() @IsString() @MinLength(1) host: string;
  @ApiProperty() @IsInt() @Min(1) @Max(65535) port: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() username?:
    string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() password?:
    string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() secret?:
    string | null;
}

export class AddTgAccountDto {
  @ApiProperty({ example: '+79001234567' })
  @Matches(/^\+?\d{10,15}$/, { message: 'phone_e164 must be E.164' })
  phone_e164: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  persona_id: string;

  @ApiPropertyOptional({ type: ProxyConfigDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProxyConfigDto)
  proxy_config?: ProxyConfigDto | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  daily_msg_quota?: number | null;

  @ApiPropertyOptional({ enum: ['prod', 'test'], default: 'prod' })
  @IsOptional()
  @IsIn(['prod', 'test'])
  purpose?: 'prod' | 'test' = 'prod';
}

export class UpdateTgProfileDto {
  @ApiPropertyOptional({ example: 'Настя' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  first_name?: string;

  @ApiPropertyOptional({ example: 'Иванова' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  last_name?: string;

  @ApiPropertyOptional({ example: 'nastya_iv' })
  @IsOptional()
  @IsString()
  @MaxLength(33)
  username?: string;
}

export class UpdateTgAccountDto {
  @ApiPropertyOptional({ example: 'nastya' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  persona_id?: string;

  @ApiPropertyOptional({ enum: ['prod', 'test'] })
  @IsOptional()
  @IsIn(['prod', 'test'])
  purpose?: 'prod' | 'test';

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  daily_msg_quota?: number | null;
}

export class SetProxyDto {
  @ApiProperty({ type: ProxyConfigDto })
  @ValidateNested()
  @Type(() => ProxyConfigDto)
  proxy_config: ProxyConfigDto;
}

export class SetStatusDto {
  @ApiProperty({ enum: TG_ACCOUNT_STATUSES })
  @IsIn(TG_ACCOUNT_STATUSES)
  status: (typeof TG_ACCOUNT_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  reason?: string;
}

export class StartAuthDto {
  @ApiPropertyOptional({ enum: ['phone', 'qr'], default: 'phone' })
  @IsOptional()
  @IsIn(['phone', 'qr'])
  method?: 'phone' | 'qr';
}

export class SmsCodeDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(16) code: string;
}

export class TwoFaDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(256) password: string;
}

export class TgPrivacyDto {
  @ApiProperty()
  @IsBoolean()
  hide_last_seen: boolean;
}
