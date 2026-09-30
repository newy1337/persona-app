import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNumber, IsString, MinLength } from 'class-validator';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class TakeoverDto {
  @ApiProperty()
  @trim()
  @IsString()
  @MinLength(1)
  persona: string;

  @ApiProperty()
  @IsInt()
  chat: number;

  @ApiProperty()
  @trim()
  @IsString()
  @MinLength(1)
  operator: string;
}

export class TicketDto extends TakeoverDto {
  @ApiProperty()
  @IsNumber()
  issued_ts: number;
}

export class RelayDto extends TicketDto {
  @ApiProperty()
  @IsString()
  text: string;
}
