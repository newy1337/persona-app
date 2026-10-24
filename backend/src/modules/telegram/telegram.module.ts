import { forwardRef, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { RelayWorker } from './relay.worker';
import { LoginService } from './login.service';
import { OUTBOUND_TRANSPORT } from 'src/brain/reply-brain.port';
import { BrainModule } from 'src/brain/brain.module';
import { MediaModule } from 'src/modules/media/media.module';
import { ChannelRegistry } from 'src/channels/registry';
import { PrismaService } from 'src/prisma.service';

@Module({
  imports: [forwardRef(() => BrainModule), MediaModule],
  providers: [
    TelegramService,
    // Telegram подключается к реестру сразу при создании; VK — из своего модуля.
    {
      provide: ChannelRegistry,
      useFactory: (prisma: PrismaService, telegram: TelegramService) => {
        const registry = new ChannelRegistry(prisma);
        registry.register(telegram);
        return registry;
      },
      inject: [PrismaService, TelegramService],
    },
    // Брейн пишет через реестр: канал выбирается по chat_id.
    { provide: OUTBOUND_TRANSPORT, useExisting: ChannelRegistry },
    RelayWorker,
    LoginService,
  ],
  exports: [TelegramService, ChannelRegistry, OUTBOUND_TRANSPORT, LoginService],
})
export class TelegramModule {}
