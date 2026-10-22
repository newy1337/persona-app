import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

/** Холодка: источник, личность и контакт; региона и донора нет. */
export class ColdLeadDto {
  @ApiProperty({ example: 'beboo', description: 'источник, обязателен' })
  @IsString({ message: 'источник обязателен' })
  @Matches(/\S/, { message: 'источник обязателен' })
  @MaxLength(64)
  source: string;

  @ApiProperty({
    example: 'nastya',
    description:
      'личность (slug), обязательна: привязывается к лиду, получает тот, у кого она добавлена',
  })
  @IsString({ message: 'личность обязательна' })
  @Matches(/\S/, { message: 'личность обязательна' })
  @MaxLength(64)
  persona: string;

  @ApiPropertyOptional({
    example: '+7-900-123-45-67',
    description:
      'телефон в любом виде: дефисы, пробелы и скобки убираются, «+» не обязателен; нужен phone или username',
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

  @ApiPropertyOptional({
    example: 'Олег',
    description: 'имя клиента: показывается в «Лидах» вместо номера',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({ example: 'Москва' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  city?: string;

  @ApiPropertyOptional({ example: 34 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'age — целое число' })
  @Min(14)
  @Max(99)
  age?: number;
}
