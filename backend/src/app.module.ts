import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './modules/auth/auth.module';
import { ManagersModule } from './modules/managers/managers.module';
import { ManagerModule } from './modules/manager/manager.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { OperatorModule } from './modules/operator/operator.module';
import { BeatsModule } from './modules/beats/beats.module';
import { VoicerModule } from './modules/voicer/voicer.module';
import { MediaModule } from './modules/media/media.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { TelegramModule } from './channels/telegram/telegram.module';
import { VkModule } from './channels/vk/vk.module';
import { BrainModule } from './brain/brain.module';
import { SettingsModule } from './modules/settings/settings.module';
import { LeadsModule } from './modules/leads/leads.module';
import { PersonasModule } from './modules/personas/personas.module';
import { StatsModule } from './modules/stats/stats.module';
import { PhotoSetsModule } from './modules/photo-sets/photo-sets.module';
import { InboundModule } from './modules/inbound/inbound.module';

import { AuditModule } from './modules/audit/audit.module';
import { QuickRepliesModule } from './modules/quick-replies/quick-replies.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    SharedModule,
    AuthModule,
    ManagersModule,
    ManagerModule,
    ConversationsModule,
    OperatorModule,
    BeatsModule,
    VoicerModule,
    MediaModule,
    AccountsModule,
    TelegramModule,
    VkModule,
    BrainModule,
    SettingsModule,
    LeadsModule,
    PersonasModule,
    StatsModule,
    PhotoSetsModule,
    InboundModule,
    AuditModule,
    QuickRepliesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
