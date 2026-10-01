import type { TurnTime } from './turn-time';
import type { DayContinuity } from '../character/continuity';
export type Role = 'user' | 'assistant';

export type MemoryKind =
  'fact' | 'preference' | 'episode' | 'open_loop' | 'shared_joke';
export type MemoryStatus = 'active' | 'resolved';
export const MEMORY_KINDS: readonly MemoryKind[] = [
  'fact',
  'preference',
  'episode',
  'open_loop',
  'shared_joke',
];
export const MEMORY_STATUSES: readonly MemoryStatus[] = ['active', 'resolved'];

export type Goal = 'respond' | 'ask' | 'callback' | 'share' | 'deescalate';
export const GOALS: readonly Goal[] = [
  'respond',
  'ask',
  'callback',
  'share',
  'deescalate',
];

export type ResponseKind = 'short' | 'normal' | 'story';

export interface HistoryMessage {
  id: string;
  role: Role;
  content: string;
  created_at: number;
  source: string;
  attachment_context?: string;
  panel_message_id?: number;
  telegram_message_id?: number;
}

export interface MemoryRevision {
  text: string;
  replaced_on: string;
}

export interface Memory {
  scope?: 'communication';
  id: string;
  kind: MemoryKind;
  text: string;
  status: MemoryStatus;
  importance: number;
  created_on: string;
  updated_on: string;
  last_recalled_on: string;
  recall_count: number;
  source: string;
  evidence?: string;
  source_message_ids?: number[];
  slot_id?: string;
  due_on?: string;
  revisions?: MemoryRevision[];
}

export interface StorylineProgress {
  started_on: string;
  completed: boolean;
  beat?: number;
}

export interface CharacterState {
  open_questions?: Array<{ id: string; text: string }>;
  turns?: number;
  days?: string[];
  first_seen?: string;
  storyline_started?: string;
  stage_id?: string;
  stage_started_turn?: number;
  last_stage_change?: string;
  last_seen_date?: string;
  last_goal_turn?: number;
  slots?: Record<string, string>;
  cleared_slots?: string[];
  slot_asks?: Record<string, number>;
  deferred_slots?: string[];
  shared_stories?: Record<string, string>;
  tone?: Record<string, number>;
  storyline_progress?: Record<string, StorylineProgress>;
  storyline_cursor?: number;
  self_intro_shared?: boolean;
  settings_snapshot?: Record<string, string>;
  gap_note?: string;
  cool_turns_remaining?: number;
}

export interface InitiativeState {
  last_sent_at?: number;
  sent_by_date?: Record<string, number[]>;
}

export interface JudgeReview {
  approved: boolean;
  issues: string[];
  source?: string;
}

export interface ConversationState {
  conversation_id: string;
  agreements: string[];
  user_name: string;
  history: HistoryMessage[];
  character: CharacterState;
  judge: Partial<Judgment>;
  judge_review: Partial<JudgeReview>;
  memories: Memory[];
  initiative: InitiativeState;
  history_cursor?: number;
  history_reset?: { after_id: number; at: number };
  persona_events?: import('../memory/persona-events').PersonaEvent[];
  telegram_control_revision?: number;
  rhythm?: RhythmState;
}

export interface RhythmState {
  morning?: Record<string, 'sent' | 'user'>;
  goodnight?: Record<string, 'sent' | 'user' | 'skipped'>;
  last_goodnight_ts?: number;
}

export interface MemoryUpdate {
  scope?: 'communication';
  action: 'remember' | 'replace' | 'resolve';
  kind: MemoryKind;
  text: string;
  memory_id: string;
  importance: number;
  due_on: string;
  slot_id?: string;
}

export interface Judgment {
  voice_reply?: { send: boolean; emotion: string; reason: string };
  question_review?: {
    questions: Array<{ id: string; text: string }>;
    unanswered_ids: string[];
  };
  answer_question_ids?: string[];
  intent: string;
  sentiment: string;
  user_asked_question: boolean;
  question_allowed: boolean;
  slot_updates: Record<string, string>;
  memory_updates: MemoryUpdate[];
  agreements: string[];
  deferred_slots: string[];
  resumed_slots: string[];
  callback_memory_id: string;
  storyline_id: string;
  goal: Goal;
  target_slot: string;
  response_kind: ResponseKind;
  guidance: string;
  media_request?: MediaRequest;
  persona_event_updates?: import('../memory/persona-events').PersonaEventUpdate[];
}

export const MEDIA_REQUESTS = [
  'voice',
  'photo',
  'video_note',
  'video',
] as const;
export type MediaRequest = (typeof MEDIA_REQUESTS)[number] | '';

export interface Storyline {
  kind: string;
  id: string;
  current: string;
  previous: string;
  topics?: string[];
  last_shared_on?: string;
}

export interface Slot {
  id: string;
  topic?: string;
  followups?: string[];
  priority?: number;
  not_before_day?: number;
  required_by_day?: number;
  desired_by_day?: number;
  ask_policy?: string;
  topic_triggers?: string[];
  requires?: string | string[];
  [key: string]: unknown;
}

export interface Stage {
  id: string;
  manner?: Record<string, number>;
  min_turns?: number;
  ask_slots?: string[];
  enter?: { turns?: number; days?: number; slots?: number };
  [key: string]: unknown;
}

export interface GoalPlan {
  day_number: number;
  priority_slot: Slot | Record<string, never>;
  suggested_topics: string[];
  optional: boolean;
  desired_missing: string[];
  one_question_per_reply: boolean;
  react_before_asking: boolean;
}

export interface ReplyRhythm {
  kind: ResponseKind;
  guidance: string;
}

export interface RuntimeSnapshot {
  call_context?: Awaited<
    ReturnType<typeof import('src/shared/call-context').callContext>
  >;
  voice_availability?: {
    available: boolean;
    reason: string;
    sent_count: number;
    target_min: number;
    target_max: number;
    max_characters: number;
  };
  conversation_context?: import('../character/conversation').ConversationContext;
  time_context?: TurnTime;
  day_continuity?: DayContinuity;
  persona_events?: import('../memory/persona-events').PersonaEvent[];
  persona_statements?: import('../memory/persona-events').PersonaStatement[];
  delivery_context?: {
    kind: string;
    reason: string | null;
    sent_parts?: string[];
  };
  date: string;
  day: Record<string, unknown>;
  disclosure: { stage_id: string; guidance: string };
  relationship: {
    turns: number;
    days: number;
    known_slots: number;
    gap_note: string;
  };
  onboarding: {
    intro_due: boolean;
    met_on_dating_site: string;
    ira_goal: string;
    already_greeted: boolean;
    greeting_note: string;
  };
  goal_plan: GoalPlan;
  known_interlocutor: Record<string, string>;
  slot_catalog: Slot[];
  available_slots: Slot[];
  deferred_slots: string[];
  persona: Record<string, unknown>;
  memories: Memory[];
  callback_candidates: Memory[];
  agreements: string[];
  shared_topics: Record<string, unknown>[];
  storylines: Storyline[];
  reply_rhythm: ReplyRhythm;
}

export interface CharacterConfig {
  timeZone?: string;
  persona: Record<string, any>;
  day: Record<string, any>;
  goals: Record<string, any>;
  storylines: Record<string, any>;
}

export interface AppSettings {
  model: string;
  custom_prompt: string;
  interlocutor_name: string;
  interlocutor_age: string;
  dating_site: string;
  initiative_enabled: boolean;
  proactive_max_per_day: number;
  quiet_start: string;
  quiet_end: string;
}
