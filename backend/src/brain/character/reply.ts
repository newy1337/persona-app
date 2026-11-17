import { ModelResponseError } from '../kernel/errors';

// Модель иногда пишет заглушку вместо ответа — собеседнику её отправлять нельзя.
const PLACEHOLDER_REPLY_RX =
  /^[\s([<«"'*]*(пустой\s+ответ|пусто|пустая\s+строка|пустое\s+сообщение|нет\s+ответа|без\s+ответа|ответа\s+нет|empty(\s+reply|\s+response)?|no\s+(reply|response)|n\/a)[\s)\]>»"'*.!…]*$/iu;

export function isPlaceholderReply(text: string): boolean {
  return PLACEHOLDER_REPLY_RX.test(text.trim());
}

// Модель вместо инициативного сообщения рассуждает о том, писать ли: «Этот
// разговор уже закрыт… Не буду отправлять новое сообщение», «(ничего не
// отправлено)». Это пояснение для нас, не реплика персонажа — не отправлять.
const META_REPLY_RX = [
  // «(пусто)», «[пустая строка — писать неуместно…]», «(ничего не отправляется)»
  /^\s*[([<«*]+\s*(пусто|пуст(ая|ое|ой)\s+(строка|сообщение|ответ)|ничего\s+не\s+отправ)/iu,
  /^\s*ничего\s+не\s+(отправлено|отправляю|отправляется)[\s.!…]*$/iu,
  /не\s+(буду|стану)\s+(ничего\s+)?отправлять(\s+(ему|ей|новое|никакое|ещё|снова))*\s+сообщени/iu,
  /(сообщение|ничего)\s+не\s+(отправляю|отправлено|отправлю)/iu,
  /(разговор|диалог|переписка)\s+уже\s+(закрыт|заверш|окончен)/iu,
  /(писать|отправлять)[^.\n]{0,25}(нет\s+смысла|неуместно)/iu,
];

export function isMetaReply(text: string): boolean {
  return META_REPLY_RX.some((rx) => rx.test(text));
}

/**
 * Признаки чужого текста в ответе: модель иногда дописывает после реплики
 * кусок веб-страницы (подвал сайта, «Powered by…», баннер cookie), служебные
 * метки или вставки чат-приложения. Собеседнику это уходить не должно.
 */
const LEAK_MARKERS: readonly RegExp[] = [
  /<\/?(?:html|head|body|div|span|p|a|nav|footer|header|section|main|article|script|style|br|ul|ol|li|button|meta|link|iframe|form|input|table|tr|td)\b[^>]*>/i,
  /<\|[^|<>\s]{2,}\|>/,
  /<\/?[a-z]+(?:_[a-z]+)+>/i,
  /long_conversation_reminder/i,
  /^[ \t]*powered by\b/im,
  /scroll to top/i,
  /claude exporter/i,
  /поделиться этим чатом/i,
  /share this (?:chat|conversation)/i,
  /&(?:copy|nbsp|amp|lt|gt|quot);/i,
  /©\s*\d{4}/,
  /^[ \t]*```/m,
];

/** Реплика персоны за ход заметно короче: длиннее — модель понесло. */
export const MAX_REPLY_CHARS = 1500;

/**
 * Отрезает чужой текст: всё со строки с первым признаком до конца. leaked —
 * было что отрезать. Пустой text — ответ целиком чужой.
 */
export function stripLeakedText(reply: string): {
  text: string;
  leaked: boolean;
} {
  let at = -1;
  for (const marker of LEAK_MARKERS) {
    const match = marker.exec(reply);
    if (match && (at < 0 || match.index < at)) at = match.index;
  }
  if (at < 0) return { text: reply, leaked: false };
  // С начала строки: начало строки с меткой — тоже чужое.
  const lineStart = reply.lastIndexOf('\n', at - 1) + 1;
  return { text: reply.slice(0, lineStart).trim(), leaked: true };
}

/** Чужой текст отрезан; ничего не осталось или ответ слишком длинный — ошибка, ход пересоберётся. */
export function dropLeakedText(reply: string, stage: string): string {
  const { text } = stripLeakedText(reply);
  if (!text.trim())
    throw new ModelResponseError(`${stage}: reply is foreign text`);
  if (text.length > MAX_REPLY_CHARS)
    throw new ModelResponseError(
      `${stage}: reply is too long (${text.length} chars)`,
    );
  return text;
}

export function enforceReplyRules(reply: string): string {
  const raw = reply.replace(/\r\n?/g, '\n').trim();
  if (!raw || isPlaceholderReply(raw))
    throw new ModelResponseError('Model returned an empty reply');
  const text = dropLeakedText(raw, 'reply');
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n');
}

const REPEATED_GREETING_RX =
  /^\s*(привет(ик(и)?)?|приветствую|хай|хаюшки|салют|здравствуй(те)?|хеллоу|добрый\s+(день|вечер))(?![а-яё])[\s)(!.,:;~\p{Extended_Pictographic}]*/iu;

export function dropRepeatedGreeting(reply: string): string {
  const match = REPEATED_GREETING_RX.exec(reply);
  if (!match) return reply;
  const rest = reply.slice(match[0].length).trimStart();
  return rest ? rest : reply;
}

export function normalizeReply(text: string): string {
  return text
    .trim()
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/\*(.*?)\*/gs, '$1')
    .replace(/^[ \t]*[-*][ \t]+/gm, '');
}
