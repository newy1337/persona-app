export enum TakeoverReason {
  MANUAL_TAKEOVER = 'human_takeover',
  HOLD = 'operator_hold',
  REFUSAL = 'paused',
  CEILING_HALT = 'ceiling_halt',
  PERSONA_AWAY = 'persona_away',
  ARCHIVED = 'archived',
}

export const BOT_ACTIVE_REASON = 'bot_active';

export const PAUSE_REASON_SEP = ':';

export function pauseReasonHead(reason: string | null | undefined): string {
  return String(reason ?? '').split(PAUSE_REASON_SEP, 1)[0];
}

export interface PauseState {
  status: 'active' | 'paused';
  reason: string;
  actor: string | null;
  until: number | null;
  ts: number | null;
}

export const isPaused = (state: PauseState) => state.status === 'paused';
