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
  MaxLength,
  Max,
  Min,
  MinLength,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ROLES } from 'src/enums/roles.enum';

export class CreateManagerDto {
  @IsOptional()
  @IsInt()
  voicer_id?: number | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'руководитель: тимлид для менеджера, хед для тимлида',
  })
  @IsOptional()
  @IsInt()
  lead_id?: number | null;
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username: string;
  @ApiPropertyOptional({ description: 'принимает входящих лидов' })
  @IsOptional()
  @IsBoolean()
  online?: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description: 'входящих лидов в сутки; null — без лимита',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  lead_quota?: number | null;
  @ApiPropertyOptional({
    type: [String],
    description: 'источники, которые принимает; пусто — любые',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  lead_sources?: string[];
  @ApiPropertyOptional({
    type: [Number],
    description: 'доноры, которых принимает; пусто — любые',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  donor_ids?: number[];
  @ApiPropertyOptional({
    type: [String],
    description: 'личности (slug), которые принимает; пусто — любые',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  lead_personas?: string[];

  @ApiPropertyOptional({
    description: 'Если не задан, создаётся случайный пароль',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password?: string;

  @ApiPropertyOptional({
    description: 'Код региона менеджера: 3–4 цифры, включая ведущие нули',
  })
  @ValidateIf(
    (o) =>
      ['manager', 'teamlead', 'head'].includes(o.role) ||
      o.region_code !== undefined,
  )
  @IsString()
  @Matches(/^\d{3,4}$/, { message: 'регион должен содержать 3 или 4 цифры' })
  region_code?: string;

  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role: string;
}

export class UpdateManagerDto {
  @ApiPropertyOptional({ description: 'Новый логин; должен быть свободен' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username?: string;
  @ApiPropertyOptional({
    description: 'Право менять общие образы: правка видна на всех их аккаунтах',
  })
  @IsOptional()
  @IsBoolean()
  can_edit_photo_sets?: boolean;
  @IsOptional()
  @IsInt()
  voicer_id?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  lead_id?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^\d{3,4}$/, { message: 'регион должен содержать 3 или 4 цифры' })
  region_code?: string | null;

  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES)
  role?: string;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  account_ids?: number[];
  @ApiPropertyOptional({ description: 'принимает входящих лидов' })
  @IsOptional()
  @IsBoolean()
  online?: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description: 'входящих лидов в сутки; null — без лимита',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  lead_quota?: number | null;
  @ApiPropertyOptional({
    type: [String],
    description: 'источники, которые принимает; пусто — любые',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  lead_sources?: string[];
  @ApiPropertyOptional({
    type: [Number],
    description: 'доноры, которых принимает; пусто — любые',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  donor_ids?: number[];
  @ApiPropertyOptional({
    type: [String],
    description: 'личности (slug), которые принимает; пусто — любые',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  lead_personas?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password?: string;
}

export class AccountOwnerDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  user_id?: number | null;
}

export class BulkOwnerDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  tg_account_ids: number[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  user_id?: number | null;
}
