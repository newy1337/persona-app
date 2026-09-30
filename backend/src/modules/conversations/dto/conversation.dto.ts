import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ManualMessageDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  reply_to?: number;
}

export class SetStageDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  stage: string;
}

/** Заметка менеджера о диалоге: пустая строка стирает её. */
export class ChatNoteDto {
  @ApiProperty({ example: 'Просил не писать до пятницы' })
  @IsString()
  @MaxLength(4000)
  text: string;
}

export class PinFactDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  key: string;

  @ApiProperty()
  @IsString()
  @MaxLength(512)
  value: string;
}

export class SetSlotDto {
  @ApiProperty({ example: 'location' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  slot_id: string;

  @ApiPropertyOptional({ nullable: true, example: 'Омск' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  value?: string | null;
}

export class ExportDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  chat_ids: number[];

  @ApiProperty({ enum: ['json', 'txt'] })
  @IsIn(['json', 'txt'])
  format: 'json' | 'txt';
}

export class EditMessageDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4096)
  text: string;
}
