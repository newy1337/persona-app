import { Module } from '@nestjs/common';
import { BrainModule } from 'src/brain/brain.module';
import { PhotoSetsController } from './photo-sets.controller';
import { PhotoSetsService } from './photo-sets.service';

@Module({
  imports: [BrainModule],
  controllers: [PhotoSetsController],
  providers: [PhotoSetsService],
  exports: [PhotoSetsService],
})
export class PhotoSetsModule {}
