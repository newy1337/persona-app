// Напоминание «В N диалогах не указан этап»: один раз в день, и повторно только
// если набор таких диалогов изменился. Память — в браузере менеджера.
export const REMINDER_KEY = 'nastya_stage_reminder';

export const reminderSignature = (rows) =>
  rows
    .filter((r) => !r.deal_stage && !r.hidden)
    .map((r) => String(r.chat_id))
    .sort()
    .join(',');

export function shouldRemind(rows, day, storage = globalThis.localStorage) {
  const signature = reminderSignature(rows);
  if (!signature) return { show: false, count: 0, signature };
  let saved = null;
  try {
    saved = JSON.parse(storage?.getItem(REMINDER_KEY) || 'null');
  } catch {
    saved = null;
  }
  const same = saved && saved.day === day && saved.signature === signature;
  return { show: !same, count: signature.split(',').length, signature };
}

export function rememberReminder(signature, day, storage = globalThis.localStorage) {
  try {
    storage?.setItem(REMINDER_KEY, JSON.stringify({ day, signature }));
  } catch {
    // без хранилища напоминание просто покажется в следующий раз снова
  }
}
