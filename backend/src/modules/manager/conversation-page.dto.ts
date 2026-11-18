import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { DEAL_STAGES } from 'src/domain/deal-stage';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Страница списка диалогов: фильтры те же, что кнопки над таблицей. */
export class ConversationPageQuery {
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{1,6}$/) page?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{1,3}$/) size?: string;
  @ApiPropertyOptional({ description: 'поиск: имя, @ник, телефон, город, id' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
  @ApiPropertyOptional({ enum: ['all', 'tg', 'vk'] })
  @IsOptional()
  @IsIn(['all', 'tg', 'vk'])
  channel?: string;
  @ApiPropertyOptional({ enum: [...DEAL_STAGES, 'none'] })
  @IsOptional()
  @IsIn([...DEAL_STAGES, 'none'])
  deal?: string;
  @ApiPropertyOptional({ description: 'этап сценария бота' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  stage?: string;
  @ApiPropertyOptional({ enum: ['1'] }) @IsOptional() @IsIn(['1']) new?: string;
  @ApiPropertyOptional({ enum: ['bot', 'manager'] })
  @IsOptional()
  @IsIn(['bot', 'manager'])
  lead?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{1,10}$/) account?: string;
  @ApiPropertyOptional({ description: 'день МСК, YYYY-MM-DD' })
  @IsOptional()
  @Matches(DAY)
  from?: string;
  @ApiPropertyOptional({ description: 'день МСК, YYYY-MM-DD' })
  @IsOptional()
  @Matches(DAY)
  to?: string;
  @ApiPropertyOptional({ enum: ['name', 'status', 'last'] })
  @IsOptional()
  @IsIn(['name', 'status', 'last'])
  sort?: 'name' | 'status' | 'last';
  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';
  @ApiPropertyOptional({ enum: ['1'] })
  @IsOptional()
  @IsIn(['1'])
  archive?: string;
}
