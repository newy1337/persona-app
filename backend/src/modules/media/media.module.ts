import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { FilesController } from './files.controller';
import { UploadsService } from './uploads.service';
import { VoiceEncoderService } from './voice-encoder.service';

@Module({
  controllers: [MediaController, FilesController],
  providers: [VoiceEncoderService, MediaService, UploadsService],
  exports: [VoiceEncoderService, MediaService, UploadsService],
})
export class MediaModule {}
