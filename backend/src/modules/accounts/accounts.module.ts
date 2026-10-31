import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { ProxyAlertService } from './proxy-alert.service';
import { TelegramModule } from '../../channels/telegram/telegram.module';

@Module({
  imports: [TelegramModule],
  controllers: [AccountsController],
  providers: [AccountsService, ProxyAlertService],
  exports: [AccountsService],
})
export class AccountsModule {}
