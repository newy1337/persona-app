import { Module } from '@nestjs/common';
import { ManagersService } from './managers.service';
import { ManagersController } from './managers.controller';
import { DonorsController } from './donors.controller';
import { DonorsService } from './donors.service';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

@Module({
  controllers: [ManagersController, DonorsController, SourcesController],
  providers: [ManagersService, DonorsService, SourcesService],
  exports: [ManagersService],
})
export class ManagersModule {}
