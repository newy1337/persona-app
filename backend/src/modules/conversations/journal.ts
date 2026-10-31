import { DEAL_STAGE_LABELS, type DealStage } from 'src/domain/deal-stage';
import { PAUSE_REASON_SEP, TakeoverReason } from 'src/domain/pause';

/** Строка истории чата: кто, что и когда. */
export interface JournalItem {
  ts: number;
  /** имя в панели; «Бот» и «Система» — для автоматических действий */
  who: string;
  text: string;
  failed?: boolean;
}

export interface AuditRow {
  ts: number;
  action: string;
  payloadJson: string | null;
  result: string;
  error: string | null;
  user: { username: string } | null;
}

export interface FunnelRow {
  ts: number;
  eventType: string;
  eventMeta: string | null;
}

const ACTIONS: Record<string, string> = {
  'conversation.pause': 'Выключил(а) бота',
  'conversation.resume': 'Включил(а) бота',
  'conversation.answer': 'Нажал(а) «Ответить сейчас»',
  'conversation.manual_message': 'Написал(а) сообщение',
  'conversation.attachment': 'Отправил(а) вложение',
  'conversation.album': 'Отправил(а) альбом',
  'conversation.library_photo': 'Отправил(а) фото из образа',
  'conversation.sticker': 'Отправил(а) стикер',
  'conversation.reaction': 'Поставил(а) реакцию',
  'conversation.edit_message': 'Изменил(а) сообщение',
  'conversation.note': 'Изменил(а) заметку',
  'conversation.pin_fact': 'Закрепил(а) факт о клиенте',
  'conversation.set_slot': 'Изменил(а) данные клиента',
  'conversation.set_stage': 'Сменил(а) шаг сценария',
  'conversation.hide': 'Убрал(а) в архив',
  'conversation.unhide': 'Вернул(а) из архива',
  'conversation.clear_refusal_lock': 'Снял(а) отказ клиента',
  'conversation.export': 'Выгрузил(а) переписку',
  'conversation.export_html': 'Выгрузил(а) переписку в HTML',
  'lead.create': 'Добавил(а) лида',
  'lead.update': 'Изменил(а) лида',
  'lead.delete': 'Удалил(а) лида',
  'lead.write_from_another': 'Перевёл(а) лида на другой аккаунт',
};

const parse = (json: string | null): Record<string, unknown> => {
  try {
    const v = JSON.parse(json ?? 'null');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

const stageLabel = (stage: unknown) =>
  DEAL_STAGE_LABELS[stage as DealStage] ?? String(stage ?? '');

function auditText(row: AuditRow): string {
  const payload = parse(row.payloadJson);
  if (row.action === 'conversation.deal_stage') {
    const note = typeof payload.note === 'string' ? payload.note.trim() : '';
    return `Этап сделки: ${stageLabel(payload.stage)}${note ? ` — ${note}` : ''}`;
  }
  return ACTIONS[row.action] ?? row.action;
}

/** Текст причины без служебной метки: «human_takeover:просит фото» → «просит фото». */
const reasonText = (reason: unknown) => {
  const raw = String(reason ?? '');
  const at = raw.indexOf(PAUSE_REASON_SEP);
  return at >= 0 ? raw.slice(at + 1).trim() : '';
};

/**
 * Автоматические включения и выключения бота. Ручные (operator:web) уже
 * есть в журнале панели — с именем менеджера, второй раз их не показываем.
 */
function funnelItem(row: FunnelRow): JournalItem | null {
  const meta = parse(row.eventMeta);
  const actor = String(meta.actor ?? '');
  if (actor === 'operator:web') return null;
  const why = reasonText(meta.reason);
  if (row.eventType === 'conversation_paused') {
    const head = String(meta.reason ?? '').split(PAUSE_REASON_SEP, 1)[0];
    if (actor.startsWith('voicer:call:'))
      return {
        ts: row.ts,
        who: 'Система',
        text: 'Бот выключен на звонок войсера',
      };
    if (actor.startsWith('bot:'))
      return {
        ts: row.ts,
        who: 'Бот',
        text: `Бот отдал чат менеджеру${why ? `: ${why}` : ''}`,
      };
    if (actor.startsWith('manager:'))
      return {
        ts: row.ts,
        who: 'Система',
        text: 'Бот выключен: менеджер отправил сообщение',
      };
    if (head === TakeoverReason.ARCHIVED)
      return { ts: row.ts, who: 'Система', text: 'Бот выключен: чат в архиве' };
    return {
      ts: row.ts,
      who: 'Система',
      text: `Бот выключен${why ? `: ${why}` : ''}`,
    };
  }
  if (row.eventType === 'conversation_resumed') {
    if (actor.startsWith('system:after_call:'))
      return {
        ts: row.ts,
        who: 'Система',
        text: 'Бот включён после звонка войсера',
      };
    if (actor === 'system:auto_resume')
      return { ts: row.ts, who: 'Система', text: 'Бот включён по таймеру' };
    return { ts: row.ts, who: 'Система', text: 'Бот включён' };
  }
  if (row.eventType === 'outreach_sent')
    return { ts: row.ts, who: 'Бот', text: 'Первое сообщение рассылки' };
  return null;
}

/** История чата, новые сверху. */
export function journalItems(
  audit: readonly AuditRow[],
  funnel: readonly FunnelRow[],
): JournalItem[] {
  const items: JournalItem[] = [
    ...audit.map((row) => ({
      ts: row.ts,
      who: row.user?.username ?? 'Система',
      text: auditText(row),
      ...(row.result === 'failure'
        ? {
            failed: true,
            text: `${auditText(row)} — ошибка: ${row.error ?? ''}`.trim(),
          }
        : {}),
    })),
    ...funnel.map(funnelItem).filter((i): i is JournalItem => i !== null),
  ];
  return items.sort((a, b) => b.ts - a.ts);
}
