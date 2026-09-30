import { Module } from '@nestjs/common';
import { BeatsService } from './beats.service';
import { BeatsController } from './beats.controller';
import { RubricService } from './rubric.service';
import { OperatorModule } from '../operator/operator.module';
import { BrainModule } from 'src/brain/brain.module';

@Module({
  imports: [OperatorModule, BrainModule],
  controllers: [BeatsController],
  providers: [BeatsService, RubricService],
  exports: [BeatsService, RubricService],
})
export class BeatsModule {}
