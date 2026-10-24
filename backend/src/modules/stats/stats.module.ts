import { Module } from '@nestjs/common';
import { StatsService } from './stats.service';
import { BalanceService } from './balance.service';
import { BalanceAlertService } from './balance-alert.service';
import { StatsController } from './stats.controller';

@Module({
  controllers: [StatsController],
  providers: [StatsService, BalanceService, BalanceAlertService],
  exports: [StatsService, BalanceService],
})
export class StatsModule {}
