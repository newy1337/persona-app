import type { AppSettings, ConversationState } from '../kernel/types';
import { goodnightReason } from './goodnight-policy';
import type { Rhythm } from '../config/rhythm';
import { initiativeIsDue, unansweredUnprompted } from './initiative';
import { ritualSlot, staleness, type RitualKind } from './rhythm';

/** Чаты, где последнее движение старше этого, бот сам не трогает. */
export const ACTIVE_CHAT_DAYS = 30;
/** Утреннее сообщение — не раньше чем через столько после последнего сообщения в чате. */
export const MORNING_QUIET_BEFORE_SECONDS = 3 * 3600;
/** Прощание — не раньше чем через столько после последнего сообщения. */
export const GOODNIGHT_QUIET_BEFORE_SECONDS = 20 * 60;

/**
 * Что бот сделает в этом чате дальше, если собеседник больше ничего не напишет.
 * Для панели: «ответит через 12 мин», «напишет „доброе утро“ завтра в 08:40»,
 * «сам не напишет — ждёт ответа».
 */
export type NextBotAction =
  | { kind: 'stopped' }
  | { kind: 'no_model' }
  | { kind: 'no_account' }
  | { kind: 'account_offline' }
  | { kind: 'account_banned' }
  | { kind: 'account_logged_out' }
  | { kind: 'client_blocked' }
  | { kind: 'manual' }
  | { kind: 'refused' }
  | { kind: 'reply'; at: number; reason: string }
  | { kind: 'composing' }
  | { kind: 'no_reply'; why: 'expired' | 'not_scheduled' }
  | { kind: 'waiting' }
  | { kind: 'initiative_off' }
  | { kind: 'morning' | 'goodnight' | 'initiative'; at: number }
  | { kind: 'none' };

export interface ForecastInput {
  chatId: number;
  nowTs: number;
  stopped: boolean;
  ready: boolean;
  hasAccount: boolean;
  /** Аккаунт чата в сети; false — ответы и сообщения ждут, пока он подключится. */
  accountOnline?: boolean;
  /** Telegram заблокировал аккаунт (`banned`) или завершил его сессию (`unauthorized`). */
  accountLost?: 'banned' | 'unauthorized' | null;
  /** Собеседник заблокировал наш аккаунт. */
  blockedByClient?: boolean;
  paused: boolean;
  refused: boolean;
  schedule: { dueAt: number; reason: string } | null;
  /** Ответ прямо сейчас готовится или отправляется: из очереди он уже забран. */
  composing?: boolean;
  /** Opt-in conversation policy: do not promise an unsolicited message over an unanswered question. */
  unansweredQuestion?: boolean;
  lastRole: string | null;
  lastUserTs: number | null;
  lastAssistantTs: number | null;
  state: ConversationState;
  rhythm: Rhythm;
  settings: Pick<
    AppSettings,
    'initiative_enabled' | 'proactive_max_per_day' | 'quiet_start' | 'quiet_end'
  >;
}

const HORIZON_SECONDS = 48 * 3600;
const STEP_SECONDS = 10 * 60;

/**
 * Прогноз строится теми же проверками, по которым бот решает писать сам (окна утра
 * и прощания, «куда пропал», лимит подряд), прогнанными вперёд по времени — поэтому
 * он не расходится с тем, что бот действительно сделает.
 */
export function forecastNextAction(input: ForecastInput): NextBotAction {
  const { nowTs, state, rhythm } = input;
  if (input.stopped) return { kind: 'stopped' };
  if (!input.hasAccount) return { kind: 'no_account' };
  if (input.accountLost === 'banned') return { kind: 'account_banned' };
  if (input.accountLost === 'unauthorized')
    return { kind: 'account_logged_out' };
  if (input.paused) return { kind: 'manual' };
  if (input.refused) return { kind: 'refused' };
  if (input.blockedByClient) return { kind: 'client_blocked' };
  if (input.accountOnline === false) return { kind: 'account_offline' };
  if (!input.ready) return { kind: 'no_model' };
  if (input.schedule)
    return {
      kind: 'reply',
      at: Math.max(nowTs, input.schedule.dueAt),
      reason: input.schedule.reason,
    };
  if (input.composing) return { kind: 'composing' };
  if (input.unansweredQuestion)
    return { kind: 'no_reply', why: 'not_scheduled' };

  if (input.lastRole === 'user' && input.lastUserTs !== null) {
    return {
      kind: 'no_reply',
      why:
        staleness(input.lastUserTs, nowTs, rhythm) === 'expired'
          ? 'expired'
          : 'not_scheduled',
    };
  }
  if (!input.settings.initiative_enabled) return { kind: 'initiative_off' };
  if (unansweredUnprompted(state) >= rhythm.max_unanswered)
    return { kind: 'waiting' };

  const lastUserTs = input.lastUserTs;
  const lastAnyTs = Math.max(lastUserTs ?? 0, input.lastAssistantTs ?? 0);
  const initiative = { ...input.settings, initiative_enabled: true };

  for (let t = nowTs; t <= nowTs + HORIZON_SECONDS; t += STEP_SECONDS) {
    const at = new Date(t * 1000);

    for (const kind of ['morning', 'goodnight'] as RitualKind[]) {
      const slot = ritualSlot(
        at,
        rhythm[kind],
        rhythm.timezone,
        input.chatId,
        kind,
      );
      if (!slot.due || slot.windowStartTs === null) continue;
      if (state.rhythm?.[kind]?.[slot.day]) continue;
      if (
        lastUserTs === null ||
        t - lastUserTs > rhythm.skip_if_silent_days * 86400
      )
        continue;
      if (kind === 'morning') {
        if (lastUserTs >= slot.windowStartTs) continue;
        if (t - lastAnyTs < MORNING_QUIET_BEFORE_SECONDS) continue;
      } else {
        if (!goodnightReason(state.history ?? [], t)) continue;
        const [h, m] = rhythm.goodnight.from.split(':').map(Number);
        const dayStartTs = slot.windowStartTs - ((h || 0) * 60 + (m || 0)) * 60;
        if (lastUserTs < dayStartTs) continue;
        if (t - lastAnyTs < GOODNIGHT_QUIET_BEFORE_SECONDS) continue;
      }
      return {
        kind,
        at: Math.max(nowTs, slot.windowStartTs + slot.plannedMinute * 60),
      };
    }

    if (t - lastAnyTs > ACTIVE_CHAT_DAYS * 86400) continue;
    if (!initiativeIsDue(state, initiative, at, rhythm.timezone)) continue;
    const morning = ritualSlot(
      at,
      rhythm.morning,
      rhythm.timezone,
      input.chatId,
      'morning',
    );
    if (
      rhythm.morning.enabled &&
      morning.windowStartTs !== null &&
      !state.rhythm?.morning?.[morning.day]
    )
      continue;
    return { kind: 'initiative', at: t };
  }
  return { kind: 'none' };
}
