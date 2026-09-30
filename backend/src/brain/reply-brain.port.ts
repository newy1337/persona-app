/**
 * The seam between channels and the persona's mind.
 *
 * A channel (Telegram accounts today) turns an incoming message into
 * `InboundTurn` and hands it here; the brain decides whether and what to
 * answer and delivers through `OutboundTransport`. Swapping the mind — a
 * different persona engine, a different LLM stack — means implementing this
 * one interface.
 */
import type { TypingStyle } from 'src/domain/typing';

export const REPLY_BRAIN = Symbol('REPLY_BRAIN');

export interface InboundMedia {
  kind:
    | 'photo'
    | 'voice'
    | 'video'
    | 'video_note'
    | 'sticker'
    | 'animation'
    | 'document';
  /** Local path of the downloaded file, when it was downloaded. */
  path?: string;
  /** Sticker/emoji text, when any. */
  emoji?: string;
  duration?: number;
  /** Имя файла, как его назвал отправитель: панель показывает его ссылкой. */
  name?: string;
  /** Расшифровка речи (голосовое, кружок): '' — слов нет; null — не удалось; нет поля — не расшифровывали. */
  transcript?: string | null;
}

export interface InboundTurn {
  chatId: number;
  accountId: number;
  messageId: number;
  text: string;
  ts: number;
  media?: InboundMedia | null;
  /**
   * The message is already stored but never answered (the reply failed and
   * the process restarted): skip the duplicate check and reply anyway.
   */
  replay?: boolean;
}

export interface ReplyBrain {
  /** Early receipt before media download/lock; release after inbound processing. */
  observeIncoming?(
    chatId: number,
    accountId: number,
    messageId: number,
  ): () => void;
  /** Handles one incoming message end to end: store, decide, reply, store. */
  handleInbound(turn: InboundTurn): Promise<void>;
  /** A manager queued a manual reply; cancel an in-flight bot draft immediately. */
  noteOperatorQueued?(chatId: number): Promise<void>;
  /** A person spoke as the persona; the mind must remember it as its own line. */
  noteAutomatedVoiceMessage?(
    chatId: number,
    text: string,
    ts: number,
    replyId: string,
  ): Promise<void>;
  noteOperatorMessage(chatId: number): Promise<void>;
  /** Что бот сделает в чате дальше, если собеседник ничего не напишет (для панели). */
  nextAction(
    chatId: number,
    maxAgeSeconds?: number,
  ): Promise<import('./nastya/dialogue/forecast').NextBotAction>;
  /** Чат вернули боту: ответить на то, что собеседник написал и оставил без ответа. */
  answerAfterResume(chatId: number): Promise<boolean>;
  /** Optional, at-most-once warm follow-up after a confirmed completed call. */
  answerAfterCall?(callId: string): Promise<boolean>;
  /** Scheduled initiative messages for chats where one is due. */
  runInitiative(): Promise<number>;
  /** Отложенные по ритму ответы, у которых наступил срок. */
  runDueReplies(): Promise<number>;
  /** Утренние сообщения и прощания по окнам ритма. */
  runRituals(): Promise<number>;
  /** Собеседник удалил сообщения: бот их не читает и на них не отвечает. */
  handleDeleted(accountId: number, messageIds: number[]): Promise<void>;
  /** Менеджер поправил карточку лида — бот узнаёт это как факт о собеседнике. */
  noteOperatorFacts(
    chatId: number,
    facts: Record<string, unknown>,
  ): Promise<void>;
  /** Менеджер отметил тему знакомства вручную; `null` — снять отметку. Возвращает slot id. */
  setSlot(
    chatId: number,
    slotId: string,
    value: string | null,
  ): Promise<{ slot_id: string; value: string | null }>;
  /** Менеджер исправил наше сообщение из панели: в Telegram, в ленте и в памяти бота. */
  editOwnMessage(
    chatId: number,
    messageId: number,
    text: string,
  ): Promise<{ id: number; text: string; edited_at: number }>;
  /** Сообщение изменили в самом Telegram (собеседник своё или мы с телефона). */
  noteEdited(
    chatId: number,
    role: 'user' | 'assistant',
    oldText: string,
    newText: string,
    messageId?: number,
  ): Promise<void>;
  /** Cold opener to a lead the persona has never spoken to; returns the text sent. */
  openLead(chatId: number, accountId: number, lead: LeadIntro): Promise<string>;
  /** Размеры того, что мозг держит в памяти между ходами — для сторожа памяти. */
  cacheSizes?(): Record<string, number>;
}

/** What the pool knows about a lead before the first message. */
export interface LeadIntro {
  firstName?: string | null;
  city?: string | null;
  age?: number | null;
  /** Сайт знакомств, где лайкнули друг друга: `{site}` этого диалога. */
  site?: string | null;
}

export interface OutboundTransport {
  /** `typing` — как «печатать» перед частями; не задано — по умолчанию, `enabled: false` — сразу. */
  /**
   * `onPart` — сразу после отправки каждой части (индекс и id в Telegram): часть попадает
   * в историю тогда, когда её увидел собеседник, а не пачкой после последней.
   */
  sendText(
    chatId: number,
    parts: string[],
    opts?: {
      accountId?: number | null;
      typing?: TypingStyle;
      signal?: AbortSignal;
      beforePart?: () => Promise<void>;
      randomIds?: string[];
      onDispatch?: (index: number) => Promise<void>;
      onPart?: (index: number, tgMsgId: number) => Promise<void>;
    },
  ): Promise<number[]>;
  sendReaction(chatId: number, messageId: number, emoji: string): Promise<void>;
  /** «Прочитано»: она открыла чат. */
  markRead(chatId: number, accountId?: number | null): Promise<void>;
  /** Голосовые и кружки — «прослушано» (у собеседника гаснет точка). */
  markListened(
    chatId: number,
    messageIds: number[],
    accountId?: number | null,
  ): Promise<void>;
  /** Аккаунт в сети: иначе ответ через него не уйдёт — и генерировать его незачем. */
  isOnline?(accountId: number): boolean;
  /** Исправить уже отправленный текст. */
  editText?(chatId: number, tgMsgId: number, text: string): Promise<void>;
}

export const OUTBOUND_TRANSPORT = Symbol('OUTBOUND_TRANSPORT');
