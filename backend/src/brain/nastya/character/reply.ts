import { ModelResponseError } from '../kernel/errors';

export function enforceReplyRules(reply: string): string {
  const text = reply.replace(/\r\n?/g, '\n').trim();
  if (!text) throw new ModelResponseError('Model returned an empty reply');
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
