import { Module } from '@nestjs/common';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import {
  BufferController,
  RegionSettingsController,
} from './buffer.controller';
import { BufferService } from './buffer.service';
import { RegionSettingsService } from './region-settings.service';

@Module({
  controllers: [
    InboundController,
    ApiKeysController,
    BufferController,
    RegionSettingsController,
  ],
  providers: [
    InboundService,
    ApiKeysService,
    BufferService,
    RegionSettingsService,
  ],
  exports: [InboundService, ApiKeysService],
})
export class InboundModule {}
