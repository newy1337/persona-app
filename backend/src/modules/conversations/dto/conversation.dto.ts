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
  ValidateIf,
} from 'class-validator';
import { DEAL_STAGES, DealStage, MAX_DEAL_NOTE } from 'src/domain/deal-stage';

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

export class SetDealStageDto {
  @ApiProperty({ enum: DEAL_STAGES })
  @IsIn(DEAL_STAGES as readonly string[])
  stage: DealStage;

  @ApiPropertyOptional({ description: 'причина — обязательна для архива' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEAL_NOTE)
  note?: string;
}

/** Модели и рассуждение для диалога; null — как у личности. */
export class ChatModelsDto {
  @ApiPropertyOptional({ nullable: true, description: 'модель ответов' })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  generator_model?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'модель судей' })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  judge_model?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'рассуждение ответов: off, low, medium, high',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(16)
  generator_effort?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'рассуждение судей: off, low, medium, high',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(16)
  judge_effort?: string | null;
}

export class ChatNoteDto {
  @ApiProperty({ example: 'Просил не писать до пятницы' })
  @IsString()
  @MaxLength(4000)
  text: string;
}

export class ClientGenderDto {
  @ApiProperty({
    enum: ['m', 'f'],
    nullable: true,
    description: 'm — мужской, f — женский, null — не указан',
  })
  @IsOptional()
  @IsIn(['m', 'f'], { message: 'gender — m, f или null' })
  gender: 'm' | 'f' | null;
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
