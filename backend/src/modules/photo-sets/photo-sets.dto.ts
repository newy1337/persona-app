import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SEND_MODES } from 'src/domain/photo-library';

export class CreatePhotoSetDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    description:
      'Регион образа: администратор указывает обязательно, хед всегда создаёт в своём',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  region_code?: string;
}

/** Хед назначает сотруднику своего региона образ по личности; null — снять. */
export class AssignStaffPhotoSetDto {
  @ApiProperty()
  @IsInt()
  user_id: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  persona_slug: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  set_id?: number | null;
}

export class RegionStopDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @ApiPropertyOptional({ description: 'Регион (только администратор)' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  region_code?: string;
}

export class UpdatePhotoSetDto {
  @ApiPropertyOptional({
    description: 'Перевести образ в другой регион (только администратор)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  region_code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  cover_photo_id?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  auto_send?: boolean;

  @ApiPropertyOptional({ enum: SEND_MODES })
  @IsOptional()
  @IsIn(SEND_MODES)
  send_mode?: string;

  @ApiPropertyOptional({ description: 'Минимум минут между фото в диалоге' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 30)
  min_interval_min?: number;

  @ApiPropertyOptional({ description: 'Не больше фото в день в одном диалоге' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  max_per_day?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  no_repeat?: boolean;
}

export class UpdatePhotoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  place?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'YYYY, YYYY-MM или YYYY-MM-DD; пусто — дата неизвестна',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  taken_on?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  auto_send?: boolean;
}

export class AccountAutoSendDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

export class SendLibraryPhotoDto {
  @ApiProperty()
  @IsInt()
  photo_id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  reply_to?: number;
}
