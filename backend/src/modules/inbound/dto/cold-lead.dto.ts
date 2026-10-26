import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
  ValidateIf,
} from 'class-validator';
import { LEAD_GENDERS } from 'src/domain/leads';

/** Холодка: источник, личность и контакт; регион необязателен, донора нет. */
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
    example: '001',
    description:
      'регион (3–4 цифры), необязателен: указан — холодка только сотрудникам этого региона, нет — любым',
  })
  @IsOptional()
  @IsString({ message: 'регион должен содержать 3 или 4 цифры' })
  @Matches(/^\d{3,4}$/, { message: 'регион должен содержать 3 или 4 цифры' })
  region?: string;

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

  @ApiPropertyOptional({
    enum: LEAD_GENDERS,
    description: 'пол: m — мужской, f — женский',
  })
  @IsOptional()
  @IsIn(LEAD_GENDERS, { message: 'gender — m, f или unknown' })
  gender?: string;

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
