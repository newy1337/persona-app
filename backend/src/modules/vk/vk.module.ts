import { forwardRef, Module } from '@nestjs/common';
import { BrainModule } from 'src/brain/brain.module';
import { TelegramModule } from 'src/modules/telegram/telegram.module';
import { VkService } from './vk.service';

/** Канал VK: подключается к реестру каналов из модуля Telegram. */
@Module({
  imports: [TelegramModule, forwardRef(() => BrainModule)],
  providers: [VkService],
  exports: [VkService],
})
export class VkModule {}
