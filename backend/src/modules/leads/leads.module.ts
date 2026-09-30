import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { OutreachWorker } from './outreach.worker';
import { TelegramModule } from 'src/modules/telegram/telegram.module';
import { BrainModule } from 'src/brain/brain.module';

@Module({
  imports: [TelegramModule, BrainModule],
  controllers: [LeadsController],
  providers: [LeadsService, OutreachWorker],
  exports: [LeadsService],
})
export class LeadsModule {}
