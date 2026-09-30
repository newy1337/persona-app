import { conversational, conversationContext } from './conversation';
import { personaGender, voiceOf, type Gender } from './gender';
import type {
  CharacterConfig,
  CharacterState,
  ConversationState,
  Memory,
  RuntimeSnapshot,
  Stage,
  Storyline,
} from '../kernel/types';
import { asInt } from '../kernel/coerce';
import { characterDate, parseDate } from '../kernel/clock';
import { selectRelevantMemories } from '../memory/select';
import { stripMetadata } from './config';
import { conversationPersona } from './persona';
import { dayState } from './day';
import { stageIndex } from './stage';
import { acquaintanceGoalPlan, availableSlots } from './slots';
import { activeStorylines, pastEpisodes } from './storylines';
import { oneQuestionPerReply } from '../config/question-policy';

import { dayContinuity } from './continuity';

import {
  personaStatements,
  relevantPersonaEvents,
} from '../memory/persona-events';

const MAX_CALLBACK_CANDIDATES = 6;

const DEFAULT_DISCLOSURE =
  'Раскрывайся по ходу взаимного разговора, не пересказывай всю биографию.';

/**
 * Сколько её приветствие считается «этим разговором». Написала «Привет, это Настя»
 * полчаса назад — второе «привет» звучит как бот. Ответ на следующий день может
 * начинаться с приветствия заново.
 */
const GREETED_WINDOW_SECONDS = 3 * 3600;
/** Род персонажа и собеседника — из документа личности: у мужской личности формы свои. */
export function greetingNote(
  gender: Gender = 'female',
  oneQuestionOnly = true,
  contextDriven = false,
): string {
  if (contextDriven)
    return 'Разговор уже идёт: не представляйся и не здоровайся повторно. Продолжай по смыслу сообщения; вопрос и рассказ о себе выбирай по контексту, они не обязательны.';
  const g = voiceOf(gender);
  const followup = oneQuestionOnly
    ? `поддержи разговор ровно одним лёгким вопросом ${g.they.about} — про день или настроение, не два вопроса подряд.`
    : `поддержи разговор по ситуации; уместные вопросы ${g.they.about} допустимы, но не обязательны.`;
  return (
    `Ты уже ${g.v('поздоровалась', 'поздоровался')} и ${g.v('назвала', 'назвал')} себя в этом разговоре: не здоровайся снова и не представляйся повторно. ` +
    `Если ${g.they.he} просто ${g.c('поздоровался', 'поздоровалась')} в ответ — отреагируй тепло и коротко (${g.v('рада', 'рад')}, что ${g.c('ответил', 'ответила')}) и ${followup}` +
    ` Без анкеты и без рассказа о себе, о котором ${g.they.he} не ${g.c('спрашивал', 'спрашивала')}.`
  );
}

/**
 * Everything the judge and the author need about this turn.
 *
 * Building it has side effects on `state.character`: storyline progress and
 * the storyline cursor advance here, because they are a function of the date.
 */
export function buildRuntimeSnapshot(
  config: CharacterConfig,
  state: ConversationState,
  today: string = characterDate(new Date(), config.timeZone),
  query = '',
  nowTs: number = Math.floor(Date.now() / 1000),
): RuntimeSnapshot {
  const character: CharacterState = (state.character ??= {});
  const goals = config.goals;
  const oneQuestionOnly = oneQuestionPerReply(goals);
  const stages: Stage[] = goals['stages'] ?? [];
  const stage = stages[stageIndex(stages, character.stage_id)]!;

  const dayNumber = Math.max(1, character.days?.length ?? 0);
  const knownSlots = character.slots ?? {};
  const available = availableSlots(goals, character, dayNumber, query);

  const tone = character.tone ?? stage.manner ?? {};
  const sharedTopics = ((goals['shared'] ?? []) as Array<Record<string, any>>)
    .filter(
      (topic) =>
        Number(topic['personal'] ?? 0) <= Number(tone['personal'] ?? 0),
    )
    .map((topic) => stripMetadata(topic));

  const relevantMemories = selectRelevantMemories(state, query, today);
  const storylines: Storyline[] = [
    ...activeStorylines(config.storylines, character, today),
    ...pastEpisodes(config.persona, config.storylines),
  ];
  const sharedStories = character.shared_stories ?? {};
  for (const line of storylines)
    line.last_shared_on = sharedStories[line.id] ?? '';

  const day = dayState(config.day, today);
  return {
    conversation_context: conversationContext(config, state, query),
    date: today,
    persona_events: relevantPersonaEvents(state.persona_events ?? [], query),
    persona_statements: personaStatements(
      state.history ?? [],
      config.timeZone ?? 'UTC',
      nowTs,
      query,
    ),
    day,
    day_continuity: dayContinuity(
      state.history ?? [],
      config.timeZone ?? 'UTC',
      nowTs,
      query,
      day,
    ),
    disclosure: {
      stage_id: stage.id,
      guidance:
        (goals['self_disclosure'] ?? {})[stage.id] ?? DEFAULT_DISCLOSURE,
    },
    relationship: {
      turns: asInt(character.turns),
      days: dayNumber,
      known_slots: Object.keys(knownSlots).length,
      gap_note:
        asInt(character.cool_turns_remaining) > 0
          ? (character.gap_note ?? '')
          : '',
    },
    onboarding: {
      intro_due: !(
        character.self_intro_shared || (state.history ?? []).length > 0
      ),
      ...greeting(
        state,
        nowTs,
        personaGender(config.persona),
        oneQuestionOnly,
        conversational(config),
      ),
      met_on_dating_site: String(knownSlots['dating_site'] ?? ''),
      ira_goal: String(
        (goals['acquaintance_plan'] ?? {})['first_reply']?.['ira_goal'] ?? '',
      ),
    },
    goal_plan: acquaintanceGoalPlan(character, available, oneQuestionOnly),
    known_interlocutor: knownSlots,
    slot_catalog: ((goals['slots'] ?? []) as any[]).map((slot) =>
      stripMetadata(slot),
    ),
    available_slots: available,
    deferred_slots: character.deferred_slots ?? [],
    persona: conversationPersona(config.persona),
    memories: relevantMemories,
    callback_candidates: callbackCandidates(relevantMemories, today),
    agreements: state.agreements ?? [],
    shared_topics: sharedTopics,
    storylines,
    reply_rhythm: {
      kind: 'normal',
      guidance: 'Длина определяется текущим разговором.',
    },
  };
}

/** Её последнее сообщение моложе окна — значит, в этом разговоре она уже поздоровалась. */
export function greeting(
  state: ConversationState,
  nowTs: number,
  gender: Gender = 'female',
  oneQuestionOnly = true,
  contextDriven = false,
): { already_greeted: boolean; greeting_note: string } {
  const own = [...(state.history ?? [])]
    .reverse()
    .find((message) => message.role === 'assistant');
  const at = asInt(own?.created_at);
  const already = Boolean(own) && at > 0 && nowTs - at < GREETED_WINDOW_SECONDS;
  return {
    already_greeted: already,
    greeting_note: already
      ? greetingNote(gender, oneQuestionOnly, contextDriven)
      : '',
  };
}

/** Active memories that are due and were not already recalled today. */
function callbackCandidates(
  memories: readonly Memory[],
  today: string,
): Memory[] {
  return memories
    .filter((memory) => {
      if (memory.status !== 'active' || memory.last_recalled_on === today)
        return false;
      const due = parseDate(memory.due_on);
      return !due || due <= today;
    })
    .slice(0, MAX_CALLBACK_CANDIDATES);
}
