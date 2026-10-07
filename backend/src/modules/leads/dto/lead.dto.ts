import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateNested,
  ValidationOptions,
  buildMessage,
} from 'class-validator';
import { DEAL_STAGES } from 'src/domain/deal-stage';
import { LEAD_GENDERS, LEAD_STATUSES } from 'src/domain/leads';

/** «Диалог есть, этап сделки не выставлен» в фильтре по этапу. */
export const NO_DEAL_STAGE = 'none';
export const DEAL_STAGE_FILTERS: readonly string[] = [
  ...DEAL_STAGES,
  NO_DEAL_STAGE,
];

/** Значения фильтра из строки запроса: одно или несколько через запятую. */
export function csvValues(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function IsCsvOf(allowed: readonly string[], options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isCsvOf',
      validator: {
        validate: (value): boolean => {
          if (typeof value !== 'string') return false;
          const values = csvValues(value);
          return values.length > 0 && values.every((v) => allowed.includes(v));
        },
        defaultMessage: buildMessage(
          (prefix) =>
            `${prefix}$property: допустимы значения ${allowed.join(', ')} (одно или несколько через запятую)`,
          options,
        ),
      },
    },
    options,
  );
}

export class CreateLeadDto {
  @ApiPropertyOptional({ example: '+7 900 123-45-67' })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(64)
  phone?: string;

  @ApiPropertyOptional({ example: '@durov' })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  first_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(14) @Max(99) age?: number;
  @ApiPropertyOptional({ example: 'beboo' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  site?: string;
  @ApiPropertyOptional({ example: 'nastya', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  persona_id?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  preferred_account_id?: number | null;
  @ApiPropertyOptional({ enum: LEAD_GENDERS })
  @IsOptional()
  @IsIn(LEAD_GENDERS)
  gender?: string;
  @ApiPropertyOptional({ default: 'manual' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  source_type?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  notes?: string;
}

export class ImportLeadsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  text?: string;

  @ApiPropertyOptional({ type: [CreateLeadDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => CreateLeadDto)
  items?: CreateLeadDto[];

  @ApiPropertyOptional({ default: 'import' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  source_type?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  persona_id?: string | null;

  @ApiPropertyOptional({ default: false }) @IsOptional() queue?: boolean;
}

export class UpdateLeadDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) first_name?:
    string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) city?:
    string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(14) @Max(99) age?:
    number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) site?:
    string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  persona_id?: string | null;
  @ApiPropertyOptional({ enum: LEAD_GENDERS })
  @IsOptional()
  @IsIn(LEAD_GENDERS)
  gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(512) notes?:
    string | null;
}

export class LeadIdsDto {
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsInt({ each: true })
  ids?: number[];
}

export class ListLeadsQuery {
  @ApiPropertyOptional({
    description: `Один статус или несколько через запятую: ${LEAD_STATUSES.join(', ')}`,
    example: 'contacted,replied',
  })
  @IsOptional()
  @IsCsvOf(LEAD_STATUSES)
  status?: string;
  @ApiPropertyOptional({
    description: `Этап сделки диалога, один или несколько через запятую: ${DEAL_STAGE_FILTERS.join(', ')}; none — диалог есть, этап не выставлен`,
    example: 'lead,deposit',
  })
  @IsOptional()
  @IsCsvOf(DEAL_STAGE_FILTERS)
  deal_stage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) q?: string;
  @ApiPropertyOptional({ default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
