import { Module } from '@nestjs/common';
import { TgAccountsService } from './tg-accounts.service';
import { TgAccountsController } from './tg-accounts.controller';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [TelegramModule],
  controllers: [TgAccountsController],
  providers: [TgAccountsService],
  exports: [TgAccountsService],
})
export class TgAccountsModule {}
