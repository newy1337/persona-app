import { Module } from '@nestjs/common';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

@Module({
  controllers: [InboundController, ApiKeysController],
  providers: [InboundService, ApiKeysService],
  exports: [InboundService, ApiKeysService],
})
export class InboundModule {}
