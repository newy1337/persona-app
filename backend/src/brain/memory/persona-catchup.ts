import { characterClock, characterDate } from '../kernel/clock';
import type { ConversationState, HistoryMessage } from '../kernel/types';
import {
  PERSONA_EVENT_RULE,
  type PersonaStatement,
  recordPersonaEvents,
  relevantPersonaEvents,
  validatePersonaEvents,
} from './persona-events';
import {
  type JudgeDeps,
  judgeResponseText,
  parseJsonObject,
} from '../judge/transport';

/** Сколько реплик разбираем за один догоняющий проход. */
const BATCH = 40;

const CATCHUP_PROMPT = `Ты ведёшь память персонажа о его собственных словах.

Тебе дают persona_statements — реплики, отправленные собеседнику от имени персонажа, которые ещё не разобраны. Часть из них писал бот, часть — менеджер вручную (source: operator); для собеседника это один и тот же человек, поэтому различий между ними не делай.

Верни ТОЛЬКО JSON вида {"persona_event_updates": [...]} по правилам ниже. Ничего, кроме этого объекта.

${PERSONA_EVENT_RULE}`;

const statement = (
  message: HistoryMessage,
  timezone: string,
): PersonaStatement => ({
  id: message.id,
  text: message.content.slice(0, 1200),
  date: characterDate(new Date(message.created_at * 1000), timezone),
  time: characterClock(new Date(message.created_at * 1000), timezone)
    .map((n) => String(n).padStart(2, '0'))
    .join(':'),
  ts: message.created_at,
  source: message.source,
});

const panelId = (message: HistoryMessage): number =>
  message.panel_message_id ?? 0;

/**
 * Реплики от имени персоны, которые ещё никто не разбирал. В обычном ходе
 * разбор идёт вместе с ответом бота, поэтому сюда попадает в основном то, что
 * написал менеджер, пока бот молчал.
 */
export function undigestedStatements(
  state: ConversationState,
  timezone: string,
  nowTs: number,
  limit = BATCH,
): PersonaStatement[] {
  const cursor = state.persona_memory_cursor ?? 0;
  return (state.history ?? [])
    .filter(
      (m) =>
        m.role === 'assistant' &&
        m.created_at <= nowTs &&
        m.content?.trim() &&
        panelId(m) > cursor,
    )
    .slice(-limit)
    .map((m) => statement(m, timezone));
}

/** Докуда дошёл разбор, если принять во внимание всё, что сейчас в истории. */
export function latestPersonaMessageId(state: ConversationState): number {
  return (state.history ?? []).reduce(
    (max, m) => (m.role === 'assistant' ? Math.max(max, panelId(m)) : max),
    state.persona_memory_cursor ?? 0,
  );
}

export interface CatchUpResult {
  statements: number;
  events: number;
}

/**
 * Догоняющий разбор: вытаскивает в долговременную память то, что персона
 * говорила, пока обычный ход не работал. Вызывается перед тем, как бот снова
 * начнёт сочинять, — один вызов модели на весь пропущенный кусок.
 */
export async function catchUpPersonaMemory(
  state: ConversationState,
  deps: JudgeDeps,
  timezone: string,
  nowTs: number,
): Promise<CatchUpResult> {
  const statements = undigestedStatements(state, timezone, nowTs);
  if (statements.length === 0) {
    state.persona_memory_cursor = latestPersonaMessageId(state);
    return { statements: 0, events: 0 };
  }

  const before = (state.persona_events ?? []).length;
  const text = await judgeResponseText(
    deps,
    { stable: CATCHUP_PROMPT },
    {
      persona_statements: statements,
      persona_events: relevantPersonaEvents(state.persona_events ?? [], ''),
      today: characterDate(new Date(nowTs * 1000), timezone),
    },
    2000,
    'persona_memory',
  );
  const updates = validatePersonaEvents(
    parseJsonObject(text)['persona_event_updates'],
    statements,
    state.persona_events ?? [],
  );
  recordPersonaEvents(state, updates, timezone, nowTs, statements);

  // Двигаем курсор только по разобранной пачке: остальное догоним следующим
  // проходом, а не потеряем.
  state.persona_memory_cursor = Math.max(
    state.persona_memory_cursor ?? 0,
    statements.reduce(
      (max, s) =>
        Math.max(
          max,
          (state.history ?? []).find((m) => m.id === s.id)?.panel_message_id ??
            0,
        ),
      0,
    ),
  );
  return {
    statements: statements.length,
    events: (state.persona_events ?? []).length - before,
  };
}
