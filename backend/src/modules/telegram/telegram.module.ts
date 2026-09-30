import { forwardRef, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { RelayWorker } from './relay.worker';
import { LoginService } from './login.service';
import { OUTBOUND_TRANSPORT } from 'src/brain/reply-brain.port';
import { BrainModule } from 'src/brain/brain.module';
import { MediaModule } from 'src/modules/media/media.module';

@Module({
  imports: [forwardRef(() => BrainModule), MediaModule],
  providers: [
    TelegramService,
    { provide: OUTBOUND_TRANSPORT, useExisting: TelegramService },
    RelayWorker,
    LoginService,
  ],
  exports: [TelegramService, OUTBOUND_TRANSPORT, LoginService],
})
export class TelegramModule {}
