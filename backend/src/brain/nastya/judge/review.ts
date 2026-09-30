import { CALL_CONTEXT_RULE } from 'src/shared/call-context';
import type {
  HistoryMessage,
  Judgment,
  JudgeReview,
  RuntimeSnapshot,
} from '../kernel/types';
import { ModelResponseError } from '../kernel/errors';
import { asText, stringList } from '../kernel/coerce';
import { judgeHistory, judgeResponseText, parseJsonObject } from './transport';
import type { JudgeDeps } from './transport';
import { QUESTION_POLICY_RULE } from '../config/question-policy';

import { TIME_RULES, timeClaimIssues } from '../kernel/turn-time';
import { CONTINUITY_RULES } from '../character/continuity';
import {
  CONVERSATION_REVIEW_RULE,
  validQuestionIds,
} from '../character/conversation';
import { OPTIONAL_GOODNIGHT_REVIEW } from '../dialogue/goodnight-policy';

const REVIEW_STATE_KEYS = [
  'call_context',
  'conversation_context',
  'date',
  'time_context',
  'day_continuity',
  'persona_events',
  'persona_statements',
  'delivery_context',
  'agreements',
  'known_interlocutor',
  'memories',
  'deferred_slots',
  'onboarding',
  'day',
  'disclosure',
  'relationship',
] as const;

export interface ReviewReplyInput {
  timeRepair?: boolean;
  /** Текст промпта проверяющего судьи: из личности. */
  prompt: string;
  persona: Record<string, unknown>;
  runtime: RuntimeSnapshot;
  judgment: Partial<Judgment>;
  history: readonly Partial<HistoryMessage>[];
  userText: string;
  draft: string;
}

export interface ReviewResult extends JudgeReview {
  final_text: string;
  should_send?: boolean;
  unanswered_question_ids?: string[];
}

/**
 * The final judge: approves the draft or returns a minimally corrected one.
 *
 * A rejection without both a concrete issue and a replacement is refused, so
 * the pipeline can never silently drop an answer.
 */
export async function reviewReply(
  input: ReviewReplyInput,
  deps: JudgeDeps,
): Promise<ReviewResult> {
  const { prompt, persona, runtime, judgment, history, userText, draft } =
    input;

  const source = (runtime.persona ?? persona) as Record<string, unknown>;
  const reviewPersona = { ...source };
  for (const key of [
    'story_usage_rules',
    'stories',
    ...(!runtime.conversation_context ? ['human_behavior'] : []),
  ])
    delete reviewPersona[key];

  const dialogueState: Record<string, unknown> = {};
  for (const key of REVIEW_STATE_KEYS) dialogueState[key] = runtime[key];
  dialogueState['goal_plan'] = {
    one_question_per_reply: runtime.goal_plan?.one_question_per_reply ?? true,
  };

  const payload = {
    selected_story:
      runtime.storylines.find((item) => item.id === judgment.storyline_id) ??
      null,
    dialogue_state: dialogueState,
    plan: judgment,
    recent_history: judgeHistory(history, 16),
    latest_user_message: userText,
    draft_reply: draft,
    time_violations: timeClaimIssues(draft, runtime.time_context),
  };

  const parsed = parseJsonObject(
    await judgeResponseText(
      deps,
      {
        stable: `${prompt}\n\n${runtime.conversation_context ? CONVERSATION_REVIEW_RULE : ''}\n\n${QUESTION_POLICY_RULE}\n\n${TIME_RULES}\n\n${CALL_CONTEXT_RULE}\n\n${CONTINUITY_RULES}\n\n${OPTIONAL_GOODNIGHT_REVIEW}\nЕсли delivery_context.kind=continuation, sent_parts уже доставлены: не повторяй их и не начинай знакомство заново. Проверяй только оставшуюся часть ответа с текущими часами и датой. Сам переход через полночь не требует завершать разговор. Если оставшийся текст целиком неактуален и добавлять нечего, верни should_send:false с причиной; иначе should_send:true и актуальное продолжение.\nЕсли delivery_context.kind=voice, проверь именно текст одного короткого голосового до 800 знаков. Не обещай записать его позже, не вставляй эмодзи, сценические ремарки и инструкции войсеру; не добавляй ненадёжные слова о действиях прямо в эту минуту.\nПроверь time_violations: такие нарушения нельзя одобрять, исправь их.\n\nПЕРСОНА:\n${JSON.stringify(reviewPersona)}`,
      },
      payload,
      5000,
      'judge_review',
    ),
  );
  if (
    (runtime.delivery_context?.kind === 'after_call' ||
      (runtime.conversation_context &&
        runtime.delivery_context?.kind === 'initiative')) &&
    parsed['should_send'] === false
  ) {
    return {
      approved: false,
      issues: stringList(parsed['issues'], 10, 300),
      final_text: '',
      should_send: false,
    };
  }
  if (typeof parsed['approved'] !== 'boolean') {
    throw new ModelResponseError('Judge returned an invalid review');
  }
  if (
    runtime.delivery_context?.kind === 'continuation' &&
    parsed['should_send'] === false
  ) {
    return {
      approved: false,
      issues: stringList(parsed['issues'], 10, 300),
      final_text: '',
      should_send: false,
    };
  }
  const approved = parsed['approved'] as boolean;
  const issues = stringList(parsed['issues'], 10, 300);
  const correction = asText(parsed['final_text']).trim();
  if (
    runtime.delivery_context?.kind === 'goodnight' &&
    parsed['should_send'] !== true
  ) {
    return {
      approved: false,
      issues: issues.length
        ? issues
        : ['Нет подтверждённого повода для прощания'],
      final_text: '',
      should_send: false,
    };
  }
  if (!approved && (issues.length === 0 || !correction)) {
    throw new ModelResponseError(
      'Judge rejected reply without a concrete correction',
    );
  }
  const final_text = approved ? draft : correction;
  const timeIssues = timeClaimIssues(final_text, runtime.time_context);
  if (timeIssues.length) {
    if (input.timeRepair)
      throw new ModelResponseError(
        'Reply still contradicts verified local time',
      );
    const repaired = await reviewReply(
      { ...input, draft: final_text, timeRepair: true },
      deps,
    );
    return {
      ...repaired,
      approved: false,
      issues: [...new Set([...issues, ...timeIssues, ...repaired.issues])],
    };
  }
  return {
    approved,
    issues,
    final_text,
    ...(runtime.conversation_context &&
    Array.isArray(parsed['unanswered_question_ids'])
      ? {
          unanswered_question_ids: validQuestionIds(
            parsed['unanswered_question_ids'],
            runtime,
          ),
        }
      : {}),
    ...(runtime.delivery_context?.kind === 'goodnight'
      ? { should_send: true }
      : {}),
  };
}
