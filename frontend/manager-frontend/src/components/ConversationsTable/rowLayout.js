import { tableMinWidth, useColumnPrefs } from '../ColumnPicker/columnPrefs';
import { optionsFrom } from '../ColumnFilter/filters';
import { useIsAdmin } from '../AppLayout/me';
import { DEAL_STAGES } from '../../data/dealStages';
import { stageColors } from '../../data/stages';
import { nextActionLabel } from '../../utils/scenario';
import { channelBadge } from '../../utils/channel';
import { presenceLabel } from '../../utils/telegramStatus';

// Раскладка списка диалогов — сетка из узких колонок: одно значение в ячейке и
// в одну линию, только у собеседника под именем вторая короткая. Её делят
// таблица и заглушка первой загрузки: одни и те же видимые колонки и высота
// ячейки, поэтому появление данных ничего не сдвигает.
//
// Ширины (px) заданы у всех колонок, кроме «Что дальше» — она забирает остаток.
// «Регион» по умолчанию виден с 1536px. Какие колонки показывать, пользователь
// выбирает сам — «Настроить поля» в заголовке колонки действий; собеседника и
// действия скрыть нельзя. «Менеджер» и «Регион» (adminOnly) есть только у
// админа: менеджеру они всегда одинаковые и лишь занимают место.
//
// В заголовке рядом с названием стоит воронка фильтра (24px), поэтому ширина
// колонки — это ещё и «название + стрелка сортировки + воронка»: «Последнее» —
// 136px, «Регион» — 92px. «Действия» — 88px: 12 + две кнопки по 32 + 12.
export const COLUMNS = [
  { key: 'who', label: 'Собеседник', sort: 'name', width: 184, required: true, bars: ['w-24', 'w-28'] },
  { key: 'contact', label: 'Контакт', width: 140, bars: ['w-24'] },
  { key: 'channel', label: 'Соцсеть', width: 104, bars: ['w-8'] },
  { key: 'type', label: 'Тип', width: 112, bars: ['w-14'] },
  { key: 'stage', label: 'Стадия', sort: 'status', width: 160, bars: ['w-28'] },
  { key: 'deal', label: 'Этап', width: 136, bars: ['w-20'] },
  { key: 'lead', label: 'Ведёт', width: 112, bars: ['w-14'] },
  { key: 'next', label: 'Что дальше', bars: ['w-24'] },
  // Дополнительные — по умолчанию скрыты, включаются в «Настроить поля»: показанные сразу,
  // они на 1920px сжимали «Что дальше» почти до нуля.
  { key: 'unread', label: 'Непрочитанные', sort: 'unread', width: 148, show: false, bars: ['w-6'] },
  { key: 'online', label: 'В сети', width: 144, show: false, bars: ['w-20'] },
  { key: 'age', label: 'Возраст', sort: 'age', width: 108, show: false, bars: ['w-8'] },
  { key: 'city', label: 'Город', width: 136, show: false, bars: ['w-20'] },
  { key: 'persona', label: 'Личность', width: 120, show: false, bars: ['w-16'] },
  { key: 'manager', label: 'Менеджер', width: 108, adminOnly: true, bars: ['w-20'] },
  { key: 'region', label: 'Регион', width: 92, show: 'wide', adminOnly: true, bars: ['w-8'] },
  { key: 'account', label: 'Аккаунт', width: 120, bars: ['w-20'] },
  { key: 'last', label: 'Последнее', sort: 'time', width: 136, bars: ['w-20'] },
  { key: 'actions', label: 'Действия', width: 88, required: true, quiet: true, bars: [] },
];
// Описание колонок для всех, кроме админа. Отбирается один раз: дальше им
// пользуются и настройка полей, и фильтры, и заглушка.
const COMMON_COLUMNS = COLUMNS.filter((col) => !col.adminOnly);

// То же, что брейкпоинт 2xl.
const WIDE_QUERY = '(min-width: 96rem)';
// Меньше этого «Что дальше» не сжимается — дальше таблица прокручивается.
const FLEX_MIN_WIDTH = 112;

/** Все колонки, доступные вошедшему пользователю (видимые и скрытые им). */
export function useDialogColumnList() {
  return useIsAdmin() ? COLUMNS : COMMON_COLUMNS;
}

/** Видимые колонки списка диалогов — общие для таблицы и её заглушки. */
export function useDialogColumns() {
  const admin = useIsAdmin();
  const prefs = useColumnPrefs('dialogs', admin ? COLUMNS : COMMON_COLUMNS, { wide: WIDE_QUERY });
  return { ...prefs, admin, minWidth: tableMinWidth(prefs.columns, FLEX_MIN_WIDTH) };
}

export const HEAD_CELL = 'h-9 px-3 text-xs font-medium text-muted-foreground';
// Высота строки задана ячейкой: 52px вмещают аватар, селект этапа и две линии.
export const CELL = 'h-[52px] px-3 py-0 align-middle';
export const LINE_1 = 'flex h-5 min-w-0 items-center gap-2 text-sm';
export const LINE_2 = 'flex h-4 min-w-0 items-center gap-1.5 text-xs text-muted-foreground';

// ── Значения ячеек, по которым и рисуют, и фильтруют ────────────────────────

/** Клиент написал в чат на ручном режиме — ждёт ответа менеджера. */
export const waitsForManager = (row) => Boolean(row.is_paused) && (row.unread_count ?? 0) > 0;

export const WAITS_TEXT = 'клиент ждёт ответа';

/** Отправляющий аккаунт так, как он подписан в колонке «Аккаунт». */
export function accountLabel(row) {
  if (row.account_username) return `@${row.account_username}`;
  return row.account_id ? `Аккаунт #${row.account_id}` : 'Аккаунт удалён';
}

/** Тип диалога: холодка, обычный лид (хот) или человек написал сам. */
export const LEAD_TYPES = [
  { value: 'cold', label: 'Холодка' },
  { value: 'hot', label: 'Хот' },
  { value: 'inbound', label: 'Входящий' },
];
export const leadTypeLabel = (type) => LEAD_TYPES.find((t) => t.value === type)?.label ?? '';

/** Соцсеть строки так, как она подписана в колонке. */
export const channelOf = (row) => channelBadge(row.channel).label;

/** «В сети» строки: вид присутствия (в сети, недавно, давно…) для фильтра. */
const PRESENCE_GROUPS = {
  online: 'в сети',
  offline: 'был(а) в сети',
  recently: 'недавно',
  last_week: 'на этой неделе',
  last_month: 'в этом месяце',
  hidden: 'время скрыто',
};
const presenceOf = (row) => row.client_presence?.kind || '';
export const presenceText = (row) => presenceLabel(row.client_presence)?.text ?? '';

/** Текст ячейки «Что дальше». */
export function nextText(row) {
  if (waitsForManager(row)) return WAITS_TEXT;
  return nextActionLabel(row.next_bot_action, undefined, { short: true })?.text ?? '';
}

// ── Фильтры колонок ─────────────────────────────────────────────────────────

const picked = (value) => (Array.isArray(value) ? value.map(String) : []);

// Выбранный вариант не пропадает из списка, даже если строк с ним не осталось.
function keepPicked(options, value, emptyLabel) {
  const have = new Set(options.map((o) => String(o.value)));
  const lost = picked(value).filter((v) => !have.has(v));
  if (!lost.length) return options;
  return [...options, ...lost.map((v) => ({ value: v, label: v === '' ? emptyLabel : v, count: 0 }))];
}

// Стадии — те, что есть в строках, в порядке воронки. seen помнит название и
// место стадии, чтобы выбранная стадия осталась подписанной, когда её строки ушли.
function stageOptions(rows, value, seen) {
  const counts = new Map();
  for (const row of rows) {
    const st = row.stage;
    if (!st?.id) continue;
    const id = String(st.id);
    seen.set(id, { label: st.title, index: st.index });
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...new Set([...counts.keys(), ...picked(value)])]
    .map((id) => {
      const known = seen.get(id);
      return {
        value: id,
        label: known?.label ?? id,
        color: known ? stageColors(known.index).color : undefined,
        count: counts.get(id) || 0,
        order: known?.index ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.order - b.order);
}

function dealOptions(rows) {
  const counts = new Map();
  for (const row of rows) {
    const id = row.deal_stage || '';
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...DEAL_STAGES.map((st) => ({ value: st.id, label: st.label })), { value: '', label: 'не указан' }].map(
    (option) => ({ ...option, count: counts.get(option.value) || 0 }),
  );
}

// Строка, где клиент ждёт ответа, подходит и под «Менеджер», и под «Клиент ждёт ответа».
function leadOf(row) {
  if (!row.is_paused) return ['bot'];
  return waitsForManager(row) ? ['manager', 'waits'] : ['manager'];
}

function leadOptions(rows) {
  const counts = { bot: 0, manager: 0, waits: 0 };
  for (const row of rows) {
    for (const key of leadOf(row)) counts[key] += 1;
  }
  return [
    { value: 'bot', label: 'Бот', count: counts.bot },
    { value: 'manager', label: 'Менеджер', count: counts.manager },
    { value: 'waits', label: 'Клиент ждёт ответа', count: counts.waits },
  ];
}

const managerOf = (row) => row.manager_username || '';
const regionOf = (row) => row.region_code || '';

// Фильтр колонки: (все строки списка, текущее значение, память стадий) -> def.
const FILTERS = {
  who: () => ({ type: 'text', placeholder: 'Имя, город или возраст', get: (row) => [row.name, row.city, row.age] }),
  contact: () => ({
    type: 'text',
    placeholder: 'Ник, телефон или ID',
    get: (row) => [row.client_username && `@${row.client_username}`, row.phone, `ID ${row.chat_id}`],
  }),
  stage: (rows, value, seen) => ({
    type: 'options',
    get: (row) => row.stage?.id ?? '',
    options: stageOptions(rows, value, seen),
  }),
  deal: (rows) => ({ type: 'options', get: (row) => row.deal_stage || '', options: dealOptions(rows) }),
  lead: (rows) => ({ type: 'options', get: leadOf, options: leadOptions(rows) }),
  next: () => ({ type: 'text', get: nextText }),
  manager: (rows, value) => ({
    type: 'options',
    get: managerOf,
    options: keepPicked(optionsFrom(rows, managerOf, { empty: 'не назначен' }), value, 'не назначен'),
  }),
  region: (rows, value) => ({
    type: 'options',
    get: regionOf,
    options: keepPicked(optionsFrom(rows, regionOf, { empty: 'не задан' }), value, 'не задан'),
  }),
  account: (rows, value) => ({
    type: 'options',
    get: accountLabel,
    options: keepPicked(optionsFrom(rows, accountLabel), value),
  }),
  last: () => ({ type: 'period', get: (row) => row.last_message_ts }),
  channel: (rows, value) => ({
    type: 'options',
    get: channelOf,
    options: keepPicked(optionsFrom(rows, channelOf), value),
  }),
  type: (rows) => {
    const counts = new Map();
    for (const row of rows) counts.set(row.lead_type, (counts.get(row.lead_type) || 0) + 1);
    return {
      type: 'options',
      get: (row) => row.lead_type || '',
      options: LEAD_TYPES.map((t) => ({ ...t, count: counts.get(t.value) || 0 })),
    };
  },
  unread: (rows) => {
    const has = rows.filter((row) => (row.unread_count ?? 0) > 0).length;
    return {
      type: 'options',
      get: (row) => ((row.unread_count ?? 0) > 0 ? 'yes' : 'no'),
      options: [
        { value: 'yes', label: 'Есть непрочитанные', count: has },
        { value: 'no', label: 'Всё прочитано', count: rows.length - has },
      ],
    };
  },
  online: (rows, value) => ({
    type: 'options',
    get: presenceOf,
    options: keepPicked(
      Object.entries(PRESENCE_GROUPS).map(([kind, label]) => ({
        value: kind,
        label,
        count: rows.filter((row) => presenceOf(row) === kind).length,
      })).filter((o) => o.count > 0),
      value,
    ),
  }),
  age: () => ({ type: 'text', placeholder: 'Например, 34', get: (row) => [row.age] }),
  city: () => ({ type: 'text', placeholder: 'Город', get: (row) => [row.city] }),
  persona: (rows, value) => ({
    type: 'options',
    get: (row) => row.persona_name || '',
    options: keepPicked(optionsFrom(rows, (row) => row.persona_name || '', { empty: 'не указана' }), value, 'не указана'),
  }),
};

/**
 * Фильтры колонок списка диалогов: { ключ колонки: def }. Одни и те же объекты
 * читают заголовок таблицы, плашки и applyFilters.
 *   rows    — ВСЕ строки списка (не отобранные): варианты не прыгают при отборе;
 *   state   — значения фильтров;
 *   columns — колонки, доступные пользователю (useDialogColumnList), включая скрытые;
 *   seen    — Map, живущий вместе со списком: названия уже встречавшихся стадий.
 */
export function dialogFilterDefs(rows, state, columns, seen = new Map()) {
  const defs = {};
  for (const col of columns) {
    const make = FILTERS[col.key];
    if (make) defs[col.key] = make(rows ?? [], state?.[col.key], seen);
  }
  return defs;
}
