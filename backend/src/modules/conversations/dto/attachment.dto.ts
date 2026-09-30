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
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { OUTGOING_KINDS } from 'src/domain/attachments';

const FILE_KINDS = OUTGOING_KINDS.filter(
  (k) => k !== 'text' && k !== 'reaction',
);

export class SendAttachmentDto {
  @ApiProperty({ enum: FILE_KINDS })
  @IsIn(FILE_KINDS, { message: 'неизвестный вид вложения' })
  kind: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  source: string;

  @ApiPropertyOptional({ description: 'подпись к вложению' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;

  @ApiPropertyOptional({ description: 'tg id сообщения, на которое отвечаем' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  reply_to?: number;
}

export class SendAlbumDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(2, { message: 'в альбоме нужно хотя бы 2 файла' })
  @ArrayMaxSize(10, { message: 'в альбоме Telegram не больше 10 файлов' })
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  sources: string[];

  @ApiPropertyOptional({ description: 'подпись к альбому' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  reply_to?: number;
}

export class ReactionDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  message_id: number;

  @ApiProperty({ example: '👍' })
  @IsString()
  @MaxLength(16)
  emoji: string;
}

export class StickerDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[A-Za-z0-9_:-]{6,256}$/, {
    message: 'некорректный идентификатор стикера',
  })
  file_id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  reply_to?: number;
}
