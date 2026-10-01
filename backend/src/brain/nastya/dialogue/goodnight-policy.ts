import type { HistoryMessage } from '../kernel/types';
import { isGoodnightText } from './rhythm';

export function goodnightReason(
  history: readonly Partial<HistoryMessage>[],
  nowTs: number,
): string | null {
  const lastUserIndex = history.map((m) => m.role).lastIndexOf('user');
  if (lastUserIndex < 0) return null;
  const user = history[lastUserIndex];
  const age = nowTs - (user.created_at ?? 0);
  if (age < 0 || age > 2 * 3600) return null;
  const text = (user.content ?? '').trim().toLowerCase().replace(/ё/g, 'е');
  if (
    !text ||
    text.length > 240 ||
    /[?«»"\n]|(?:^|\s)(?:не|нет|но|еще|пока)(?:\s|$)/u.test(text)
  )
    return null;
  if (
    !/(?:^|[.!]\s*|\s)(?:я\s+)?(?:уже\s+)?(?:засыпаю|буду ложиться|собираюсь (?:ложиться|спать)|пора (?:ложиться|спать)|завтра (?:мне )?рано вставать)(?:[.! ),]|$)/u.test(
      text,
    )
  )
    return null;
  if (
    history
      .slice(lastUserIndex + 1)
      .some((m) => m.role === 'assistant' && isGoodnightText(m.content ?? ''))
  )
    return null;
  return user.content!.slice(0, 240);
}

export const OPTIONAL_GOODNIGHT_REVIEW = `Если delivery_context.kind = goodnight, это НЕ обязательная отправка. Верни дополнительное булево should_send. true допустимо только если reason и недавний разговор действительно дают повод завершить беседу, без повторного прощания и без обрыва новой темы. Если повода нет, есть сомнение или сообщение лишнее — should_send:false, approved:false, issues с причиной, final_text:"". Не заменяй отменённое прощание другим инициативным сообщением.`;
