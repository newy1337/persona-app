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
}

export class UpdatePhotoSetDto {
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

export class AssignPhotoSetDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  tg_account_ids: number[];

  @ApiPropertyOptional({ nullable: true, description: 'null — снять образ' })
  @IsOptional()
  @IsInt()
  set_id?: number | null;
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
