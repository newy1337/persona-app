import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Allow,
  IsBoolean,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PERSONA_SECTIONS } from 'src/brain/persona.service';

export const SECTION_VALUES = PERSONA_SECTIONS;

export class CreatePersonaDto {
  @ApiProperty({ example: 'Лена' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @ApiPropertyOptional({ example: 'lena' })
  @IsOptional()
  @Matches(/^[a-z0-9][a-z0-9_-]{1,31}$/, {
    message: 'slug: латиница, цифры, «-» и «_», 2–32 символа',
  })
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  copy_from?: number;
}

export class UpdatePersonaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[a-z0-9][a-z0-9_-]{1,31}$/, {
    message: 'slug: латиница, цифры, «-» и «_», 2–32 символа',
  })
  slug?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'модель генератора; null — из окружения',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  generator_model?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'модель судей; null — из окружения',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  judge_model?: string | null;
}

export class PutSectionDto {
  @ApiProperty({
    description: 'Документ секции целиком: объект или массив (beats)',
  })
  @IsDefined({ message: 'нужен документ секции в поле data' })
  @Allow()
  data: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class ImportPersonaDto {
  @ApiProperty({
    description:
      'Секции личности из файла: persona, goals, storylines, dayConfig, beats, prompts',
  })
  @IsDefined({ message: 'нужны секции личности в поле sections' })
  @Allow()
  sections: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
