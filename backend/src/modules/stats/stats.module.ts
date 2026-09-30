import { Module } from '@nestjs/common';
import { StatsService } from './stats.service';
import { BalanceService } from './balance.service';
import { StatsController } from './stats.controller';

@Module({
  controllers: [StatsController],
  providers: [StatsService, BalanceService],
  exports: [StatsService, BalanceService],
})
export class StatsModule {}
