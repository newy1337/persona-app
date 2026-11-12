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

export function enforceReplyRules(reply: string): string {
  const text = reply.replace(/\r\n?/g, '\n').trim();
  if (!text || isPlaceholderReply(text))
    throw new ModelResponseError('Model returned an empty reply');
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
