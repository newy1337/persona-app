import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { LEAD_GENDERS } from 'src/domain/leads';

export class InboundLeadDto {
  @ApiPropertyOptional({ example: 'Олег' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({
    example: '+7 900 123-45-67',
    description:
      'телефон; можно вместе с username — прозвон сначала по номеру, потом по нику',
  })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  phone?: string;

  @ApiPropertyOptional({ example: '@durov', description: 'ник в Telegram' })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  username?: string;

  @ApiPropertyOptional({ example: 'camp-42', description: 'донор, текстом' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  donor?: string;

  @ApiProperty({
    example: '001',
    description:
      'регион (3–4 цифры), обязателен: лид уходит сотруднику этого региона',
  })
  @IsString({ message: 'регион обязателен' })
  @Matches(/^\d{3,4}$/, { message: 'регион должен содержать 3 или 4 цифры' })
  region: string;

  @ApiProperty({
    example: 'nastya',
    description:
      'личность (slug или имя), обязательна: лид уходит тому, кто её принимает',
  })
  @IsString({ message: 'личность обязательна' })
  @MinLength(1, { message: 'личность обязательна' })
  @MaxLength(64)
  person: string;

  @ApiPropertyOptional({ example: 'beboo', description: 'источник, текстом' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;

  @ApiPropertyOptional({ description: 'аккаунт на стороне донора, текстом' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  account?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(14) @Max(99) age?: number;

  @ApiPropertyOptional({ enum: LEAD_GENDERS })
  @IsOptional()
  @IsIn(LEAD_GENDERS)
  gender?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) city?: string;

  @ApiPropertyOptional({ description: 'id лида у отправителя' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  external_id?: string;

  @ApiPropertyOptional({ description: 'ссылка на профиль в соцсети' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  profile_url?: string;

  @ApiPropertyOptional({
    description: 'последние сообщения / история прежнего общения, текстом',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  last_messages?: string;
}
