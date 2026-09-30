import { Global, Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccessControlService } from './access-control.service';
import { PrismaService } from '../prisma.service';
import { ClockService } from './clock.service';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';
import { HistoryService } from './history.service';
import { ScopeService } from './scope.service';
import { PauseService } from './pause.service';
import { FunnelEventsService } from './funnel-events.service';
import { GlobalGateService } from './global-gate.service';
import { PresenceService } from './presence.service';
import { ManagerAttributionService } from './manager-attribution.service';
import { VoicerAutomationService } from 'src/modules/voicer/voicer-automation.service';
import { VoicerDeliveryService } from 'src/modules/voicer/voicer-delivery.service';

const providers = [
  JwtService,
  AccessControlService,
  PrismaService,
  ClockService,
  AuditService,
  CryptoService,
  HistoryService,
  ScopeService,
  PauseService,
  FunnelEventsService,
  GlobalGateService,
  PresenceService,
  ManagerAttributionService,
  VoicerDeliveryService,
  VoicerAutomationService,
];

@Global()
@Module({
  providers,
  exports: providers,
})
export class SharedModule {}
