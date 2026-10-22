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
  ValidateIf,
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
      'телефон; нужен phone или username (можно оба — прозвон сначала по нику, потом по номеру)',
  })
  // Нет ни телефона, ни ника — проверяем phone, и запрос отбивается с 400.
  @ValidateIf((o) => o.phone !== undefined || o.username === undefined)
  @IsString({ message: 'нужен phone или username' })
  @MinLength(4)
  @MaxLength(64)
  phone?: string;

  @ApiPropertyOptional({ example: '@durov', description: 'ник в Telegram' })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  username?: string;

  @ApiProperty({
    example: 'camp-42',
    description: 'донор, текстом, обязателен',
  })
  @IsString({ message: 'донор обязателен' })
  @Matches(/\S/, { message: 'донор обязателен' })
  @MaxLength(64)
  donor: string;

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
  @Matches(/\S/, { message: 'личность обязательна' })
  @MaxLength(64)
  person: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'перезабив: true — лид повторный; регион, который не принимает перезабив, такой лид отбивает',
  })
  @IsOptional()
  @IsBoolean({ message: 'reassigned — true или false' })
  reassigned?: boolean;

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

  // Возраст приходит и строкой («"34"») — приводим, а не отбиваем.
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'age — целое число' })
  @Min(14)
  @Max(99)
  age?: number;

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

  @ApiPropertyOptional({
    description: 'ссылка на профиль в соцсети: только http:// или https://',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^https?:\/\/\S+$/i, {
    message: 'ссылка на профиль должна начинаться с http:// или https://',
  })
  profile_url?: string;

  @ApiPropertyOptional({
    description: 'последние сообщения / история прежнего общения, текстом',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  last_messages?: string;
}
