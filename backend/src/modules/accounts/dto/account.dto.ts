import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
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

export const ACCOUNT_STATUSES = [
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
      'тип прокси: socks5, socks4, mtproto (Telegram), http или https (VK)',
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

export class AddTelegramAccountDto {
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

  @ApiPropertyOptional({
    nullable: true,
    description:
      'менеджер, за которым закрепить аккаунт; тимлиду и хеду обязателен',
  })
  @IsOptional()
  @IsInt()
  manager_id?: number | null;
}

/**
 * VK-аккаунт по кукам браузера, в котором выполнен вход: web_token
 * выпускается по ним, пароль не нужен. Прокси обязателен — токен VK
 * привязан к выходному IP.
 */
export class AddVkAccountDto {
  @ApiProperty({
    example: '+79001234567',
    description: 'логин VK: номер или почта',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(128)
  login: string;

  @ApiProperty({
    description:
      'куки vk.ru из браузера (экспорт Cookie-Editor и т. п.): [{name, value, domain, path}]',
  })
  @IsArray()
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path?: string;
  }>;

  @ApiPropertyOptional({
    description: 'User-Agent браузера, в котором был вход',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  user_agent?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  persona_id: string;

  @ApiProperty({ type: ProxyConfigDto })
  @ValidateNested()
  @Type(() => ProxyConfigDto)
  proxy_config: ProxyConfigDto;

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

  @ApiPropertyOptional({
    nullable: true,
    description:
      'менеджер, за которым закрепить аккаунт; тимлиду и хеду обязателен',
  })
  @IsOptional()
  @IsInt()
  manager_id?: number | null;
}

/** Новые куки VK-аккаунта: сессия умерла или вход сделан заново. */
export class SetVkSessionDto {
  @ApiProperty({
    description: 'куки vk.ru из браузера: [{name, value, domain, path}]',
  })
  @IsArray()
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path?: string;
  }>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  user_agent?: string;
}

export class UpdateTelegramProfileDto {
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

export class UpdateAccountDto {
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
  @ApiProperty({ enum: ACCOUNT_STATUSES })
  @IsIn(ACCOUNT_STATUSES)
  status: (typeof ACCOUNT_STATUSES)[number];

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

export class TelegramPrivacyDto {
  @ApiProperty()
  @IsBoolean()
  hide_last_seen: boolean;
}
