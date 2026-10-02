import { PrismaService } from 'src/prisma.service';
import { callContext } from 'src/shared/call-context';
import { VoicerAutomationService } from 'src/modules/voicer/voicer-automation.service';
import { restoredTurn } from './inbound-recovery';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { readFileSync } from 'fs';
import { ChatActivity } from './chat-activity';
import {
  deliveryRandomId,
  prepareDelivery,
  stateFingerprint,
  personaFingerprint,
  REPLY_FRESH_SECONDS,
  StaleReply,
  type PreparedReply,
  type ReplyDelivery,
} from './reply-delivery';
import { checkCancelled, ReplySuperseded } from 'src/shared/cancellation';
import { appConfig } from 'src/config/app.config';
import { HistoryService } from 'src/shared/history.service';
import { PauseService } from 'src/shared/pause.service';
import { ClockService } from 'src/shared/clock.service';
import { FunnelEventsService } from 'src/shared/funnel-events.service';
import { GlobalGateService } from 'src/shared/global-gate.service';
import { SettingsService } from 'src/modules/settings/settings.service';
import {
  ACQUAINTANCE_TO_FUNNEL,
  DEFAULT_FUNNEL_STAGE,
} from 'src/domain/funnel';
import {
  FIRST_CONTACT_TS_KEY,
  LeadFacts,
  REFUSAL_LOCK_KEY,
} from 'src/domain/lead-facts';
import { datingSiteOf, leadSlots } from 'src/domain/outreach-opener';
import { fillText } from './nastya/config/variables';
import type { TypingStyle } from 'src/domain/typing';
import {
  HANDOFF_TRIGGER_KEY,
  MEDIA_REQUEST_KEY,
  MEDIA_REQUEST_LABELS,
} from 'src/domain/lead-facts';
import { matchTrigger } from 'src/domain/handoff-triggers';
import { mentionsMedia } from 'src/domain/media-request';
import { TakeoverReason } from 'src/domain/pause';
import {
  InboundTurn,
  LeadIntro,
  OUTBOUND_TRANSPORT,
  OutboundTransport,
  ReplyBrain,
} from './reply-brain.port';
import { BrainStateService } from './brain-state.service';
import { PersonaService, type LoadedPersona } from './persona.service';
import {
  UsageRecorderService,
  type UsageScope,
} from './usage-recorder.service';
import { timeClaimIssues } from './nastya/kernel/turn-time';
import { pruneUnsupportedEvents } from './nastya/memory/persona-events';
import { turnTime, type TurnTime } from './nastya/kernel/turn-time';
import { goodnightReason } from './nastya/dialogue/goodnight-policy';
import { characterDate, shiftDate } from './nastya/kernel/clock';
import type {
  ConversationState,
  Judgment,
  RhythmState,
} from './nastya/kernel/types';
import { generatorModelFor, type PersonaModels } from './nastya/config/models';
import { stripMetadata } from './nastya/character/config';
import { prepareTurn } from './nastya/character/turn';
import { applyJudgment } from './nastya/character/judgment';
import { buildRuntimeSnapshot } from './nastya/character/snapshot';
import { buildCharacterPrompt } from './nastya/character/prompt';
import {
  dropRepeatedGreeting,
  enforceReplyRules,
  normalizeReply,
} from './nastya/character/reply';
import { judgeDialogue } from './nastya/judge/plan';
import {
  catchUpPersonaMemory,
  latestPersonaMessageId,
} from './nastya/memory/persona-catchup';
import type { JudgeDeps } from './nastya/judge/transport';
import { reviewReply } from './nastya/judge/review';
import { generateDraft } from './nastya/llm/generate';
import {
  conversational,
  hasUnansweredInbound,
  openQuestions,
  stageQuestionReview,
  completeQuestionReview,
  validQuestionIds,
} from './nastya/character/conversation';
import { appendAssistantMessage } from './nastya/memory/history';
import { markMemoryRecalled } from './nastya/memory/memories';
import { withAttachmentContext } from './nastya/media/attachment';
import { applyOperatorSlots } from './nastya/memory/profile';
import { inspectImage } from './nastya/media/image';
import { transcribeFile } from './nastya/media/transcribe';
import { emojiReaction } from './nastya/media/reactions';
import {
  splitReplyMessages,
  splitDisplayMessages,
  splitMessage,
} from './nastya/dialogue/split';
import {
  dropRepeatedFarewell,
  farewellNote,
  isClosingOnly,
  saidGoodnightRecently,
  saidMorningRecently,
} from './nastya/dialogue/farewell';
import {
  initiativeIsDue,
  checkInGuidance,
  unansweredUnprompted,
} from './nastya/dialogue/initiative';
import { personaGender, voiceOf } from './nastya/character/gender';
import { judgeModelFor } from './nastya/config/models';
import {
  ACTIVE_CHAT_DAYS,
  GOODNIGHT_QUIET_BEFORE_SECONDS,
  MORNING_QUIET_BEFORE_SECONDS,
  forecastNextAction,
  type NextBotAction,
} from './nastya/dialogue/forecast';
import {
  goodnightDay,
  isGoodnightText,
  lateReplyNote,
  outOfNight,
  replyDelay,
  ritualSlot,
  staleness,
  type RitualKind,
} from './nastya/dialogue/rhythm';
import {
  ReplyScheduleService,
  type ScheduledReply,
  type PendingTurn,
} from './reply-schedule.service';

const INITIATIVE_RETENTION_DAYS = 14;
const FALLBACK_REACTION = '\u{1F44D}';
const FAREWELL_REACTION = '\u{1F970}';
const VOICE_UNHEARD_NOTE =
  '\n[Голосовое сообщение: расшифровки нет, что в нём сказано — неизвестно. Не выдумывай содержание; по-человечески скажи, что не получилось толком разобрать, и попроси написать текстом.]';
const LISTEN_PAD_SECONDS = 5;
const REPLY_RETRY_DELAYS_S = [60, 180, 600, 1800];
const OFFLINE_RECHECK_SECONDS = 60;
const REPLY_LANES = 6;
const QUEUE_ALERT = 15;
const FORECAST_STALE_SECONDS = 300;
const FORECAST_REFRESH_LANES = 3;

const listenSeconds = (turn: InboundTurn): number =>
  turn.media?.kind === 'voice'
    ? Math.max(1, Math.round(Number(turn.media.duration) || 0))
    : 0;

const FACT_TO_SLOT: Record<string, string> = {
  site: 'dating_site',
  name: 'name',
  age: 'age',
  city: 'location',
  job: 'work',
  family: 'family',
  children_count: 'children',
};

const MEDIA_LABELS: Record<string, string> = {
  photo: 'Фото',
  sticker: 'Стикер',
  animation: 'GIF',
  video: 'Видео',
  video_note: 'Кружок',
  voice: 'Голосовое сообщение',
  document: 'Файл',
};

class ChatLocks {
  private readonly tails = new Map<number, Promise<unknown>>();
  get size(): number {
    return this.tails.size;
  }
  run<T>(chatId: number, body: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(chatId) ?? Promise.resolve();
    const next = previous.then(body, body);
    const tail = next
      .catch(() => undefined)
      .finally(() => {
        if (this.tails.get(chatId) === tail) this.tails.delete(chatId);
      });
    this.tails.set(chatId, tail);
    return next;
  }
}

@Injectable()
export class NastyaBrainService implements ReplyBrain {
  private readonly log = new Logger(NastyaBrainService.name);
  private readonly locks = new ChatLocks();
  private readonly activity = new ChatActivity();
  private readonly logger = {
    info: (m: string) => this.log.log(m),
    warn: (m: string) => this.log.warn(m),
    error: (m: string) => this.log.error(m),
  };

  constructor(
    private history: HistoryService,
    private pause: PauseService,
    private clock: ClockService,
    private funnel: FunnelEventsService,
    private gate: GlobalGateService,
    private settings: SettingsService,
    private state: BrainStateService,
    private persona: PersonaService,
    private usage: UsageRecorderService,
    private schedule: ReplyScheduleService,
    @Inject(forwardRef(() => OUTBOUND_TRANSPORT))
    private transport: OutboundTransport,
    @Optional() private autoVoice?: VoicerAutomationService,
    @Optional() private prisma?: PrismaService,
  ) {}

  private judgeDeps(
    scope: UsageScope = {},
    variables: Record<string, string> = {},
    signal?: AbortSignal,
    persona?: PersonaModels | null,
  ) {
    return {
      ...this.llmDeps(scope, variables, signal),
      effort: appConfig.judgeEffort,
      model: judgeModelFor(persona, appConfig.judgeModel),
    };
  }

  private llmDeps(
    scope: UsageScope = {},
    variables: Record<string, string> = {},
    signal?: AbortSignal,
  ) {
    return {
      signal,
      client: this.persona.anthropic,
      provider: this.persona.provider,
      usageDb: this.usage.scoped(scope),
      logger: this.logger,
      variables,
    };
  }

  observeIncoming(
    chatId: number,
    accountId: number,
    messageId: number,
  ): () => void {
    return this.activity.receive(chatId, `${accountId}:${messageId}`);
  }

  private async withReply(
    chatId: number,
    body: (signal: AbortSignal) => Promise<boolean>,
  ): Promise<boolean> {
    const work = this.activity.start(chatId);
    if (!work) return false;
    try {
      return await body(work.signal);
    } catch (e) {
      if (work.signal.aborted || e instanceof ReplySuperseded) return false;
      throw e;
    } finally {
      work.finish();
    }
  }

  async handleInbound(turn: InboundTurn): Promise<void> {
    if (
      !turn.replay &&
      (await this.history.hasProcessedClientMessage(
        turn.chatId,
        turn.messageId,
      ))
    )
      return;
    const release = this.observeIncoming(
      turn.chatId,
      turn.accountId,
      turn.messageId,
    );
    try {
      await this.locks.run(turn.chatId, async () => {
        if (
          !turn.replay &&
          (await this.history.hasProcessedClientMessage(
            turn.chatId,
            turn.messageId,
          ))
        )
          return;
        await this.handleLocked(turn);
        await this.history.markInboundProcessed(turn.chatId, turn.messageId);
      });
    } finally {
      release();
    }
  }

  private async handleLocked(turn: InboundTurn): Promise<void> {
    const { chatId } = turn;
    await this.history.ensureContact(chatId, turn.accountId);
    await this.history.mergeLeadFacts(chatId, {
      [FIRST_CONTACT_TS_KEY]: turn.ts,
    });

    let text = turn.text.trim();
    let modality = 'text';
    if (turn.media) {
      await this.transcribeTurn(turn);
      const label = MEDIA_LABELS[turn.media.kind] ?? 'Вложение';
      const emoji = turn.media.emoji
        ? `: ${turn.media.emoji}`
        : turn.media.name
          ? `: ${turn.media.name}`
          : '';
      const spoken = turn.media.transcript ? turn.media.transcript : '';
      text = `[${label}${emoji}]${[spoken, text]
        .filter(Boolean)
        .map((line) => `\n${line}`)
        .join('')}`;
      modality =
        turn.media.kind === 'voice'
          ? 'voice'
          : turn.media.kind === 'photo'
            ? 'photo'
            : 'text';
    } else if (emojiReaction(text)) {
      turn.media = { kind: 'sticker', emoji: text };
    }

    const stored = await this.history.appendMessage(chatId, {
      role: 'user',
      text,
      ts: turn.ts,
      author: 'client',
      sourceMessageId: turn.messageId,
      modality,
      inboundPayload: JSON.stringify(turn),
      ...(turn.media?.path
        ? { mediaKind: turn.media.kind, filePath: turn.media.path }
        : {}),
    });
    if (stored)
      await this.autoVoice?.cancelForChat(
        chatId,
        'Пришло новое сообщение — нужен актуальный ответ',
      );
    await this.invalidateReply(chatId);
    if (stored)
      await this.funnel.emit(chatId, 'message_in', turn.ts, {
        chars: text.length,
        modality,
      });

    const state = await this.state.reconcile(chatId);

    if (this.gate.stopped) return this.markReadSafe(chatId, turn.accountId);
    // Чат на менеджере: галочку «прочитано» ставит он сам, когда откроет
    // переписку. Иначе собеседник видит, что его прочли, а ответа нет.
    if ((await this.pause.status(chatId)).status === 'paused') return;
    const trigger = matchTrigger(
      text,
      (await this.settings.get()).handoff_triggers ?? [],
    );
    if (trigger) {
      // Стоп-фраза уводит чат на менеджера — читать за него тоже не надо.
      await this.handOverByTrigger(chatId, trigger, turn.ts);
      return;
    }
    const facts = await this.history.getLeadFacts(chatId);
    if (facts[REFUSAL_LOCK_KEY])
      return this.markReadSafe(chatId, turn.accountId);
    if (!this.persona.ready) {
      this.log.warn('LLM keys are not configured — inbound stored, no reply');
      return this.markReadSafe(chatId, turn.accountId);
    }

    const persona = await this.persona.forAccount(turn.accountId);
    if (isGoodnightText(turn.text)) {
      const rhythm = (state.rhythm ??= {});
      (rhythm.goodnight ??= {})[
        goodnightDay(this.clock.now(), persona.rhythm)
      ] = 'user';
      rhythm.last_goodnight_ts = turn.ts;
      pruneRhythm(
        rhythm,
        characterDate(this.clock.now(), persona.rhythm.timezone),
      );
      await this.state.save(chatId, state);
    }

    const nowTs = this.clock.ts();
    const age = staleness(turn.ts, nowTs, persona.rhythm);
    if (
      age === 'expired' ||
      (age === 'late' && !persona.rhythm.late_messages.enabled)
    ) {
      this.log.log(
        `chat=${chatId}: message ${turn.messageId} is ${Math.round((nowTs - turn.ts) / 3600)}h old — not answering (${age})`,
      );
      return;
    }

    const entry: PendingTurn = { turn, text, modality };
    const burst = persona.rhythm.reply_delay.burst_seconds;
    const pending = await this.schedule.get(chatId);
    if (pending) {
      let notBefore = turn.ts + burst;
      if (pending.openedAt) {
        await this.markReadSafe(chatId, turn.accountId);
        const listen = listenSeconds(turn);
        if (listen) {
          await this.markListenedSafe(chatId, [turn.messageId], turn.accountId);
          notBefore = Math.max(
            notBefore,
            this.clock.ts() + listen + LISTEN_PAD_SECONDS,
          );
        }
      }
      await this.schedule.append(chatId, entry, notBefore);
      return;
    }
    let delay: { seconds: number; reason: string };
    let dueAt: number;
    if (age === 'late') {
      const { min_hours, max_hours } = persona.rhythm.after_silence;
      const seconds = Math.round(
        (min_hours + (max_hours - min_hours) * Math.random()) * 3600,
      );
      dueAt = outOfNight(nowTs + seconds, persona.rhythm, chatId);
      delay = { seconds: dueAt - nowTs, reason: 'late' };
    } else {
      const marks = await this.history.rhythmMarks(chatId, turn.ts);
      delay = replyDelay(
        {
          inboundTs: turn.ts,
          ...marks,
          lastGoodnightTs: state.rhythm?.last_goodnight_ts ?? null,
        },
        persona.rhythm,
      );
      dueAt = turn.ts + Math.max(delay.seconds, burst);
    }
    await this.schedule.create(
      chatId,
      turn.accountId,
      entry,
      dueAt,
      delay.reason,
    );
    this.log.log(
      `reply scheduled chat=${chatId} in=${dueAt - turn.ts}s reason=${delay.reason}`,
    );
    if (dueAt <= this.clock.ts()) await this.respondLocked(chatId);
  }

  private async transcribeTurn(turn: InboundTurn): Promise<void> {
    const media = turn.media;
    if (
      !media ||
      (media.kind !== 'voice' && media.kind !== 'video_note') ||
      !media.path ||
      media.transcript !== undefined
    )
      return;
    if (!appConfig.openaiApiKey) return;
    if (
      !turn.replay &&
      (await this.history.hasClientMessage(turn.chatId, turn.messageId))
    )
      return;
    try {
      const personaId =
        (
          await this.persona
            .forAccount(turn.accountId, turn.chatId)
            .catch(() => null)
        )?.slug ?? null;
      media.transcript = await transcribeFile(media.path, {
        apiKey: appConfig.openaiApiKey,
        baseUrl: appConfig.openaiBaseUrl,
        model: appConfig.transcribeModel,
        language: appConfig.transcribeLanguage || undefined,
        usage: this.usage.scoped({ chatId: turn.chatId, personaId }),
      });
      this.log.log(
        `chat=${turn.chatId}: ${media.kind} transcribed (${media.transcript.length} chars)`,
      );
    } catch (e) {
      media.transcript = null;
      this.log.warn(
        `chat=${turn.chatId}: ${media.kind} transcription failed: ${e?.message ?? e}`,
      );
    }
  }

  private readonly composing = new Set<number>();
  private readonly replyFailures = new Map<number, number>();

  async runDueReplies(): Promise<number> {
    for (const turn of await this.history.unprocessedInbound()) {
      try {
        await this.handleInbound(turn);
      } catch (e) {
        this.log.warn(
          `inbound recovery chat=${turn.chatId}: ${e?.message ?? e}`,
        );
      }
    }
    const due = await this.schedule.dueRows(this.clock.ts());
    if (!due.length) return 0;
    const lanes = new Map<number, number[]>();
    for (const { chatId, accountId } of due) {
      const lane = lanes.get(accountId);
      if (lane) lane.push(chatId);
      else lanes.set(accountId, [chatId]);
    }
    if (due.length >= QUEUE_ALERT) {
      this.log.warn(
        `очередь ответов: ${due.length} чатов на ${lanes.size} аккаунтах`,
      );
    }
    const queue = [...lanes.values()];
    let sent = 0;
    const lane = async (): Promise<void> => {
      for (let chats = queue.shift(); chats; chats = queue.shift()) {
        for (const chatId of chats)
          if (await this.respondScheduled(chatId)) sent += 1;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(REPLY_LANES, queue.length) }, lane),
    );
    return sent;
  }

  private async respondScheduled(chatId: number): Promise<boolean> {
    this.composing.add(chatId);
    this.nextActionCache.delete(chatId);
    try {
      return await this.locks.run(chatId, () => this.respondLocked(chatId));
    } catch (e) {
      this.log.error(
        `scheduled reply failed chat=${chatId} (${e?.name ?? e}: ${e?.message ?? ''})`,
      );
      return false;
    } finally {
      this.composing.delete(chatId);
      this.nextActionCache.delete(chatId);
    }
  }

  private async respondLocked(chatId: number): Promise<boolean> {
    return this.withReply(chatId, (signal) =>
      this.respondCurrent(chatId, signal),
    );
  }

  private async respondCurrent(
    chatId: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    const now = this.clock.ts();
    const pending = await this.schedule.get(chatId);
    if (!pending || pending.dueAt > now) return false;
    if (
      pending.delivery &&
      pending.delivery.sentCount === pending.delivery.parts.length
    ) {
      await this.schedule.drop(chatId);
      return false;
    }
    if (await this.autoVoice?.pending(chatId)) return false;
    const blocked = await this.automationBlock(chatId, pending.accountId);
    if (blocked) {
      if (blocked === 'persona')
        await this.schedule.defer(chatId, now + 60, 'persona_disabled');
      else await this.schedule.drop(chatId);
      // Чат успели забрать на менеджера — отметку о прочтении оставляем ему.
      if (blocked !== 'paused')
        await this.markReadSafe(chatId, pending.accountId);
      return false;
    }
    if (
      this.transport.isOnline &&
      !this.transport.isOnline(pending.accountId)
    ) {
      await this.schedule.postpone(chatId, now + OFFLINE_RECHECK_SECONDS);
      return false;
    }
    if (pending.openedAt === null) {
      await this.markReadSafe(chatId, pending.accountId);
      const voices = pending.turns.filter((t) => listenSeconds(t.turn) > 0);
      const listen = voices.reduce((sum, t) => sum + listenSeconds(t.turn), 0);
      if (voices.length)
        await this.markListenedSafe(
          chatId,
          voices.map((t) => t.turn.messageId),
          pending.accountId,
        );
      await this.schedule.open(
        chatId,
        now,
        now + (listen ? listen + LISTEN_PAD_SECONDS : 0),
      );
      if (listen) return false;
    }
    if (await this.history.hasPendingManualReply(chatId)) {
      await this.schedule.defer(chatId, now + 60, 'manual_pending');
      return false;
    }
    const due = await this.schedule.claim(chatId, now);
    if (!due || !due.turns.length) return false;
    try {
      checkCancelled(signal);
      const turns = due.turns;
      const last = turns[turns.length - 1].turn;
      const persona = await this.persona.forAccount(due.accountId, chatId);
      let delivery = due.delivery;
      if (delivery) {
        const current = await this.state.reconcile(chatId);
        if (
          this.clock.ts() - (delivery.generatedAt ?? delivery.preparedAt) >
            REPLY_FRESH_SECONDS ||
          delivery.date !==
            characterDate(this.clock.now(), persona.rhythm.timezone) ||
          delivery.basisState !== stateFingerprint(current) ||
          delivery.basisPersona !== personaFingerprint(persona)
        )
          throw new StaleReply('Prepared reply is outdated');
      }
      if (!delivery) {
        const wordy = turns.filter(
          (t) =>
            !t.turn.media ||
            t.turn.media.kind === 'photo' ||
            t.turn.media.kind === 'voice' ||
            Boolean(t.turn.media.transcript),
        );
        const before = await this.state.load(chatId);
        const farewell = {
          goodnight: saidGoodnightRecently(before.history ?? [], now),
          morning: saidMorningRecently(before.history ?? [], now),
        };
        if (
          !wordy.length ||
          (farewell.goodnight &&
            wordy.every((t) => !t.turn.media && isClosingOnly(t.turn.text)))
        ) {
          checkCancelled(signal);
          if (!wordy.length) await this.react(last);
          else await this.reactWith(last, FAREWELL_REACTION);
          await this.schedule.drop(chatId);
          return true;
        }
        let text = turns.map((t) => t.text).join('\n');
        if (
          turns.some(
            (t) => t.turn.media?.kind === 'voice' && !t.turn.media.transcript,
          )
        )
          text += VOICE_UNHEARD_NOTE;
        const contexts: string[] = [];
        for (const t of turns) {
          checkCancelled(signal);
          if (t.turn.media?.kind !== 'photo' || !t.turn.media.path) continue;
          const photoPersona = await this.persona.forAccount(
            t.turn.accountId,
            chatId,
          );
          contexts.push(
            await inspectImage(
              {
                data: readFileSync(t.turn.media.path),
                caption: t.text,
                instructions: fillText(
                  photoPersona.prompts.photo,
                  photoPersona.variables,
                ),
              },
              this.llmDeps(
                { chatId, personaId: photoPersona.slug },
                photoPersona.variables,
                signal,
              ),
            ),
          );
        }
        const oldest = Math.min(...turns.map((t) => t.turn.ts));
        const late =
          staleness(oldest, this.clock.ts(), persona.rhythm) !== 'fresh'
            ? lateReplyNote(
                this.clock.ts() - oldest,
                personaGender(persona.config.persona),
              )
            : '';
        const prepared = await this.generateReply(
          chatId,
          text,
          contexts.filter(Boolean).join('\n'),
          late,
          farewell,
          turns,
          signal,
        );
        checkCancelled(signal);
        if (prepared === null) {
          await this.schedule.drop(chatId);
          return false;
        }
        if (!prepared.reply.trim()) {
          await this.reactWith(last, FAREWELL_REACTION);
          await this.schedule.drop(chatId);
          return true;
        }
        const parts = splitReplyMessages(prepared.reply)
          .flatMap((m) => splitDisplayMessages(m))
          .flatMap((d) => splitMessage(d));
        delivery = prepareDelivery(prepared, parts, this.clock.ts());
        if (!(await this.schedule.prepare(chatId, delivery))) return false;
      }
      if (
        delivery.voice &&
        !delivery.sentCount &&
        !delivery.parts.some((p) => p.dispatchedAt)
      ) {
        checkCancelled(signal);
        if (this.autoVoice && (await this.autoVoice.enqueue(chatId, delivery)))
          return false;
        delete delivery.voice;
        if (!(await this.schedule.prepare(chatId, delivery))) return false;
      }
      const offset = delivery.sentCount;
      const remaining = delivery.parts.slice(offset);
      let confirmed = 0;
      const beforePart = async () => {
        checkCancelled(signal);
        if (
          (await this.automationBlock(chatId, due.accountId)) ||
          (await this.history.hasPendingManualReply(chatId)) ||
          (await this.schedule.get(chatId))?.delivery?.id !== delivery.id
        )
          throw new ReplySuperseded();
        const current = await this.state.load(chatId);
        const currentPersona = await this.persona.forAccount(
          due.accountId,
          chatId,
        );
        if (
          stateFingerprint(current) !== delivery.basisState ||
          personaFingerprint(currentPersona) !== delivery.basisPersona ||
          this.clock.ts() - (delivery.generatedAt ?? delivery.preparedAt) >
            REPLY_FRESH_SECONDS ||
          delivery.date !==
            characterDate(this.clock.now(), currentPersona.rhythm.timezone) ||
          timeClaimIssues(
            remaining[confirmed]?.text ?? '',
            await this.timeContext(currentPersona, delivery.state),
          ).length
        )
          throw new StaleReply('Reply changed or expired before dispatch');
        checkCancelled(signal);
      };
      const confirm = async (index: number, tgMsgId: number) => {
        if (index < confirmed) return;
        if (index !== confirmed)
          throw new Error('Out-of-order delivery acknowledgment');
        const next = structuredClone(delivery);
        const ts = this.clock.ts();
        appendAssistantMessage(
          next.state,
          remaining[index].text,
          'dialogue',
          ts,
        );
        next.sentCount = offset + index + 1;
        if (next.sentCount === next.parts.length)
          this.bookkeep(
            next.state,
            next.judgment,
            next.date,
            next.reply,
            next.today,
          );
        await this.state.confirmPart(
          chatId,
          next.state,
          remaining[index].text,
          'llm',
          tgMsgId,
          ts,
          next,
        );
        delivery = next;
        confirmed += 1;
        await this.mirrorLeadFacts(chatId, next.state).catch((e) =>
          this.log.warn(
            `lead facts sync failed chat=${chatId}: ${e?.message ?? e}`,
          ),
        );
      };
      const ids = await this.transport.sendText(
        chatId,
        remaining.map((p) => p.text),
        {
          accountId: due.accountId,
          typing: persona.rhythm.typing,
          signal,
          beforePart,
          randomIds: remaining.map((p) => p.randomId),
          onPart: confirm,
          onDispatch: async (index) => {
            await beforePart();
            delivery.parts[offset + index].dispatchedAt ??= this.clock.ts();
            if (!(await this.schedule.prepare(chatId, delivery)))
              throw new ReplySuperseded();
          },
        },
      );
      for (let i = confirmed; i < ids.length; i += 1) await confirm(i, ids[i]);
      if (delivery.sentCount !== delivery.parts.length)
        throw new Error('Transport did not acknowledge every reply part');
      await this.schedule.drop(chatId);
      this.replyFailures.delete(chatId);
      await this.funnel.emit(chatId, 'message_out', this.clock.ts(), {
        chars: delivery.reply.length,
        bubbles: delivery.parts.length,
      });
      return true;
    } catch (e) {
      if (e instanceof StaleReply) {
        const current = await this.schedule.get(chatId);
        const draft = current?.delivery;
        const uncertain =
          draft &&
          (!draft.basisState ||
            draft.parts
              .slice(draft.sentCount)
              .some((p) => p.dispatchedAt !== undefined));
        if (uncertain) {
          await this.pause.pause(
            chatId,
            TakeoverReason.HOLD,
            'system:stale_reply',
            {
              reasonText:
                'Ответ устарел после сбоя отправки. Проверьте последние сообщения в Telegram перед продолжением.',
            },
          );
          await this.schedule.drop(chatId);
        } else if (draft?.sentCount && current) {
          try {
            await this.refreshContinuation(current, draft, signal);
          } catch (error) {
            if (signal.aborted || error instanceof ReplySuperseded) {
              await this.invalidateReply(chatId);
              return false;
            }
            await this.schedule.restore(current, this.clock.ts() + 60, 'retry');
            this.log.warn(
              `chat=${chatId}: continuation review failed (${error?.name ?? error})`,
            );
          }
        } else {
          await this.invalidateReply(chatId);
          if (current)
            await this.schedule.restore(current, this.clock.ts(), 'refresh');
        }
        this.replyFailures.delete(chatId);
        this.log.warn(
          `chat=${chatId}: stale reply discarded${uncertain ? ', delivery needs review' : ''}`,
        );
        return false;
      }
      if (signal.aborted || e instanceof ReplySuperseded) {
        await this.invalidateReply(chatId);
        this.replyFailures.delete(chatId);
        return false;
      }
      const failures = Math.min(
        (this.replyFailures.get(chatId) ?? 0) + 1,
        REPLY_RETRY_DELAYS_S.length,
      );
      this.replyFailures.set(chatId, failures);
      if (await this.schedule.get(chatId))
        await this.schedule.restore(
          due,
          this.clock.ts() + REPLY_RETRY_DELAYS_S[failures - 1],
          'retry',
        );
      throw e;
    }
  }

  private async refreshContinuation(
    pending: ScheduledReply,
    draft: ReplyDelivery,
    signal: AbortSignal,
  ): Promise<void> {
    checkCancelled(signal);
    const { chatId } = pending;
    const persona = await this.persona.forAccount(pending.accountId, chatId);
    const base = await this.state.reconcile(chatId);
    const state = structuredClone(base);
    const today = characterDate(this.clock.now(), persona.rhythm.timezone);
    const sent = draft.parts.slice(0, draft.sentCount);
    const remaining = draft.parts
      .slice(draft.sentCount)
      .map((p) => p.text)
      .join('\n');
    const userText = pending.turns.map((t) => t.text).join('\n');
    const runtime = buildRuntimeSnapshot(
      persona.config,
      state,
      today,
      userText,
      this.clock.ts(),
    );
    if (runtime.conversation_context)
      runtime.conversation_context.answer_question_ids = validQuestionIds(
        draft.judgment.answer_question_ids,
        runtime,
      );
    runtime.time_context = await this.timeContext(persona, state);
    runtime.delivery_context = {
      kind: 'continuation',
      reason:
        'Продолжение уже начатого ответа после изменения времени или контекста.',
      sent_parts: sent.map((p) => p.text),
    };
    const review = await reviewReply(
      {
        prompt: persona.prompts.judge_review,
        persona: {
          ...stripMetadata(persona.config.persona),
          name: persona.name,
        },
        runtime,
        judgment: draft.judgment,
        history: state.history,
        userText,
        draft: remaining,
      },
      this.judgeDeps(
        { chatId, personaId: persona.slug },
        persona.variables,
        signal,
        persona,
      ),
    );
    checkCancelled(signal);
    if (review.should_send === false || !review.final_text.trim()) {
      await this.schedule.drop(chatId);
      return;
    }
    const judgment = structuredClone(draft.judgment);
    stageQuestionReview(
      state,
      runtime,
      judgment,
      review.unanswered_question_ids,
    );
    const reply = enforceReplyRules(normalizeReply(review.final_text));
    const parts = splitReplyMessages(reply)
      .flatMap((m) => splitDisplayMessages(m))
      .flatMap((d) => splitMessage(d));
    const refreshed = prepareDelivery(
      {
        reply: [...sent.map((p) => p.text), reply].join('\n'),
        state,
        judgment,
        date: today,
        today,
        basisState: stateFingerprint(base),
        basisPersona: personaFingerprint(persona),
        generatedAt: this.clock.ts(),
      },
      parts,
      this.clock.ts(),
    );
    refreshed.parts = [...sent, ...refreshed.parts];
    refreshed.sentCount = sent.length;
    if (await this.schedule.prepare(chatId, refreshed))
      await this.schedule.restore(pending, this.clock.ts(), 'continuation');
  }

  async handleDeleted(accountId: number, messageIds: number[]): Promise<void> {
    const byChat = await this.history.markDeleted(accountId, messageIds);
    for (const [chatId, ids] of byChat) {
      const release = this.activity.receive(
        chatId,
        `deleted:${accountId}:${ids.join(',')}`,
      );
      try {
        await this.locks.run(chatId, async () => {
          await this.invalidateReply(chatId);
          await this.schedule.removeTurns(chatId, ids);
          await this.state.reconcile(chatId, true);
          if (await this.history.detectClearedByClient(chatId, this.clock.ts()))
            this.log.log(`chat=${chatId}: the client cleared the conversation`);
        });
      } finally {
        release();
      }
    }
  }

  /**
   * Пока чат вёл менеджер, обычный разбор не работал: бот не сочинял, а
   * значит, и не запоминал ни своих прежних слов, ни того, что написал за него
   * менеджер. Догоняем это одним проходом перед тем, как снова заговорить.
   * Сбой разбора не должен мешать ответу — он не критичен для текущего хода.
   */
  private async catchUpPersonaMemory(
    chatId: number,
    state: ConversationState,
    timezone: string,
    deps: JudgeDeps,
  ): Promise<void> {
    try {
      const result = await catchUpPersonaMemory(
        state,
        deps,
        timezone,
        this.clock.ts(),
      );
      if (result.statements)
        this.log.log(
          `chat=${chatId}: caught up on ${result.statements} own message(s) from manual mode, +${result.events} remembered`,
        );
    } catch (e) {
      this.log.warn(
        `chat=${chatId}: persona memory catch-up failed: ${e?.message ?? e}`,
      );
    }
  }

  private async markReadSafe(
    chatId: number,
    accountId: number | null,
  ): Promise<void> {
    await this.transport
      .markRead(chatId, accountId)
      .catch((e) =>
        this.log.warn(`mark read failed chat=${chatId}: ${e?.message ?? e}`),
      );
  }

  private async markListenedSafe(
    chatId: number,
    messageIds: number[],
    accountId: number | null,
  ): Promise<void> {
    await this.transport
      .markListened(chatId, messageIds, accountId)
      .catch((e) =>
        this.log.warn(
          `mark listened failed chat=${chatId}: ${e?.message ?? e}`,
        ),
      );
  }

  private async react(turn: InboundTurn): Promise<void> {
    await this.reactWith(
      turn,
      emojiReaction(turn.media?.emoji ?? '') ?? FALLBACK_REACTION,
    );
  }

  private async reactWith(turn: InboundTurn, emoji: string): Promise<void> {
    try {
      await this.transport.sendReaction(turn.chatId, turn.messageId, emoji);
      await this.history.appendMessage(turn.chatId, {
        role: 'assistant',
        text: `[Реакция: ${emoji}]`,
        ts: this.clock.ts(),
        author: 'llm',
      });
    } catch (e) {
      this.log.warn(`reaction failed chat=${turn.chatId} (${e?.name ?? e})`);
    }
  }

  private async deliverParts(
    chatId: number,
    parts: string[],
    accountId: number | null,
    typing: TypingStyle,
    author: string,
    opts: {
      signal?: AbortSignal;
      beforePart?: () => Promise<void>;
      confirm?: (text: string, id: number, ts: number) => Promise<void>;
    } = {},
  ): Promise<void> {
    let stored = 0;
    const confirm = async (index: number, tgMsgId: number) => {
      if (index < stored) return;
      if (index !== stored || !Number.isSafeInteger(tgMsgId) || tgMsgId <= 0)
        throw new Error('Invalid delivery acknowledgment');
      const ts = this.clock.ts();
      if (opts.confirm) await opts.confirm(parts[index], tgMsgId, ts);
      else
        await this.history.appendMessage(chatId, {
          role: 'assistant',
          text: parts[index],
          ts,
          author,
          tgMsgId,
        });
      stored = index + 1;
    };
    const ids = await this.transport.sendText(chatId, parts, {
      accountId,
      typing,
      signal: opts.signal,
      beforePart: opts.beforePart,
      randomIds: parts.map(() => deliveryRandomId()),
      onDispatch: async () => {
        await opts.beforePart?.();
      },
      onPart: confirm,
    });
    for (let i = stored; i < ids.length; i += 1) await confirm(i, ids[i]);
    if (stored !== parts.length)
      throw new Error('Transport did not acknowledge every reply part');
  }

  private async handOverMediaRequest(
    chatId: number,
    kind: string,
    _state: ConversationState,
    _userText: string,
  ): Promise<void> {
    const label = MEDIA_REQUEST_LABELS[kind] ?? `просит ${kind}`;
    const ts = this.clock.ts();
    await this.history.mergeLeadFacts(
      chatId,
      { [MEDIA_REQUEST_KEY]: { kind, ts } },
      false,
    );
    await this.pause.pause(
      chatId,
      TakeoverReason.MANUAL_TAKEOVER,
      'bot:media_request',
      { reasonText: `${label} — ответьте сами` },
    );
    await this.funnel.emit(chatId, 'media_requested', ts, { kind });
    this.log.log(`chat=${chatId}: ${label} — handed over to a manager`);
  }

  /** Клиент написал стоп-фразу из настроек: бот замолкает, чат — менеджеру. */
  private async handOverByTrigger(
    chatId: number,
    phrase: string,
    ts: number,
  ): Promise<void> {
    await this.history.mergeLeadFacts(
      chatId,
      { [HANDOFF_TRIGGER_KEY]: { phrase, ts } },
      false,
    );
    await this.pause.pause(
      chatId,
      TakeoverReason.MANUAL_TAKEOVER,
      'bot:trigger',
      { reasonText: `клиент написал «${phrase}» — ответьте сами` },
    );
    await this.funnel.emit(chatId, 'trigger_handoff', ts, { phrase });
    this.log.log(
      `chat=${chatId}: trigger «${phrase}» — handed over to a manager`,
    );
  }

  private readonly nextActionCache = new Map<
    number,
    { at: number; value: NextBotAction }
  >();

  async nextAction(chatId: number, maxAgeSeconds = 0): Promise<NextBotAction> {
    const nowTs = this.clock.ts();
    const cached = this.nextActionCache.get(chatId);
    if (cached && maxAgeSeconds > 0) {
      const age = nowTs - cached.at;
      if (age < maxAgeSeconds) return cached.value;
      if (age < FORECAST_STALE_SECONDS) {
        void this.refreshNextAction(chatId);
        return cached.value;
      }
    }
    return this.computeNextAction(chatId, nowTs);
  }

  private readonly refreshing = new Set<number>();
  private refreshQueue: number[] = [];

  private refreshNextAction(chatId: number): void {
    if (this.refreshing.has(chatId) || this.refreshQueue.includes(chatId))
      return;
    this.refreshQueue.push(chatId);
    if (this.refreshing.size >= FORECAST_REFRESH_LANES) return;
    void this.drainForecastQueue();
  }

  private async drainForecastQueue(): Promise<void> {
    for (
      let next = this.refreshQueue.shift();
      next !== undefined;
      next = this.refreshQueue.shift()
    ) {
      if (this.refreshing.has(next)) continue;
      this.refreshing.add(next);
      try {
        await this.computeNextAction(next, this.clock.ts());
      } catch {
        // Прогноз — подсказка для панели: не вышло, покажем прежний и попробуем позже.
      } finally {
        this.refreshing.delete(next);
      }
    }
  }

  private async computeNextAction(
    chatId: number,
    nowTs: number,
  ): Promise<NextBotAction> {
    const accountId = await this.history.chatOwnerAccount(chatId);
    const persona =
      accountId === null
        ? await this.persona.default()
        : await this.persona.forAccount(accountId, chatId);
    const [
      pause,
      facts,
      schedule,
      marks,
      lastRole,
      state,
      settings,
      blocked,
      account,
    ] = await Promise.all([
      this.pause.status(chatId),
      this.history.getLeadFacts(chatId),
      this.schedule.get(chatId),
      this.history.rhythmMarks(chatId, nowTs + 1),
      this.history.lastStoredRole(chatId),
      this.state.load(chatId),
      this.settings.get(),
      this.history.isBlockedByClient(chatId),
      accountId === null ? null : this.history.accountState(accountId),
    ]);
    const value = forecastNextAction({
      chatId,
      nowTs,
      stopped: this.gate.stopped,
      ready: this.persona.ready,
      hasAccount: accountId !== null,
      accountOnline:
        accountId === null || !this.transport.isOnline
          ? undefined
          : this.transport.isOnline(accountId),
      accountLost:
        account &&
        (account.status === 'banned' ||
          (account.status === 'unauthorized' && account.since !== null))
          ? (account.status as 'banned' | 'unauthorized')
          : null,
      blockedByClient: blocked,
      paused: pause.status === 'paused',
      refused: Boolean(facts[REFUSAL_LOCK_KEY]),
      schedule: schedule
        ? { dueAt: schedule.dueAt, reason: schedule.reason }
        : null,
      composing: this.composing.has(chatId),
      lastRole,
      lastUserTs: marks.prevUserTs,
      lastAssistantTs: marks.lastAssistantTs,
      unansweredQuestion:
        conversational(persona.config) &&
        (hasUnansweredInbound(state.history) ||
          openQuestions(state).length > 0),
      state,
      rhythm: persona.rhythm,
      settings,
    });
    this.nextActionCache.set(chatId, { at: nowTs, value });
    return value;
  }

  async answerAfterResume(chatId: number): Promise<boolean> {
    await this.locks.run(chatId, () => this.state.reconcile(chatId));
    if (this.gate.stopped || !this.persona.ready) return false;
    if ((await this.pause.status(chatId)).status === 'paused') return false;
    if (await this.schedule.get(chatId)) return false;
    const accountId = await this.history.chatOwnerAccount(chatId);
    if (accountId === null) return false;
    const tail = await this.history.unansweredMessages(chatId);
    const last = tail[tail.length - 1];
    if (!last?.source_message_id) return false;
    this.log.log(
      `chat=${chatId}: resumed with ${tail.length} unanswered message(s) — answering`,
    );
    const release = this.activity.receive(
      chatId,
      `resume:${deliveryRandomId()}`,
    );
    try {
      for (const message of tail) {
        if (!message.source_message_id) continue;
        await this.handleInbound(restoredTurn(message, accountId));
      }
    } finally {
      release();
    }
    return true;
  }

  async answerAfterCall(callId: string): Promise<boolean> {
    if (!this.prisma) return false;
    const db = this.prisma;
    const call = await db.voiceCall.findUnique({
      where: { id: callId },
      include: { task: true },
    });
    if (!call?.endedAt || !['pending', 'resume'].includes(call.followupStatus))
      return false;
    const chatId = Number(call.chatId),
      now = this.clock.ts();
    const skip = () =>
      db.voiceCall.updateMany({
        where: { id: callId, followupStatus: { in: ['pending', 'resume'] } },
        data: { followupStatus: 'skipped' },
      });
    if (call.followupStatus === 'resume') {
      await skip();
      return this.answerAfterResume(chatId);
    }
    if (now < call.endedAt + 45) return false;
    const contact = await db.contact.findUnique({
      where: { chatId: call.chatId },
      include: { account: { include: { manager: true } } },
    });
    if (
      !call.connectedAt ||
      now - call.endedAt > 600 ||
      contact?.pauseState !== 'active' ||
      contact.accountId !== call.accountId ||
      contact.account?.personaId !== call.task.personaSlug ||
      (contact.account?.manager?.userId !== call.task.managerId &&
        !(
          call.task.chatGrantedById &&
          call.task.chatGrantAccountId === call.accountId &&
          !contact.account?.manager
        ))
    ) {
      await skip();
      return false;
    }
    if (
      this.gate.stopped ||
      !this.persona.ready ||
      !(await this.canReach(chatId, call.accountId))
    )
      return false;
    const newer = await db.message.findFirst({
      where: {
        chatId: call.chatId,
        deletedAt: null,
        ts: { gt: call.endedAt },
        role: { in: ['user', 'assistant'] },
      },
    });
    if (newer || (await this.schedule.get(chatId))) {
      await skip();
      return this.answerAfterResume(chatId);
    }
    const settings = await this.settings.get();
    if (settings.initiative_enabled === false) {
      await skip();
      return false;
    }
    const persona = await this.persona.forAccount(call.accountId, chatId);
    let claimed = false;
    try {
      const sent = await this.locks.run(chatId, () =>
        this.sendUnprompted(
          chatId,
          call.accountId,
          persona,
          settings,
          {
            goal: 'respond',
            storyline_id: '',
            question_allowed: false,
            guidance:
              'Только что закончился подтверждённый голосовой разговор. Если уместно, напиши одну короткую тёплую реплику в своём характере. Можно сказать, что было приятно пообщаться. Не выдумывай подробности звонка или впечатления от голоса; опирайся на call_context и заметку войсера. При неуместности судья отменит сообщение.',
          },
          {
            author: 'after_call',
            maxBubbles: 1,
            stillDue: (state) =>
              !state.history.some((m) => m.created_at > call.endedAt!) &&
              (!state.history_reset || state.history_reset.at < call.endedAt!),
            beforeDispatch: async () => {
              if (claimed) return;
              const changed = await db.voiceCall.updateMany({
                where: {
                  id: callId,
                  followupStatus: 'pending',
                  note: call.note,
                },
                data: { followupStatus: 'sending' },
              });
              if (!changed.count) throw new ReplySuperseded();
              claimed = true;
            },
            record: () => {},
          },
        ),
      );
      await db.voiceCall.updateMany({
        where: { id: callId, followupStatus: { in: ['pending', 'sending'] } },
        data: { followupStatus: sent ? 'sent' : 'skipped' },
      });
      return sent;
    } catch {
      await db.voiceCall.updateMany({
        where: { id: callId, followupStatus: 'sending' },
        data: { followupStatus: 'review' },
      });
      await skip();
      this.log.warn(`after-call follow-up failed call=${callId}`);
      return false;
    }
  }

  private async timeContext(
    persona: LoadedPersona,
    state: ConversationState,
  ): Promise<TurnTime> {
    const slots = state.character?.slots ?? {};
    const cleared = (state.character?.cleared_slots ?? []).some((key) =>
      ['location', 'current_location', 'city'].includes(key),
    );
    const location = String(
      slots['current_location'] ||
        slots['location'] ||
        slots['city'] ||
        (cleared
          ? ''
          : (persona.variables.interlocutor_city ?? persona.variables.city)) ||
        '',
    );
    const [other, own] = await Promise.all([
      this.persona.interlocutorLocation(location),
      // Без названия города модель додумывает его по биографии, где мест
      // упомянуто несколько, и путается в собственных часах.
      this.persona.personaPlace(persona),
    ]);
    return turnTime(own, other, this.clock.now());
  }

  private async generateReply(
    chatId: number,
    userText: string,
    attachmentContext: string,
    extraNote = '',
    farewell: { goodnight: boolean; morning: boolean } = {
      goodnight: false,
      morning: false,
    },
    incoming?: PendingTurn[],
    signal?: AbortSignal,
  ): Promise<PreparedReply | null> {
    checkCancelled(signal);
    const loaded = await this.persona.forChat(chatId);
    const { config, name, prompts, slug, variables } = loaded;
    const scope: UsageScope = { chatId, personaId: slug };
    const model = generatorModelFor(loaded, appConfig.generatorModel);
    const today = characterDate(this.clock.now(), config.timeZone);
    const gender = personaGender(config.persona);
    const customInstructions = [
      (await this.settings.get()).custom_prompt,
      extraNote,
      farewellNote(farewell, gender),
    ]
      .filter((x) => x && x.trim())
      .join('\n\n');
    const baseState = await this.state.reconcile(chatId);
    const basisState = stateFingerprint(baseState);
    const generatedAt = this.clock.ts();
    const state = structuredClone(baseState);
    const pendingIds = new Set((incoming ?? []).map((t) => t.turn.messageId));

    const history = (state.history ?? [])
      .filter(
        (m) => m.role !== 'user' || !pendingIds.has(m.telegram_message_id!),
      )
      .map((m) =>
        m.role === 'user'
          ? {
              ...m,
              content: withAttachmentContext(
                m.content ?? '',
                m.attachment_context ?? '',
              ),
            }
          : m,
      );
    state.history = state.history.filter(
      (m) => m.role !== 'user' || !pendingIds.has(m.telegram_message_id!),
    );
    const lateMark = extraNote
      ? `[Это сообщение пришло давно, и ты на него тогда не ${voiceOf(gender).v('ответила', 'ответил')} — см. инструкции]\n`
      : '';
    const fullText =
      lateMark + withAttachmentContext(userText, attachmentContext);

    const calls = this.prisma
      ? await callContext(this.prisma, chatId, state.history_reset?.at)
      : [];
    await this.catchUpPersonaMemory(
      chatId,
      state,
      config.timeZone ?? 'UTC',
      this.judgeDeps(scope, variables, signal, loaded),
    );
    let runtime = prepareTurn(config, state, fullText, today, this.clock.ts());
    runtime.call_context = calls;
    runtime.time_context = await this.timeContext(loaded, state);
    const voiceAvailability = await this.autoVoice?.context(chatId);
    runtime.voice_availability = voiceAvailability;
    const judgment = await judgeDialogue(
      {
        prompt: prompts.judge_plan,
        runtime,
        history,
        userText: fullText,
        customInstructions,
      },
      this.judgeDeps(scope, variables, signal, loaded),
    );
    checkCancelled(signal);
    if (
      judgment.media_request &&
      judgment.media_request !== 'voice' &&
      mentionsMedia(userText)
    ) {
      await this.handOverMediaRequest(
        chatId,
        judgment.media_request,
        state,
        userText,
      );
      return null;
    }
    if (judgment.media_request && judgment.media_request !== 'voice') {
      this.log.log(
        `chat=${chatId}: model saw a ${judgment.media_request} request, but the message has no media words — answering`,
      );
    }
    runtime = applyJudgment(
      config,
      state,
      judgment,
      fullText,
      today,
      Math.random,
      this.clock.ts(),
    );
    // Обычный ход разобрал свои реплики сам — догонять их больше не нужно.
    state.persona_memory_cursor = latestPersonaMessageId(state);
    runtime.call_context = calls;
    for (const memory of state.memories) {
      const previous = baseState.memories.find((m) => m.id === memory.id);
      if (JSON.stringify(previous) !== JSON.stringify(memory))
        memory.source_message_ids = [...pendingIds];
    }
    runtime.voice_availability = voiceAvailability;
    const voice =
      voiceAvailability?.available && judgment.voice_reply?.send
        ? {
            emotion:
              judgment.voice_reply.emotion ||
              'Естественно, в характере личности',
            reason: judgment.voice_reply.reason,
            context_id: voiceAvailability.context_id,
            context_hash: voiceAvailability.context_hash,
          }
        : undefined;
    runtime.delivery_context = {
      kind: voice ? 'voice' : 'text',
      reason: voice?.reason || null,
    };
    runtime.time_context = await this.timeContext(loaded, state);

    checkCancelled(signal);
    const draft = await generateDraft(
      {
        model,
        system: buildCharacterPrompt({
          config,
          runtime,
          judgment,
          name,
          prompts,
          customInstructions,
        }),
        history,
        userText: fullText,
      },
      this.llmDeps(scope, variables, signal),
    );
    checkCancelled(signal);
    const persona = stripMetadata(config.persona);
    persona['name'] = name;
    runtime.time_context = turnTime(
      runtime.time_context.persona,
      runtime.time_context.interlocutor,
      this.clock.now(),
    );
    const review = await reviewReply(
      {
        prompt: prompts.judge_review,
        persona,
        runtime,
        judgment,
        history,
        userText: fullText,
        draft,
      },
      this.judgeDeps(scope, variables, signal, loaded),
    );
    checkCancelled(signal);
    stageQuestionReview(
      state,
      runtime,
      judgment,
      review.unanswered_question_ids,
    );
    state.judge_review = { approved: review.approved, issues: review.issues };

    let reply = enforceReplyRules(normalizeReply(review.final_text));
    if (runtime.onboarding.already_greeted) reply = dropRepeatedGreeting(reply);
    const trimmed = dropRepeatedFarewell(reply, farewell);
    if (trimmed !== reply)
      this.log.log(
        `chat=${chatId}: repeated goodnight/morning dropped from the reply`,
      );
    reply = trimmed;
    state.history = structuredClone(baseState.history);
    if (attachmentContext) {
      const latest = [...state.history]
        .reverse()
        .find(
          (m) => m.role === 'user' && pendingIds.has(m.telegram_message_id!),
        );
      if (latest) {
        latest.attachment_context = attachmentContext;
        latest.source = 'telegram_photo';
      }
    }
    return {
      reply,
      ...(voice && reply.length <= 800 ? { voice } : {}),
      state,
      judgment,
      date: runtime.date,
      today,
      basisState,
      basisPersona: personaFingerprint(loaded),
      generatedAt,
    };
  }

  private bookkeep(
    state: ConversationState,
    judgment: Judgment,
    date: string,
    reply: string,
    today: string,
  ) {
    completeQuestionReview(state, judgment);
    const character = (state.character ??= {});
    if (judgment.storyline_id && judgment.goal === 'share') {
      (character.shared_stories ??= {})[judgment.storyline_id] = date;
    }
    if (judgment.target_slot && reply.includes('?')) {
      character.last_goal_turn = character.turns;
      const asks = (character.slot_asks ??= {});
      asks[judgment.target_slot] = (asks[judgment.target_slot] ?? 0) + 1;
    }
    if (judgment.callback_memory_id)
      markMemoryRecalled(state, judgment.callback_memory_id, today);
    character.self_intro_shared = true;
  }

  private async mirrorLeadFacts(
    chatId: number,
    state: ConversationState,
  ): Promise<void> {
    const slots = state.character?.slots ?? {};
    const patch: LeadFacts = {};
    const names = { location: 'city', current_location: 'city', work: 'job' };
    for (const key of state.character?.cleared_slots ?? [])
      patch[names[key] ?? key] = null;
    for (const key of [
      'name',
      'age',
      'city',
      'job',
      'family',
      'hobby',
      'dating_site',
    ]) {
      if (slots[key])
        patch[key] =
          key === 'age' ? Number(slots[key]) || slots[key] : slots[key];
    }
    if (!patch['city'] && slots['location']) patch['city'] = slots['location'];
    if (!patch['job'] && slots['work']) patch['job'] = slots['work'];
    patch['funnel_stage'] =
      ACQUAINTANCE_TO_FUNNEL[state.character?.stage_id ?? ''] ??
      DEFAULT_FUNNEL_STAGE;
    patch['_brain_stage'] = state.character?.stage_id ?? '';
    patch['_brain_turns'] = state.character?.turns ?? 0;
    await this.history.mergeLeadFacts(chatId, patch, false);
  }

  private async invalidateReply(chatId: number): Promise<void> {
    const draft = (await this.schedule.get(chatId))?.delivery;
    if (
      draft?.parts
        .slice(draft.sentCount)
        .some((p) => p.dispatchedAt !== undefined)
    ) {
      await this.pause.pause(
        chatId,
        TakeoverReason.HOLD,
        'system:delivery_check',
        {
          reasonText:
            'Отправка прервана без подтверждения Telegram. Проверьте последние сообщения перед продолжением.',
        },
      );
      await this.schedule.drop(chatId);
    } else await this.schedule.invalidate(chatId);
  }

  private async withOperatorChange<T>(
    chatId: number,
    body: () => Promise<T>,
  ): Promise<T> {
    const release = this.activity.receive(
      chatId,
      `operator:${deliveryRandomId()}`,
    );
    try {
      return await this.locks.run(chatId, async () => {
        await this.invalidateReply(chatId);
        return body();
      });
    } finally {
      release();
    }
  }

  async noteOperatorQueued(chatId: number): Promise<void> {
    await this.withOperatorChange(chatId, async () => {
      await this.autoVoice?.cancelForChat(
        chatId,
        'Менеджер подготовил свой ответ',
      );
      await this.schedule.drop(chatId);
    });
  }

  async noteOperatorFacts(
    chatId: number,
    facts: Record<string, unknown>,
  ): Promise<void> {
    const patch: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(facts)) {
      const slotId = FACT_TO_SLOT[key];
      if (!slotId) continue;
      patch[slotId] =
        value === null || value === undefined || value === ''
          ? null
          : String(value);
    }
    if (!Object.keys(patch).length) return;
    await this.withOperatorChange(chatId, async () => {
      const state = await this.state.load(chatId);
      const persona = await this.persona.forChat(chatId);
      const changed = applyOperatorSlots(
        state,
        patch,
        characterDate(this.clock.now(), persona.rhythm.timezone),
      );
      if (!changed.length) return;
      await this.state.save(chatId, state);
      this.log.log(`chat=${chatId}: operator set ${changed.join(', ')}`);
    });
  }

  async setSlot(
    chatId: number,
    slotId: string,
    value: string | null,
  ): Promise<{ slot_id: string; value: string | null }> {
    return this.withOperatorChange(chatId, async () => {
      const persona = await this.persona.forChat(chatId);
      const known = (
        (persona.config.goals['slots'] ?? []) as Array<{ id: string }>
      ).some((slot) => slot.id === slotId);
      if (!known)
        throw new Error(`у личности «${persona.slug}» нет темы «${slotId}»`);
      const state = await this.state.load(chatId);
      applyOperatorSlots(
        state,
        { [slotId]: value },
        characterDate(this.clock.now(), persona.rhythm.timezone),
      );
      await this.state.save(chatId, state);
      await this.mirrorLeadFacts(chatId, state);
      const stored = state.character?.slots?.[slotId] ?? null;
      return { slot_id: slotId, value: stored };
    });
  }

  async noteAutomatedVoiceMessage(
    chatId: number,
    text: string,
    ts: number,
    replyId: string,
  ): Promise<void> {
    await this.locks.run(chatId, async () => {
      const scheduled = await this.schedule.get(chatId),
        draft = scheduled?.delivery;
      const same = draft?.id === replyId;
      const untouched =
        same &&
        stateFingerprint(await this.state.load(chatId)) === draft.basisState;
      const actual = await this.state.reconcile(chatId);
      if (untouched && draft.voice) {
        const next = structuredClone(draft.state);
        next.history = actual.history;
        next.history_cursor = actual.history_cursor;
        this.bookkeep(next, draft.judgment, draft.date, text, draft.today);
        await this.state.save(chatId, next);
        await this.mirrorLeadFacts(chatId, next);
      }
      if (same) await this.schedule.drop(chatId);
    });
  }

  async noteOperatorMessage(chatId: number): Promise<void> {
    await this.withOperatorChange(chatId, async () => {
      await this.schedule.drop(chatId);
      await this.state.reconcile(chatId);
    });
  }

  async editOwnMessage(
    chatId: number,
    messageId: number,
    text: string,
  ): Promise<{ id: number; text: string; edited_at: number }> {
    const clean = text.trim();
    if (!clean)
      throw new UnprocessableEntityException(
        'пустое сообщение — удалите его в Telegram, а не правьте',
      );
    const row = await this.history.messageById(chatId, messageId);
    if (!row) throw new NotFoundException('сообщение не найдено');
    if (row.role !== 'assistant')
      throw new UnprocessableEntityException(
        'править можно только свои сообщения',
      );
    if (row.deletedAt)
      throw new UnprocessableEntityException('сообщение удалено в Telegram');
    if (!row.tgMsgId)
      throw new UnprocessableEntityException(
        'сообщение ещё не ушло в Telegram',
      );
    if (row.mediaKind || /^\[(media:|Реакция)/.test(row.text))
      throw new UnprocessableEntityException(
        'у вложений и реакций текст не правится',
      );
    if (!this.transport.editText)
      throw new UnprocessableEntityException('правка сообщений недоступна');
    try {
      await this.transport.editText(chatId, row.tgMsgId, clean);
    } catch (e) {
      const msg = String(e?.errorMessage ?? e?.message ?? e);
      if (/MESSAGE_EDIT_TIME_EXPIRED/i.test(msg))
        throw new UnprocessableEntityException(
          'Telegram больше не даёт править это сообщение — прошло слишком много времени',
        );
      if (/MESSAGE_NOT_MODIFIED/i.test(msg))
        return {
          id: row.id,
          text: row.text,
          edited_at: row.editedAt ?? this.clock.ts(),
        };
      throw new UnprocessableEntityException(
        `Telegram не принял правку: ${msg}`,
      );
    }
    const ts = this.clock.ts();
    const changed = await this.history.editMessageText(
      chatId,
      { id: row.id },
      clean,
      ts,
    );
    if (changed)
      await this.noteEdited(
        chatId,
        'assistant',
        changed.old,
        clean,
        changed.id,
      );
    return { id: row.id, text: clean, edited_at: ts };
  }

  async noteEdited(
    chatId: number,
    role: 'user' | 'assistant',
    oldText: string,
    newText: string,
    messageId?: number,
  ): Promise<void> {
    await this.withOperatorChange(chatId, async () => {
      const state = await this.state.load(chatId);
      const matches = state.history.filter(
        (m) =>
          m.role === role &&
          (messageId
            ? m.panel_message_id === messageId
            : m.content === oldText),
      );
      const edited = matches.length === 1 ? matches[0] : undefined;
      const panel = messageId
        ? await this.history.messageById(chatId, messageId)
        : null;
      const tgId = edited?.telegram_message_id ?? panel?.tgMsgId ?? undefined;
      await this.schedule.editText(chatId, role, oldText, newText, tgId);
      if (edited) edited.content = newText;
      if (role === 'user') {
        const cleared = new Set<string>();
        state.memories = (state.memories ?? []).filter((m) => {
          const affected =
            (tgId && m.source_message_ids?.includes(tgId)) ||
            (!m.source_message_ids?.length &&
              Boolean(oldText) &&
              m.evidence?.includes(oldText));
          if (affected && m.slot_id) cleared.add(m.slot_id);
          return !affected;
        });
        for (const [key, value] of Object.entries(
          state.character.slots ?? {},
        )) {
          if (
            value &&
            oldText.includes(value) &&
            !newText.includes(value) &&
            !state.memories.some(
              (m) =>
                m.slot_id === key &&
                ['operator', 'profile_settings'].includes(m.source),
            )
          )
            cleared.add(key);
        }
        for (const key of cleared) delete state.character.slots?.[key];
        state.character.cleared_slots = [
          ...new Set([...(state.character.cleared_slots ?? []), ...cleared]),
        ];
        await this.mirrorLeadFacts(chatId, state);
      }
      pruneUnsupportedEvents(state);
      await this.state.save(chatId, state);
      if (messageId) await this.state.reconcile(chatId, true);
    });
  }

  cacheSizes(): Record<string, number> {
    return {
      замки: this.locks.size,
      прогнозы: this.nextActionCache.size,
      готовится: this.composing.size,
      сбои: this.replyFailures.size,
    };
  }

  async openLead(
    chatId: number,
    accountId: number,
    lead: LeadIntro,
  ): Promise<string> {
    return this.locks.run(chatId, async () => {
      const work = this.activity.start(chatId);
      if (!work) throw new ReplySuperseded();
      try {
        if (await this.automationBlock(chatId, accountId, false))
          throw new Error(
            'Автоматическая отправка запрещена для этого диалога',
          );
        const persona = await this.persona.forAccount(accountId, chatId);
        const state = await this.state.load(chatId);
        if (state.history.length)
          throw new Error(`chat ${chatId} already has a transcript`);
        if (lead.firstName) state.user_name = lead.firstName;
        const site =
          lead.site?.trim() ||
          persona.variables['site'] ||
          datingSiteOf(persona.config.persona);
        state.character = {
          ...(state.character ?? {}),
          slots: {
            ...(state.character?.slots ?? {}),
            ...leadSlots(lead, site),
          },
        };

        const reply = fillText(persona.prompts.opener, {
          ...persona.variables,
          ...(site ? { site } : {}),
        });
        await this.deliverParts(
          chatId,
          [reply],
          accountId,
          persona.rhythm.typing,
          'outreach',
          {
            signal: work.signal,
            beforePart: async () => {
              checkCancelled(work.signal);
              if (
                (await this.automationBlock(chatId, accountId, false)) ||
                (await this.history.hasPendingManualReply(chatId))
              )
                throw new ReplySuperseded();
              checkCancelled(work.signal);
            },
            confirm: async (text, id, ts) => {
              appendAssistantMessage(state, text, 'outreach', ts);
              await this.state.confirmPart(
                chatId,
                state,
                text,
                'outreach',
                id,
                ts,
              );
            },
          },
        );
        const ts = this.clock.ts();
        await this.funnel.emit(chatId, 'message_out', ts, {
          chars: reply.length,
          bubbles: 1,
          outreach: true,
        });

        await this.mirrorLeadFacts(chatId, state);
        return reply;
      } finally {
        work.finish();
      }
    });
  }

  private async automationBlock(
    chatId: number,
    accountId: number,
    needsModel = true,
  ): Promise<string | null> {
    if (this.gate.stopped) return 'stopped';
    if (await this.autoVoice?.pending(chatId)) return 'voicer';
    if (needsModel && this.persona.ready === false) return 'model';
    if ((await this.pause.status(chatId)).status === 'paused') return 'paused';
    if ((await this.history.getLeadFacts(chatId))[REFUSAL_LOCK_KEY])
      return 'refused';
    if (await this.history.isBlockedByClient(chatId)) return 'blocked';
    const current = await this.persona
      .forAccount(accountId, chatId)
      .catch(() => null);
    if (!current || current.enabled === false) return 'persona';
    if (current.locationIssue) {
      await this.pause.pause(
        chatId,
        TakeoverReason.HOLD,
        'system:persona_location',
        { reasonText: current.locationIssue },
      );
      return 'persona';
    }
    return null;
  }

  private async canReach(chatId: number, accountId: number): Promise<boolean> {
    if (this.transport.isOnline && !this.transport.isOnline(accountId))
      return false;
    return !(await this.history.isBlockedByClient(chatId));
  }

  async runInitiative(): Promise<number> {
    const settings = await this.settings.get();
    if (
      !settings.initiative_enabled ||
      this.gate.stopped ||
      !this.persona.ready
    )
      return 0;
    const since = this.clock.ts() - ACTIVE_CHAT_DAYS * 86400;
    let sent = 0;
    for (const chatId of await this.state.activeChatIds(since)) {
      try {
        const done = await this.locks.run(chatId, () =>
          this.proactive(chatId, settings),
        );
        if (done) sent += 1;
      } catch (e) {
        this.log.error(`initiative failed chat=${chatId} (${e?.name ?? e})`);
      }
    }
    return sent;
  }

  private async proactive(
    chatId: number,
    settings: Awaited<ReturnType<SettingsService['get']>>,
  ): Promise<boolean> {
    const now = this.clock.now();
    const initiative = {
      initiative_enabled: true,
      proactive_max_per_day: settings.proactive_max_per_day,
      quiet_start: settings.quiet_start,
      quiet_end: settings.quiet_end,
    };
    const state = await this.state.load(chatId);
    if (!state.history.some((m) => m.role === 'user')) return false;
    if ((await this.pause.status(chatId)).status === 'paused') return false;
    if (await this.schedule.get(chatId)) return false;
    const accountId = await this.history.chatOwnerAccount(chatId);
    if (accountId === null) return false;
    if (
      (await this.automationBlock(chatId, accountId)) ||
      !(await this.canReach(chatId, accountId))
    )
      return false;

    const persona = await this.persona.forAccount(accountId, chatId);
    if (
      conversational(persona.config) &&
      (hasUnansweredInbound(state.history) || openQuestions(state).length > 0)
    )
      return false;
    if (!initiativeIsDue(state, initiative, now, persona.rhythm.timezone))
      return false;
    if (unansweredUnprompted(state) >= persona.rhythm.max_unanswered)
      return false;
    const morning = ritualSlot(
      now,
      persona.rhythm.morning,
      persona.rhythm.timezone,
      chatId,
      'morning',
    );
    if (
      persona.rhythm.morning.enabled &&
      morning.windowStartTs !== null &&
      !state.rhythm?.morning?.[morning.day]
    )
      return false;
    const today = characterDate(now, persona.rhythm.timezone);
    const runtime = buildRuntimeSnapshot(
      persona.config,
      state,
      today,
      '',
      this.clock.ts(),
    );
    const callback = runtime.callback_candidates.find(
      (m) => m.kind === 'open_loop',
    );
    const gender = personaGender(persona.config.persona);
    const g = voiceOf(gender);
    const judgment: Partial<Judgment> = callback
      ? {
          goal: 'callback',
          callback_memory_id: callback.id,
          storyline_id: '',
          question_allowed: true,
          guidance: `${g.they.he === 'он' ? 'Он' : 'Она'} давно не отвечает. Напиши ${g.v('сама', 'сам')} одну короткую реплику в одну строку: ненавязчиво спроси, чем закончилось ${g.they.him} незавершённое дело из памяти. Не рассказывай ничего о себе.`,
        }
      : {
          goal: 'respond',
          callback_memory_id: '',
          storyline_id: '',
          question_allowed: true,
          guidance: checkInGuidance(gender),
        };

    if (conversational(persona.config)) {
      judgment.goal = 'respond';
      judgment.callback_memory_id = '';
      judgment.guidance =
        'Выбери один естественный повод написать: актуальное дело собеседника, общую шутку, собственную согласованную деталь или личное любопытство. Не повторяй недавний вопрос и не присылай отчёт о дне. Учитывай просьбу о тишине и отсутствие связи. Не придумывай событие ради повода; сообщение можно отменить при проверке.';
    }
    return this.sendUnprompted(chatId, accountId, persona, settings, judgment, {
      author: 'initiative',
      maxBubbles: 1,
      stillDue: (latest) =>
        initiativeIsDue(
          latest,
          initiative,
          this.clock.now(),
          persona.rhythm.timezone,
        ) && unansweredUnprompted(latest) < persona.rhythm.max_unanswered,
      record: (latest, ts) => {
        const init = (latest.initiative ??= {});
        const sentByDate = (init.sent_by_date ??= {});
        (sentByDate[today] ??= []).push(ts);
        const keepFrom = shiftDate(today, -INITIATIVE_RETENTION_DAYS);
        init.sent_by_date = Object.fromEntries(
          Object.entries(sentByDate).filter(([day]) => day >= keepFrom),
        );
      },
    });
  }

  private async sendUnprompted(
    chatId: number,
    accountId: number,
    persona: LoadedPersona,
    settings: Awaited<ReturnType<SettingsService['get']>>,
    judgment: Partial<Judgment>,
    opts: {
      author: string;
      maxBubbles?: number;
      beforeDispatch?: () => Promise<void>;
      stillDue: (latest: ConversationState) => boolean;
      record: (latest: ConversationState, ts: number) => void;
    },
  ): Promise<boolean> {
    return this.withReply(chatId, async (signal) => {
      if (await this.automationBlock(chatId, accountId)) return false;
      const { config, name, prompts, slug, variables } = persona;
      const scope: UsageScope = { chatId, personaId: slug };
      const today = characterDate(this.clock.now(), config.timeZone);
      const state = await this.state.reconcile(chatId);
      const model = generatorModelFor(persona, appConfig.generatorModel);
      const runtime = buildRuntimeSnapshot(
        config,
        state,
        today,
        '',
        this.clock.ts(),
      );
      const startedAt = this.clock.ts();
      runtime.time_context = await this.timeContext(persona, state);
      runtime.call_context = this.prisma
        ? await callContext(this.prisma, chatId, state.history_reset?.at)
        : [];
      runtime.delivery_context = {
        kind: opts.author,
        reason:
          opts.author === 'goodnight'
            ? goodnightReason(state.history, startedAt)
            : null,
      };
      if (opts.author === 'goodnight' && !runtime.delivery_context.reason)
        return false;
      const otherHour = runtime.time_context.interlocutor.hour;
      if (
        !['goodnight', 'after_call'].includes(opts.author) &&
        otherHour !== null &&
        (otherHour < 8 || otherHour >= 23)
      )
        return false;
      checkCancelled(signal);
      const prompt = buildCharacterPrompt({
        config,
        runtime,
        judgment,
        name,
        prompts,
        customInstructions: settings.custom_prompt,
      });
      const system = {
        stable: prompt.stable,
        volatile: `${prompt.volatile}\n\n${prompts.initiative_suffix}`,
      };
      const draft = await generateDraft(
        {
          model,
          system,
          history: state.history,
          userText: 'Напиши запланированное инициативное сообщение.',
        },
        this.llmDeps(scope, variables, signal),
      );
      checkCancelled(signal);
      const card = stripMetadata(config.persona);
      card['name'] = name;
      runtime.time_context = turnTime(
        runtime.time_context.persona,
        runtime.time_context.interlocutor,
        this.clock.now(),
      );
      const review = await reviewReply(
        {
          prompt: prompts.judge_review,
          persona: card,
          runtime,
          judgment,
          history: state.history,
          userText: '',
          draft,
        },
        this.judgeDeps(scope, variables, signal, persona),
      );
      const reply =
        ['goodnight', 'initiative', 'after_call'].includes(opts.author) &&
        review.should_send === false
          ? ''
          : enforceReplyRules(normalizeReply(review.final_text));

      checkCancelled(signal);
      const latest = await this.state.load(chatId);
      if (!opts.stillDue(latest)) return false;
      if (await this.automationBlock(chatId, accountId)) return false;
      if (
        (await this.schedule.get(chatId)) ||
        (await this.history.hasPendingManualReply(chatId))
      )
        return false;
      if (
        opts.author !== 'after_call' &&
        conversational(config) &&
        (hasUnansweredInbound(latest.history) ||
          openQuestions(latest).length > 0)
      )
        return false;

      const freshMarks = await this.history.rhythmMarks(
        chatId,
        this.clock.ts() + 1,
      );
      if (
        Math.max(freshMarks.prevUserTs ?? 0, freshMarks.lastAssistantTs ?? 0) >=
        startedAt
      )
        return false;
      if (opts.author === 'goodnight' && review.should_send !== true) {
        const slot = ritualSlot(
          this.clock.now(),
          persona.rhythm.goodnight,
          persona.rhythm.timezone,
          chatId,
          'goodnight',
        );
        (latest.rhythm ??= {}).goodnight ??= {};
        latest.rhythm.goodnight[slot.day] = 'skipped';
        pruneRhythm(latest.rhythm, slot.day);
        latest.judge_review = {
          approved: false,
          issues: review.issues,
          source: opts.author,
        };
        await this.state.save(chatId, latest);
        return false;
      }
      if (!reply.trim()) return false;

      const timestamp = this.clock.ts();
      const parts = splitReplyMessages(reply, opts.maxBubbles ?? 2)
        .flatMap((m) => splitDisplayMessages(m))
        .flatMap((d) => splitMessage(d));
      let recorded = false;
      await this.deliverParts(
        chatId,
        parts,
        accountId,
        persona.rhythm.typing,
        opts.author,
        {
          signal,
          beforePart: async () => {
            checkCancelled(signal);
            if (opts.author !== 'after_call' && conversational(config)) {
              const fresh = await this.state.load(chatId);
              if (
                hasUnansweredInbound(fresh.history) ||
                openQuestions(fresh).length > 0
              )
                throw new ReplySuperseded();
            }
            if (
              (await this.automationBlock(chatId, accountId)) ||
              (await this.settings.get()).initiative_enabled === false ||
              personaFingerprint(
                await this.persona.forAccount(accountId, chatId),
              ) !== personaFingerprint(persona) ||
              (await this.schedule.get(chatId)) ||
              (await this.history.hasPendingManualReply(chatId)) ||
              this.clock.ts() - startedAt > REPLY_FRESH_SECONDS ||
              today !==
                characterDate(this.clock.now(), persona.rhythm.timezone) ||
              timeClaimIssues(reply, await this.timeContext(persona, latest))
                .length
            )
              throw new ReplySuperseded();
            if (!opts.stillDue(await this.state.load(chatId)))
              throw new ReplySuperseded();
            await opts.beforeDispatch?.();
            checkCancelled(signal);
          },
          confirm: async (text, id, ts) => {
            if (!recorded) {
              if (judgment.callback_memory_id)
                markMemoryRecalled(latest, judgment.callback_memory_id, today);
              (latest.initiative ??= {}).last_sent_at = ts;
              opts.record(latest, ts);
              latest.judge_review = {
                approved: review.approved,
                issues: review.issues,
                source: opts.author,
              };
            }
            appendAssistantMessage(latest, text, opts.author, ts);
            await this.state.confirmPart(
              chatId,
              latest,
              text,
              opts.author,
              id,
              ts,
            );
            recorded = true;
          },
        },
      );
      await this.funnel.emit(chatId, 'message_out', timestamp, {
        chars: reply.length,
        bubbles: parts.length,
        initiative: true,
        kind: opts.author,
      });
      return true;
    });
  }

  async runRituals(): Promise<number> {
    const settings = await this.settings.get();
    if (
      !settings.initiative_enabled ||
      this.gate.stopped ||
      !this.persona.ready
    )
      return 0;
    const since = this.clock.ts() - ACTIVE_CHAT_DAYS * 86400;
    let sent = 0;
    for (const chatId of await this.state.activeChatIds(since)) {
      try {
        const done = await this.locks.run(chatId, () =>
          this.ritual(chatId, settings),
        );
        if (done) sent += 1;
      } catch (e) {
        this.log.error(
          `ritual failed chat=${chatId} (${e?.name ?? e}: ${e?.message ?? ''})`,
        );
      }
    }
    return sent;
  }

  private async ritual(
    chatId: number,
    settings: Awaited<ReturnType<SettingsService['get']>>,
  ): Promise<boolean> {
    const accountId = await this.history.chatOwnerAccount(chatId);
    if (accountId === null) return false;
    if (
      (await this.automationBlock(chatId, accountId)) ||
      !(await this.canReach(chatId, accountId))
    )
      return false;
    const persona = await this.persona.forAccount(accountId, chatId);
    const rhythm = persona.rhythm;
    const now = this.clock.now();
    const nowTs = this.clock.ts();

    for (const kind of ['morning', 'goodnight'] as RitualKind[]) {
      const slot = ritualSlot(now, rhythm[kind], rhythm.timezone, chatId, kind);
      if (!slot.due || slot.windowStartTs === null) continue;
      const state = await this.state.load(chatId);
      if (
        conversational(persona.config) &&
        (hasUnansweredInbound(state.history) || openQuestions(state).length > 0)
      )
        return false;
      if (state.rhythm?.[kind]?.[slot.day]) continue;
      const alreadySaid =
        kind === 'goodnight'
          ? saidGoodnightRecently(state.history ?? [], nowTs)
          : saidMorningRecently(state.history ?? [], nowTs);
      if (alreadySaid) {
        await this.markRitual(chatId, state, kind, slot.day, 'sent');
        continue;
      }
      if (unansweredUnprompted(state) >= rhythm.max_unanswered) continue;

      if ((await this.pause.status(chatId)).status === 'paused') return false;
      if ((await this.history.getLeadFacts(chatId))[REFUSAL_LOCK_KEY])
        return false;
      if (await this.schedule.get(chatId)) return false;

      const marks = await this.history.rhythmMarks(chatId, nowTs + 1);
      const lastUserTs = marks.prevUserTs;
      if (lastUserTs === null) continue;
      if (nowTs - lastUserTs > rhythm.skip_if_silent_days * 86400) continue;
      const lastAnyTs = Math.max(lastUserTs, marks.lastAssistantTs ?? 0);

      if (kind === 'morning') {
        if (lastUserTs >= slot.windowStartTs) {
          await this.markRitual(chatId, state, kind, slot.day, 'user');
          continue;
        }
        if (nowTs - lastAnyTs < MORNING_QUIET_BEFORE_SECONDS) continue;
      } else {
        if (!goodnightReason(state.history, nowTs)) continue;
        const dayStartTs =
          slot.windowStartTs - windowStartMinutes(rhythm.goodnight.from) * 60;
        if (lastUserTs < dayStartTs) continue;
        if (nowTs - lastAnyTs < GOODNIGHT_QUIET_BEFORE_SECONDS) continue;
      }

      const judgment: Partial<Judgment> = {
        goal: 'share',
        callback_memory_id: '',
        storyline_id: '',
        question_allowed: false,
        guidance:
          persona.prompts[kind] +
          (kind === 'goodnight'
            ? '\nОкно не обязывает прощаться. Повод — только недавний разговор; не придумывай намерение самой идти спать.'
            : ''),
      };
      const day = slot.day;
      return this.sendUnprompted(
        chatId,
        accountId,
        persona,
        settings,
        judgment,
        {
          author: kind,
          stillDue: (latest) =>
            !latest.rhythm?.[kind]?.[day] &&
            unansweredUnprompted(latest) < rhythm.max_unanswered &&
            ritualSlot(
              this.clock.now(),
              rhythm[kind],
              rhythm.timezone,
              chatId,
              kind,
            ).due &&
            (kind !== 'goodnight' ||
              Boolean(goodnightReason(latest.history, this.clock.ts()))),
          record: (latest, ts) => {
            const r = (latest.rhythm ??= {});
            (r[kind] ??= {})[day] = 'sent';
            if (kind === 'goodnight') r.last_goodnight_ts = ts;
            pruneRhythm(r, day);
          },
        },
      );
    }
    return false;
  }

  private async markRitual(
    chatId: number,
    state: ConversationState,
    kind: RitualKind,
    day: string,
    who: 'sent' | 'user',
  ) {
    const r = (state.rhythm ??= {});
    (r[kind] ??= {})[day] = who;
    pruneRhythm(r, day);
    await this.state.save(chatId, state);
  }
}

const RHYTHM_RETENTION_DAYS = 14;

function pruneRhythm(rhythm: RhythmState, today: string): void {
  const keepFrom = shiftDate(today, -RHYTHM_RETENTION_DAYS);
  const keep = <T extends string>(
    entries: Record<string, T>,
  ): Record<string, T> =>
    Object.fromEntries(
      Object.entries(entries).filter(([day]) => day >= keepFrom),
    );
  if (rhythm.morning) rhythm.morning = keep(rhythm.morning);
  if (rhythm.goodnight) rhythm.goodnight = keep(rhythm.goodnight);
}

function windowStartMinutes(from: string): number {
  const [h, m] = from.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
