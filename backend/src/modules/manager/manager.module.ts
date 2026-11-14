import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PollCacheInterceptor } from './poll-cache.interceptor';
import { BrainModule } from 'src/brain/brain.module';
import { ManagerService } from './manager.service';
import { ManagerController } from './manager.controller';

@Module({
  imports: [BrainModule],
  controllers: [ManagerController],
  providers: [
    ManagerService,
    { provide: APP_INTERCEPTOR, useClass: PollCacheInterceptor },
  ],
  exports: [ManagerService],
})
export class ManagerModule {}
