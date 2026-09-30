import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from 'class-validator';

export class CreateVoiceTaskDto {
  @IsIn(['voice', 'call']) kind: string;
  @IsOptional() @IsIn(['library', 'once']) voice_mode?: string;
  @IsString() @MinLength(1) @MaxLength(160) title: string;
  @IsString() @MinLength(1) @MaxLength(100) persona_slug: string;
  @IsOptional() @IsString() @MaxLength(160) contact_label?: string;
  @IsOptional() @IsString() @MaxLength(200) contact_ref?: string;
  @IsOptional() @IsInt() @Min(1) manager_id?: number;
  @IsOptional() @IsString() @Matches(/^\d{1,16}$/) chat_id?: string;
  @IsOptional() @IsString() @MaxLength(10000) script?: string;
  @IsOptional() @IsString() @MaxLength(500) emotion?: string;
  @IsOptional() @IsString() @MaxLength(500) tempo?: string;
  @IsOptional() @IsString() @MaxLength(5000) instructions?: string;
  @IsOptional() @IsInt() @Min(0) @Max(2) priority?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) due_at?: number;
}

export class VoiceTaskActionDto {
  @IsIn([
    'claim',
    'release',
    'complete',
    'call_note',
    'approve',
    'revise',
    'cancel',
    'retry_delivery',
  ])
  action: string;
  @IsInt() @Min(1) revision: number;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class RecordingTitleDto {
  @IsString() @MinLength(1) @MaxLength(160) title: string;
}

export class VoiceTaskChatDto {
  @IsString() @Matches(/^\d{1,16}$/) chat_id: string;
}

export class SendRecordingDto {
  @IsString() @Matches(/^\d{1,16}$/) chat_id: string;
  @IsUUID() request_id: string;
}
