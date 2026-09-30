import { TelegramModule } from '../telegram/telegram.module';
import { VoicerCallService } from './voicer-call.service';
import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { VoicerController } from './voicer.controller';
import { VoicerService } from './voicer.service';
import { VoicerBotService } from './voicer-bot.service';
import { VoicerChatService } from './voicer-chat.service';
import { VoicerBriefService } from './voicer-brief.service';
import { VoicerCallOutcomeService } from './voicer-call-outcome.service';
import { BrainModule } from 'src/brain/brain.module';

@Module({
  imports: [MediaModule, TelegramModule, BrainModule],
  controllers: [VoicerController],
  providers: [
    VoicerService,
    VoicerBotService,
    VoicerChatService,
    VoicerCallService,
    VoicerBriefService,
    VoicerCallOutcomeService,
  ],
})
export class VoicerModule {}
