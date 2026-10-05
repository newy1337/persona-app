import {
  Inject,
  Injectable,
  UnprocessableEntityException,
  forwardRef,
  NotFoundException,
} from '@nestjs/common';
import { REPLY_BRAIN, ReplyBrain } from 'src/brain/reply-brain.port';
import { fillVariables } from 'src/brain/nastya/config/variables';
import { PresenceService } from 'src/shared/presence.service';
import { PrismaService } from 'src/prisma.service';
import { HistoryService, StoredMessage } from 'src/shared/history.service';
import { PauseService } from 'src/shared/pause.service';
import { ClockService } from 'src/shared/clock.service';
import { FunnelEventsService } from 'src/shared/funnel-events.service';
import { TelegramService } from '../telegram/telegram.service';
import {
  DEFAULT_FUNNEL_STAGE,
  isFunnelStage,
  VALID_FUNNEL_STAGES,
} from 'src/domain/funnel';
import {
  coerceLeadFactValue,
  EDITABLE_LEAD_FACT_KEYS,
  HIDDEN_FROM_DASHBOARD_KEY,
  ARCHIVED_AT_KEY,
  ARCHIVED_BOT_ON_KEY,
  HANDOFF_TRIGGER_KEY,
  LeadFacts,
  publicLeadFacts,
  REFUSAL_LOCK_KEY,
} from 'src/domain/lead-facts';
import { TakeoverReason, pauseReasonHead } from 'src/domain/pause';
import { toChatId } from 'src/utils/ids';
import { PersonaService } from 'src/brain/persona.service';
import { BrainStateService } from 'src/brain/brain-state.service';
import { ReplyScheduleService } from 'src/brain/reply-schedule.service';
import { goalProgress } from 'src/brain/nastya/character/progress';
import {
  isReactionEmoji,
  kindForFile,
  plainEmoji,
} from 'src/domain/attachments';
import { UploadsService } from '../media/uploads.service';
import { SettingsService } from '../settings/settings.service';
import { accountLostOf } from 'src/domain/tg-status';
import { ManagerAttributionService } from 'src/shared/manager-attribution.service';

const DETAIL_LIMIT = 500;
const LIST_LIMIT = 200;
const EXPORT_MESSAGE_LIMIT = 5000;
const GALLERY_LIMIT = 1000;
const OPERATOR_ACTOR = 'operator:web';
const MANUAL_PAUSE_ACTOR = 'manager:manual_message';

const utc = (ts: number) =>
  new Date(ts * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, 'Z');

export function telegramRead(
  m: {
    role: string;
    tg_msg_id: number | null;
    source_message_id: number | null;
  },
  read: { outbox: number | null; inbox: number | null },
): boolean | null {
  const tgId = m.tg_msg_id ?? (m.role === 'user' ? m.source_message_id : null);
  if (!tgId) return null;
  const mark = m.role === 'user' ? read.inbox : read.outbox;
  return mark !== null && tgId <= mark;
}

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    private history: HistoryService,
    private pause: PauseService,
    private clock: ClockService,
    private funnel: FunnelEventsService,
    private telegram: TelegramService,
    private settings: SettingsService,
    private persona: PersonaService,
    private brainState: BrainStateService,
    private replySchedule: ReplyScheduleService,
    private uploads: UploadsService,
    private presence: PresenceService,
    @Inject(forwardRef(() => REPLY_BRAIN)) private brain: ReplyBrain,
    private attribution: ManagerAttributionService,
  ) {}

  private leadScore(facts: LeadFacts): number | null {
    const v = facts['lead_score'];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  async revision(chatId: number) {
    const [marks, pause, scheduled, media, tail] = await Promise.all([
      this.history.telegramReadMarks(chatId),
      this.history.getPause(chatId),
      this.replySchedule.get(chatId),
      this.prisma.inboundMedia.count({ where: { chatId: toChatId(chatId) } }),
      this.prisma.message.aggregate({
        where: { chatId: toChatId(chatId) },
        _max: { id: true, ts: true, editedAt: true, deletedAt: true },
        _count: { _all: true, reaction: true },
      }),
    ]);
    return {
      revision: [
        tail._max.id ?? 0,
        tail._count._all,
        tail._count.reaction,
        tail._max.editedAt ?? 0,
        tail._max.deletedAt ?? 0,
        media,
        marks.outbox ?? 0,
        marks.inbox ?? 0,
        pause.status === 'paused' ? 1 : 0,
        scheduled?.dueAt ?? 0,
      ].join('.'),
      last_message_ts: tail._max.ts ?? 0,
      is_paused: pause.status === 'paused',
    };
  }

  async detail(chatId: number) {
    const [
      messages,
      pauseState,
      facts,
      events,
      owner,
      profile,
      persona,
      state,
    ] = await Promise.all([
      this.history.window(chatId, DETAIL_LIMIT),
      this.history.getPause(chatId),
      this.history.getLeadFacts(chatId),
      this.funnel.forChat(chatId),
      this.history.chatOwnerAccount(chatId),
      this.prisma.phoneNumber.findFirst({
        where: { telegramUserId: toChatId(chatId) },
      }),
      this.persona.forChat(chatId),
      this.brainState.load(chatId),
    ]);
    const scheduled = await this.replySchedule.get(chatId);
    const read = await this.history.telegramReadMarks(chatId);
    const nowTs = this.clock.ts();
    const [clientState, account, managers, contact] = await Promise.all([
      this.history.clientTelegramState(chatId, nowTs),
      owner === null
        ? null
        : this.prisma.tgAccount.findUnique({
            where: { id: owner },
            select: {
              id: true,
              username: true,
              displayName: true,
              phoneE164: true,
              personaId: true,
              status: true,
              bannedAt: true,
              banReason: true,
            },
          }),
      this.attribution.directory(),
      this.prisma.contact.findUnique({
        where: { chatId: toChatId(chatId) },
        select: { note: true, noteBy: true, noteAt: true },
      }),
    ]);
    const lost = account
      ? accountLostOf(account.status, account.bannedAt)
      : null;
    return {
      ...this.detailPayload(
        persona.slug,
        chatId,
        messages,
        pauseState.status === 'paused',
        facts,
        events,
        owner,
        profile,
        read,
      ),
      ...managers.forAccount(owner),
      persona_name: persona.name,
      // с какого Telegram-аккаунта личность пишет этому клиенту
      account: account
        ? {
            id: account.id,
            username: account.username ?? null,
            display_name: account.displayName ?? null,
            phone: account.phoneE164,
            persona_id: account.personaId,
          }
        : null,
      goals: fillVariables(
        goalProgress(persona.config.goals, state.character),
        persona.variables,
      ),
      next_bot_action: await this.brain.nextAction(chatId).catch(() => null),
      ...clientState,
      account_lost: lost
        ? {
            kind: lost,
            reason: account?.banReason ?? null,
            since: account?.bannedAt ?? null,
            username: account?.username ?? null,
          }
        : null,
      scheduled_reply: scheduled
        ? {
            due_at: scheduled.dueAt,
            reason: scheduled.reason,
            messages: scheduled.turns.length,
          }
        : null,
      note: contact?.note ?? null,
      note_by: contact?.noteBy ?? null,
      note_at: contact?.noteAt ?? null,
    };
  }

  private detailPayload(
    personaSlug: string,
    chatId: number,
    messages: StoredMessage[],
    isPaused: boolean,
    facts: LeadFacts,
    funnelEvents: unknown[],
    owner: number | null = null,
    profile: {
      phoneE164: string | null;
      city: string | null;
      usernameKey?: string | null;
      telegramUsername?: string | null;
    } | null = null,
    read: { outbox: number | null; inbox: number | null } = {
      outbox: null,
      inbox: null,
    },
  ) {
    return {
      chat_id: chatId,
      persona_id: personaSlug,
      owner_account_id: owner,
      funnel_stage: (facts['funnel_stage'] as string) || DEFAULT_FUNNEL_STAGE,
      first_seen: messages.length ? messages[0].ts : 0,
      last_seen: messages.length ? messages[messages.length - 1].ts : 0,
      pinned_facts: publicLeadFacts(facts),
      summary_text: (facts['summary_text'] as string) ?? null,
      lead_score: this.leadScore(facts),
      client_phone: profile?.phoneE164 ?? (facts['phone'] as string) ?? null,
      client_username:
        (facts['tg_username'] as string) ||
        profile?.telegramUsername ||
        profile?.usernameKey ||
        null,
      client_avatar: this.presence.avatarUrl(chatId),
      client_typing: this.presence.activityOf(chatId),
      client_city: profile?.city ?? null,
      is_paused: isPaused,
      archived: Boolean(facts[HIDDEN_FROM_DASHBOARD_KEY]),
      messages: messages.map((m) => ({
        id: m.id,
        tg_msg_id: m.tg_msg_id,
        media_kind: m.media_kind,
        media_url:
          m.file_path && !/^https?:\/\//i.test(m.file_path)
            ? `/api/files/${m.id}`
            : m.file_path,
        reply_to: m.reply_to,
        reaction: m.reaction,
        deleted_at: m.deleted_at,
        edited_at: m.edited_at,
        role: m.role,
        content: m.text,
        ts: m.ts,
        read_status: 0,
        tg_read: telegramRead(m, read),
        author: m.author || null,
      })),
      funnel_events: funnelEvents,
    };
  }

  editMessage(chatId: number, messageId: number, text: string) {
    return this.brain.editOwnMessage(chatId, messageId, text);
  }

  /**
   * Менеджер открыл переписку. Отметку о прочтении ставим только когда чат на
   * ручном режиме: тогда отвечает человек, и галочки — его. Пока ведёт бот,
   * читает он сам в свой черёд, и присутствие менеджера на странице
   * собеседнику показывать незачем.
   */
  async markSeen(chatId: number): Promise<void> {
    const manual = (await this.pause.status(chatId)).status === 'paused';
    if (manual && (await this.hasUnreadFromClient(chatId)))
      await this.telegram.markRead(chatId).catch(() => undefined);
    await this.history.markManagerSeen(chatId, this.clock.ts());
  }

  /**
   * Сравниваем не со временем просмотра, а с тем, что уже отмечено
   * прочитанным в самом Telegram. Времена хранятся в секундах, а страница
   * перечитывается на каждое изменение переписки: при включённом боте
   * обновления идут часто, и сообщение, пришедшее в ту же секунду, попадало
   * «не новее» просмотра — галочки не появлялись до ответа бота.
   */
  private async hasUnreadFromClient(chatId: number): Promise<boolean> {
    const [marks, latest] = await Promise.all([
      this.history.telegramReadMarks(chatId),
      this.history.latestClientTgId(chatId),
    ]);
    return latest > 0 && latest > (marks.inbox ?? 0);
  }

  async list() {
    const rows = await this.prisma.$queryRaw<
      {
        chat_id: bigint;
        account_id: number | null;
        pause_state: string;
        last_ts: number | null;
        last_text: string | null;
        last_role: string | null;
        facts: string | null;
      }[]
    >`
      SELECT c.chat_id, c.account_id, c.pause_state,
             (SELECT MAX(ts) FROM messages m WHERE m.chat_id = c.chat_id) AS last_ts,
             (SELECT text FROM messages m WHERE m.chat_id = c.chat_id ORDER BY id DESC LIMIT 1) AS last_text,
             (SELECT role FROM messages m WHERE m.chat_id = c.chat_id ORDER BY id DESC LIMIT 1) AS last_role,
             p.facts AS facts
      FROM contacts c LEFT JOIN pinned_facts p ON p.chat_id = c.chat_id
      ORDER BY last_ts DESC NULLS LAST LIMIT ${LIST_LIMIT}`;
    const accounts = await this.prisma.tgAccount.findMany({
      select: { id: true, personaId: true },
    });
    const personaByAccount = new Map(accounts.map((a) => [a.id, a.personaId]));
    const defaultSlug =
      (await this.persona.default().catch(() => null))?.slug ?? '';
    const managers = await this.attribution.directory();
    return {
      items: rows.map((r) => {
        const facts = r.facts ? (JSON.parse(r.facts) as LeadFacts) : {};
        return {
          chat_id: Number(r.chat_id),
          persona_id: personaByAccount.get(r.account_id ?? -1) ?? defaultSlug,
          owner_account_id: r.account_id,
          ...managers.forAccount(r.account_id),
          funnel_stage:
            (facts['funnel_stage'] as string) || DEFAULT_FUNNEL_STAGE,
          last_message_ts: Number(r.last_ts ?? 0),
          last_message_preview: (r.last_text ?? '').slice(0, 160),
          last_message_role: r.last_role,
          is_paused: r.pause_state === 'paused',
          lead_score: this.leadScore(facts),
          pinned_facts_count: Object.keys(publicLeadFacts(facts)).length,
          new_messages_since_seen: 0,
        };
      }),
    };
  }

  async manualMessage(chatId: number, text: string, replyTo?: number) {
    const ts = this.clock.ts();
    const replyId = await this.history.enqueueManualReply(chatId, text, ts, {
      replyTo,
    });
    await this.pauseForManager(chatId);
    return {
      action: 'conversation.manual_message',
      payload: { ok: true, pending_reply_id: replyId, scheduled_ts: ts },
    };
  }

  async sendAttachment(
    chatId: number,
    dto: { kind: string; source: string; caption?: string; reply_to?: number },
  ) {
    const ts = this.clock.ts();
    const remote = /^https?:\/\//i.test(dto.source);
    const source =
      remote || dto.kind === 'sticker'
        ? dto.source
        : this.uploads.resolveSafe(dto.source);
    const replyId = await this.history.enqueueManualReply(
      chatId,
      dto.caption ?? '',
      ts,
      {
        kind: dto.kind,
        filePath: source,
        replyTo: dto.reply_to,
      },
    );
    await this.pauseForManager(chatId);
    return {
      ok: true,
      pending_reply_id: replyId,
      kind: dto.kind,
      scheduled_ts: ts,
    };
  }

  async mediaGallery(chatId: number) {
    const rows = await this.prisma.message.findMany({
      where: {
        chatId: toChatId(chatId),
        filePath: { not: null },
        mediaKind: { in: ['photo', 'video', 'video_note', 'animation'] },
        deletedAt: null,
      },
      orderBy: [{ ts: 'desc' }, { id: 'desc' }],
      take: GALLERY_LIMIT,
      select: {
        id: true,
        ts: true,
        role: true,
        mediaKind: true,
        filePath: true,
        text: true,
      },
    });
    return {
      items: rows.map((m) => ({
        id: m.id,
        ts: m.ts,
        role: m.role,
        kind: m.mediaKind,
        url: /^https?:\/\//i.test(m.filePath!)
          ? m.filePath
          : `/api/files/${m.id}`,
        caption: m.text && !m.text.startsWith('[') ? m.text : null,
      })),
    };
  }

  async sendAlbum(
    chatId: number,
    dto: { sources: string[]; caption?: string; reply_to?: number },
  ) {
    const paths = dto.sources.map((s) => this.uploads.resolveSafe(s));
    for (const path of paths) {
      const kind = kindForFile(path);
      if (kind !== 'photo' && kind !== 'video') {
        throw new UnprocessableEntityException(
          `в альбом идут только фото и видео — «${path.split(/[\\/]/).pop()}» отправьте отдельно`,
        );
      }
    }
    const ts = this.clock.ts();
    const replyId = await this.history.enqueueManualReply(
      chatId,
      dto.caption ?? '',
      ts,
      {
        kind: 'album',
        filePath: JSON.stringify(paths),
        replyTo: dto.reply_to,
      },
    );
    await this.pauseForManager(chatId);
    return {
      ok: true,
      pending_reply_id: replyId,
      kind: 'album',
      files: paths.length,
      scheduled_ts: ts,
    };
  }

  async markListened(chatId: number, messageId: number) {
    const row = await this.history.messageById(chatId, messageId);
    if (!row || row.role !== 'user' || !row.sourceMessageId) {
      throw new NotFoundException('Сообщение собеседника не найдено');
    }
    if (!['voice', 'video_note'].includes(row.mediaKind ?? '')) {
      throw new UnprocessableEntityException(
        'Отмечать прослушанным можно только голосовое или кружок',
      );
    }
    await this.telegram.markListened(chatId, [row.sourceMessageId]);
    return { ok: true, message_id: messageId };
  }

  async reaction(chatId: number, messageId: number, emoji: string) {
    const clean = plainEmoji(emoji.trim());
    if (clean && !isReactionEmoji(clean)) {
      throw new UnprocessableEntityException(
        `Telegram не примет реакцию «${emoji}»`,
      );
    }
    const ts = this.clock.ts();
    const replyId = await this.history.enqueueManualReply(chatId, clean, ts, {
      kind: 'reaction',
      replyTo: messageId,
    });
    return {
      ok: true,
      pending_reply_id: replyId,
      emoji: clean,
      scheduled_ts: ts,
    };
  }

  private async pauseForManager(chatId: number) {
    await this.brain.noteOperatorQueued?.(chatId);
    if (!(await this.settings.get()).pause_on_manual_message) return;
    try {
      await this.pause.pause(
        chatId,
        TakeoverReason.MANUAL_TAKEOVER,
        MANUAL_PAUSE_ACTOR,
      );
    } catch {
      // The reply is already queued; a failed pause must not fail the route.
    }
  }

  pauseChat(chatId: number) {
    return this.pause.pause(chatId, TakeoverReason.HOLD, OPERATOR_ACTOR);
  }

  answerNow(chatId: number): Promise<boolean> {
    return this.brain.answerAfterResume(chatId);
  }

  async resumeChat(chatId: number) {
    await this.assertTriggerAnswered(chatId);
    await this.pause.resume(chatId, OPERATOR_ACTOR);
    await this.brain.answerAfterResume(chatId).catch(() => false);
  }

  /**
   * После стоп-фразы бота нельзя включить, пока менеджер сам не ответил лиду:
   * иначе бот при возобновлении снова прочтёт ту же фразу и снова замолчит.
   */
  private async assertTriggerAnswered(chatId: number): Promise<void> {
    const facts = await this.history.getLeadFacts(chatId);
    const trigger = facts[HANDOFF_TRIGGER_KEY] as { ts?: number } | undefined;
    if (!trigger) return;
    const answered = await this.prisma.message.findFirst({
      where: {
        chatId: toChatId(chatId),
        role: 'assistant',
        author: { startsWith: 'operator' },
        deletedAt: null,
        ts: { gte: Number(trigger.ts ?? 0) },
      },
      select: { id: true },
    });
    if (answered) return;
    throw new UnprocessableEntityException(
      'Сработал триггер: режим Авто приостановлен, пока вы не ответите лиду',
    );
  }

  async setHidden(chatId: number, hidden: boolean) {
    if (hidden) {
      const botWasOn = (await this.pause.status(chatId)).status !== 'paused';
      await this.history.mergeLeadFacts(
        chatId,
        {
          [HIDDEN_FROM_DASHBOARD_KEY]: true,
          [ARCHIVED_AT_KEY]: this.clock.ts(),
          [ARCHIVED_BOT_ON_KEY]: botWasOn,
        },
        false,
      );
      if (botWasOn)
        await this.pause.pause(chatId, TakeoverReason.ARCHIVED, OPERATOR_ACTOR);
      await this.replySchedule.drop(chatId);
    } else {
      const facts = await this.history.getLeadFacts(chatId);
      await this.history.mergeLeadFacts(
        chatId,
        {
          [HIDDEN_FROM_DASHBOARD_KEY]: null,
          [ARCHIVED_AT_KEY]: null,
          [ARCHIVED_BOT_ON_KEY]: null,
        },
        false,
      );
      const pause = await this.history.getPause(chatId);
      if (
        facts[ARCHIVED_BOT_ON_KEY] &&
        pause.status === 'paused' &&
        pauseReasonHead(pause.reason) === TakeoverReason.ARCHIVED
      ) {
        await this.resumeChat(chatId);
      }
    }
    return { ok: true, chat_id: chatId, hidden };
  }

  async setNote(chatId: number, text: string, author: string) {
    const note = text.trim();
    await this.history.ensureContact(chatId);
    const at = this.clock.ts();
    await this.prisma.contact.update({
      where: { chatId: toChatId(chatId) },
      data: note
        ? { note, noteBy: author, noteAt: at }
        : { note: null, noteBy: null, noteAt: null },
    });
    return {
      note: note || null,
      note_by: note ? author : null,
      note_at: note ? at : null,
    };
  }

  async setStage(chatId: number, stage: string) {
    if (!isFunnelStage(stage)) {
      throw new UnprocessableEntityException(
        `invalid funnel_stage: '${stage}' (valid: ${[...VALID_FUNNEL_STAGES].sort().join(', ')})`,
      );
    }
    const before =
      (await this.history.getLeadFacts(chatId))['funnel_stage'] ??
      DEFAULT_FUNNEL_STAGE;
    await this.history.mergeLeadFacts(chatId, { funnel_stage: stage }, false);
    await this.funnel.emit(chatId, 'stage_transition', this.clock.ts(), {
      from: before,
      to: stage,
      actor: OPERATOR_ACTOR,
    });
    return { ok: true, chat_id: chatId };
  }

  async pinFact(chatId: number, key: string, value: string) {
    if (!EDITABLE_LEAD_FACT_KEYS.has(key)) {
      throw new UnprocessableEntityException(
        `invalid pin-fact key: '${key}' (valid: ${[...EDITABLE_LEAD_FACT_KEYS].sort().join(', ')})`,
      );
    }
    let coerced: unknown;
    try {
      coerced = value.trim() === '' ? null : coerceLeadFactValue(key, value);
    } catch (e) {
      throw new UnprocessableEntityException(String(e.message ?? e));
    }
    await this.history.mergeLeadFacts(chatId, { [key]: coerced }, false);
    await this.brain.noteOperatorFacts(chatId, { [key]: coerced });
    return { ok: true, chat_id: chatId };
  }

  async setSlot(chatId: number, slotId: string, value: string | null) {
    try {
      const r = await this.brain.setSlot(
        chatId,
        slotId,
        value?.trim() ? value : null,
      );
      return { ok: true, chat_id: chatId, ...r };
    } catch (e) {
      throw new UnprocessableEntityException(String(e?.message ?? e));
    }
  }

  async clearRefusalLock(chatId: number) {
    await this.history.mergeLeadFacts(
      chatId,
      { [REFUSAL_LOCK_KEY]: null },
      false,
    );
    return { ok: true, chat_id: chatId };
  }

  async exportChats(chatIds: number[], format: 'json' | 'txt') {
    const parts: (string | object)[] = [];
    for (const chatId of chatIds) {
      const messages = await this.history.window(chatId, EXPORT_MESSAGE_LIMIT);
      const pauseState = await this.history.getPause(chatId);
      const facts = await this.history.getLeadFacts(chatId);
      const events = await this.funnel.forChat(chatId);
      if (format === 'json') {
        parts.push(
          this.detailPayload(
            (await this.persona.forChat(chatId)).slug,
            chatId,
            messages,
            pauseState.status === 'paused',
            facts,
            events,
          ),
        );
      } else {
        const stage = (facts['funnel_stage'] as string) || DEFAULT_FUNNEL_STAGE;
        const first = messages.length ? messages[0].ts : 0;
        const last = messages.length ? messages[messages.length - 1].ts : 0;
        const header = [
          `Chat #${chatId} (${(await this.persona.forChat(chatId)).slug})`,
          `Stage: ${stage}`,
          `First seen: ${utc(first)}`,
          `Last seen: ${utc(last)}`,
          '-'.repeat(40),
          '',
        ];
        const body = messages.map((m) => `[${utc(m.ts)}] ${m.role}: ${m.text}`);
        parts.push(header.concat(body).join('\n') + '\n');
      }
    }
    const stamp = new Date(this.clock.ts() * 1000)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z');
    const filename =
      chatIds.length === 1
        ? `${(await this.persona.forChat(chatIds[0])).slug}_${chatIds[0]}.${format}`
        : `conversations_${stamp}.${format}`;
    const content =
      format === 'json'
        ? JSON.stringify(parts, null, 2)
        : parts.join(`\n${'-'.repeat(40)}\n\n`);
    return {
      filename,
      content,
      mediaType:
        format === 'json' ? 'application/json' : 'text/plain; charset=utf-8',
    };
  }
}
