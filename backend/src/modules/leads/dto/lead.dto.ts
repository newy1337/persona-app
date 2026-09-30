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
  ValidateNested,
} from 'class-validator';
import { LEAD_GENDERS, LEAD_STATUSES } from 'src/domain/leads';

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
  @ApiPropertyOptional({ enum: LEAD_STATUSES })
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) q?: string;
  @ApiPropertyOptional({ default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;
}
