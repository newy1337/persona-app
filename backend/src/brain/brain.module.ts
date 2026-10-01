import { forwardRef, Module } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { NastyaBrainService } from './nastya-brain.service';
import { BrainStateService } from './brain-state.service';
import { PersonaService } from './persona.service';
import { UsageRecorderService } from './usage-recorder.service';
import { ReplyScheduleService } from './reply-schedule.service';
import { MemoryWatchService } from './memory-watch.service';
import { REPLY_BRAIN, ReplyBrain } from './reply-brain.port';
import { SettingsModule } from 'src/modules/settings/settings.module';
import { TelegramModule } from 'src/modules/telegram/telegram.module';

@Injectable()
export class InitiativeScheduler {
  private readonly log = new Logger(InitiativeScheduler.name);
  private running = false;

  constructor(@Inject(REPLY_BRAIN) private brain: ReplyBrain) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.brain.runInitiative();
      if (sent) this.log.log(`initiative_sent=${sent}`);
    } finally {
      this.running = false;
    }
  }
}

@Injectable()
export class RhythmScheduler {
  private readonly log = new Logger(RhythmScheduler.name);
  private replying = false;
  private greeting = false;

  constructor(@Inject(REPLY_BRAIN) private brain: ReplyBrain) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async dueReplies() {
    if (this.replying) return;
    this.replying = true;
    try {
      await this.brain.runDueReplies();
    } catch (e) {
      this.log.error(`due replies tick failed: ${e?.message ?? e}`);
    } finally {
      this.replying = false;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async rituals() {
    if (this.greeting) return;
    this.greeting = true;
    try {
      const sent = await this.brain.runRituals();
      if (sent) this.log.log(`rituals_sent=${sent}`);
    } catch (e) {
      this.log.error(`rituals tick failed: ${e?.message ?? e}`);
    } finally {
      this.greeting = false;
    }
  }
}

@Module({
  imports: [SettingsModule, forwardRef(() => TelegramModule)],
  providers: [
    BrainStateService,
    PersonaService,
    UsageRecorderService,
    ReplyScheduleService,
    NastyaBrainService,
    { provide: REPLY_BRAIN, useExisting: NastyaBrainService },
    InitiativeScheduler,
    RhythmScheduler,
    MemoryWatchService,
  ],
  exports: [
    REPLY_BRAIN,
    PersonaService,
    BrainStateService,
    ReplyScheduleService,
  ],
})
export class BrainModule {}
