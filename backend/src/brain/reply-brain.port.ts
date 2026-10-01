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
  path?: string;
  emoji?: string;
  duration?: number;
  name?: string;
  transcript?: string | null;
}

export interface InboundTurn {
  chatId: number;
  accountId: number;
  messageId: number;
  text: string;
  ts: number;
  media?: InboundMedia | null;
  replay?: boolean;
}

export interface ReplyBrain {
  observeIncoming?(
    chatId: number,
    accountId: number,
    messageId: number,
  ): () => void;
  handleInbound(turn: InboundTurn): Promise<void>;
  noteOperatorQueued?(chatId: number): Promise<void>;
  noteAutomatedVoiceMessage?(
    chatId: number,
    text: string,
    ts: number,
    replyId: string,
  ): Promise<void>;
  noteOperatorMessage(chatId: number): Promise<void>;
  nextAction(
    chatId: number,
    maxAgeSeconds?: number,
  ): Promise<import('./nastya/dialogue/forecast').NextBotAction>;
  answerAfterResume(chatId: number): Promise<boolean>;
  answerAfterCall?(callId: string): Promise<boolean>;
  runInitiative(): Promise<number>;
  runDueReplies(): Promise<number>;
  runRituals(): Promise<number>;
  handleDeleted(accountId: number, messageIds: number[]): Promise<void>;
  noteOperatorFacts(
    chatId: number,
    facts: Record<string, unknown>,
  ): Promise<void>;
  setSlot(
    chatId: number,
    slotId: string,
    value: string | null,
  ): Promise<{ slot_id: string; value: string | null }>;
  editOwnMessage(
    chatId: number,
    messageId: number,
    text: string,
  ): Promise<{ id: number; text: string; edited_at: number }>;
  noteEdited(
    chatId: number,
    role: 'user' | 'assistant',
    oldText: string,
    newText: string,
    messageId?: number,
  ): Promise<void>;
  openLead(chatId: number, accountId: number, lead: LeadIntro): Promise<string>;
  cacheSizes?(): Record<string, number>;
}

export interface LeadIntro {
  firstName?: string | null;
  city?: string | null;
  age?: number | null;
  site?: string | null;
}

export interface OutboundTransport {
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
  markRead(chatId: number, accountId?: number | null): Promise<void>;
  markListened(
    chatId: number,
    messageIds: number[],
    accountId?: number | null,
  ): Promise<void>;
  isOnline?(accountId: number): boolean;
  editText?(chatId: number, tgMsgId: number, text: string): Promise<void>;
}

export const OUTBOUND_TRANSPORT = Symbol('OUTBOUND_TRANSPORT');
