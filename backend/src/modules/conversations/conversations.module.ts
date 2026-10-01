import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { raw } from 'express';
import { ConversationsService } from './conversations.service';
import { ChatExportService } from './chat-export.service';
import { ConversationsController } from './conversations.controller';
import { SettingsModule } from '../settings/settings.module';
import { BrainModule } from 'src/brain/brain.module';
import { MediaModule } from '../media/media.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [SettingsModule, BrainModule, MediaModule, TelegramModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ChatExportService],
  exports: [ConversationsService],
})
export class ConversationsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(raw({ type: () => true, limit: '50mb' })).forRoutes({
      path: 'api/conversations/:chatId/upload',
      method: RequestMethod.POST,
    });
  }
}
