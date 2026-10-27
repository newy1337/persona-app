import { CALL_CONTEXT_RULE } from 'src/shared/call-context';
import type {
  HistoryMessage,
  Judgment,
  RuntimeSnapshot,
} from '../kernel/types';
import {
  judgeHistory,
  judgeResponseText,
  parseJsonObject,
  recordReferences,
} from './transport';
import type { JudgeDeps } from './transport';
import {
  judgeReference,
  referenceText,
  REFERENCED_STATE_KEYS,
} from './reference';
import { validateJudgment } from './validate';
import {
  CONVERSATION_PLAN_RULE,
  validQuestionIds,
} from '../character/conversation';
import { QUESTION_POLICY_RULE } from '../config/question-policy';

import { TIME_RULES } from '../kernel/turn-time';
import { CONTINUITY_RULES } from '../character/continuity';

import {
  PERSONA_EVENT_RULE,
  validatePersonaEvents,
} from '../memory/persona-events';

export const MEDIA_REQUEST_RULE = `ДОПОЛНИТЕЛЬНОЕ ПОЛЕ JSON "media_request": "voice" | "photo" | "video_note" | "video" | "".
Заполняй, только если в последнем сообщении человек просит персонажа (того, от чьего имени идёт переписка) прислать что-то из этого:
голосовое («запиши голосовое», «хочу услышать голос», «скинь войс»), своё фото или селфи
(«скинь фотку», «покажи себя», «фото в полный рост»), кружок (видеосообщение) или видео.
Просьба может быть мягкой или на будущее («а фотку скинешь?», «потом запишешь голосовое?») — это тоже просьба.
Не считается: разговор о фото вообще, его предложение прислать своё, обсуждение уже присланного,
вопрос «ты фотографируешь?», а также согласие или ожидание после того, как ему уже ответили на
прошлую просьбу («договорились», «жду», «ок») — смотри только новые сообщения человека.
Нет новой просьбы — пустая строка.`;

export const AUTO_VOICE_RULE = `Дополнительное поле JSON "voice_reply": {"send": false, "emotion": "", "reason": ""}.
Если voice_availability.available=true, можешь выбрать send=true: текущий ответ запишет человек и он будет доставлен одним голосовым.
Решай по текущей теме, характеру и биографии личности, степени знакомства, настроению и пожеланиям собеседника. В длинном общении ориентир 5–10 голосовых за весь диалог, а не за день. Это не обязательный минимум для короткого или неподходящего разговора. Чередуй с текстом, не записывай голосовые подряд без причины.
Прямая просьба услышать голос — хороший повод, но не приказ: личность может предпочесть текст, не быть настроена или не захотеть. Если человек просит без голосовых, сейчас не может слушать, занят или спит — выбери текст. Не считай его входящее аудио просьбой автоматически.
Тёплая реакция, личный рассказ или юмор могут выиграть от голоса. Для сухого уточнения, ссылки, номера, ссоры или формального подтверждения обычно лучше текст. Для send=true обязательны конкретная причина уместности и краткая эмоциональность для войсера. Не придумывай новые биографические факты ради голоса.
Если voice_availability отсутствует или available=false, send=false. media_request распознавай независимо: наличие просьбы не обязывает voice_reply.send=true.`;

export const PHOTO_REPLY_RULE = `Дополнительное поле JSON "photo_reply": {"photo_id": "", "reason": ""}.
photo_availability — личная галерея персонажа: снимки с описанием, местом и датой. Если photo_availability.available=true, можешь выбрать один снимок из photo_availability.candidates и указать его id и конкретную причину: он уйдёт вместе с ответом, а текст ответа станет подписью.
Выбирай редко и только к месту: собеседник сам заговорил о теме снимка (рассказал про своего кота — можно показать своего), прямо попросил фото, или снимок естественно продолжает рассказ персонажа. Не цепляйся за любое упоминание темы, не отправляй фото в каждом разговоре и не делай из него ответ на всё. Лимит — это потолок, а не план.
Если photo_availability.mode="request", выбирай только на прямую просьбу показать фото в последнем сообщении человека.
Снимок не должен противоречить биографии персонажа, фактам из диалога и уже сказанному (питомец, город, внешность, время года). Сомневаешься — не выбирай. Снимки из shown_before собеседник уже видел: не выбирай их и учитывай, что он мог спрашивать о них.
Просьба о фото, которой нет подходящего снимка, — photo_id пустой, ответ текстом. Если выбрано голосовое (voice_reply.send=true), photo_id пустой. Если photo_availability отсутствует или available=false, photo_id пустой.`;

export interface JudgeDialogueInput {
  prompt: string;
  runtime: RuntimeSnapshot;
  history: readonly Partial<HistoryMessage>[];
  userText: string;
  customInstructions?: string;
}

export async function judgeDialogue(
  input: JudgeDialogueInput,
  deps: JudgeDeps,
): Promise<Judgment> {
  const { prompt, runtime, history, userText, customInstructions = '' } = input;
  const allowedSlots = new Set<string>(
    runtime.slot_catalog.map((slot) => String(slot.id)),
  );
  const askableSlots = new Set<string>(
    runtime.available_slots.map((slot) => String(slot.id)),
  );
  const memoryIds = new Set<string>(
    [
      ...runtime.memories,
      ...(runtime.conversation_context?.preferences ?? []),
    ].map((item) => String(item.id)),
  );
  const storylineIds = new Set<string>(
    runtime.storylines.map((item) => String(item.id)),
  );

  const reference = judgeReference(runtime);
  const context: Record<string, unknown> = { ...runtime };
  for (const key of REFERENCED_STATE_KEYS) delete context[key];
  context['storylines'] = recordReferences(
    runtime.storylines as unknown as Record<string, unknown>[],
    reference.past_episodes,
  );
  context['available_slots'] = recordReferences(
    runtime.available_slots as unknown as Record<string, unknown>[],
    runtime.slot_catalog as unknown as Record<string, unknown>[],
  );
  context['callback_candidates'] = recordReferences(
    runtime.callback_candidates as unknown as Record<string, unknown>[],
    runtime.memories as unknown as Record<string, unknown>[],
  );

  const payload = {
    dialogue_state: context,
    recent_history: judgeHistory(history, 30, 10),
    latest_user_message: userText,
    interlocutor_settings: customInstructions,
    allowed_slot_ids: [...allowedSlots].sort(),
    askable_slot_ids: [...askableSlots].sort(),
    allowed_memory_ids: [...memoryIds].sort(),
    allowed_storyline_ids: [...storylineIds].sort(),
  };

  const text = await judgeResponseText(
    deps,
    {
      stable: `${prompt}\n\n${MEDIA_REQUEST_RULE}\n\n${AUTO_VOICE_RULE}\n\n${PERSONA_EVENT_RULE}\n\n${QUESTION_POLICY_RULE}\n\n${TIME_RULES}\n\n${CALL_CONTEXT_RULE}\n\n${CONTINUITY_RULES}\nЕсли собеседник явно сообщил новое текущее место, обнови слот location. Будущая поездка, родной город и чужой город не меняют его текущее место.\n\n${referenceText(reference)}`,
      // Правила, которые есть не у каждого диалога, — после истории: в
      // стабильной части они делили бы кеш на варианты.
      volatile: [
        runtime.conversation_context ? CONVERSATION_PLAN_RULE : '',
        runtime.photo_availability ? PHOTO_REPLY_RULE : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
    payload,
    6000,
    'judge_plan',
  );
  const parsed = parseJsonObject(text);
  const result = validateJudgment(
    parsed,
    allowedSlots,
    askableSlots,
    memoryIds,
    storylineIds,
    userText,
  );
  if (runtime.conversation_context)
    result.answer_question_ids = validQuestionIds(
      parsed['answer_question_ids'],
      runtime,
    );
  result.persona_event_updates = validatePersonaEvents(
    parsed['persona_event_updates'],
    runtime.persona_statements ?? [],
    runtime.persona_events ?? [],
  );
  return result;
}
