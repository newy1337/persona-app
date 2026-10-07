import { tableMinWidth, useColumnPrefs } from '../ColumnPicker/columnPrefs';

// Раскладка списка диалогов — сетка из узких колонок: одно значение в ячейке и
// в одну линию, только у собеседника под именем вторая короткая. Её делят
// таблица и заглушка первой загрузки: одни и те же видимые колонки и высота
// ячейки, поэтому появление данных ничего не сдвигает.
//
// Ширины (px) заданы у всех колонок, кроме «Что дальше» — она забирает остаток.
// «Регион» по умолчанию виден с 1536px: на экранах уже он остаётся в подсказке
// колонки «Менеджер». Какие колонки показывать, пользователь выбирает сам —
// «Настроить поля» в заголовке колонки действий; собеседника и действия скрыть
// нельзя.
//
// «Последнее» — 116px: 92px под «06.10, 22:15» (Inter 14px, моноширинные
// цифры — около 87px). «Действия» — 88px: 12 + две кнопки по 32 + 12.
export const COLUMNS = [
  { key: 'who', label: 'Собеседник', sort: 'name', width: 184, required: true, bars: ['w-24', 'w-28'] },
  { key: 'contact', label: 'Контакт', width: 140, bars: ['w-24'] },
  { key: 'stage', label: 'Стадия', sort: 'status', width: 160, bars: ['w-28'] },
  { key: 'deal', label: 'Этап', width: 136, bars: ['w-20'] },
  { key: 'lead', label: 'Ведёт', width: 112, bars: ['w-14'] },
  { key: 'next', label: 'Что дальше', bars: ['w-24'] },
  { key: 'manager', label: 'Менеджер', width: 108, bars: ['w-20'] },
  { key: 'region', label: 'Регион', width: 72, show: 'wide', bars: ['w-8'] },
  { key: 'account', label: 'Аккаунт', width: 120, bars: ['w-20'] },
  { key: 'last', label: 'Последнее', sort: 'time', width: 116, bars: ['w-20'] },
  { key: 'actions', label: 'Действия', width: 88, required: true, quiet: true, bars: [] },
];

// То же, что брейкпоинт 2xl.
const WIDE_QUERY = '(min-width: 96rem)';
// Меньше этого «Что дальше» не сжимается — дальше таблица прокручивается.
const FLEX_MIN_WIDTH = 112;

/** Видимые колонки списка диалогов — общие для таблицы и её заглушки. */
export function useDialogColumns() {
  const prefs = useColumnPrefs('dialogs', COLUMNS, { wide: WIDE_QUERY });
  return { ...prefs, minWidth: tableMinWidth(prefs.columns, FLEX_MIN_WIDTH) };
}

export const HEAD_CELL = 'h-9 px-3 text-xs font-medium text-muted-foreground';
// Высота строки задана ячейкой: 52px вмещают аватар, селект этапа и две линии.
export const CELL = 'h-[52px] px-3 py-0 align-middle';
export const LINE_1 = 'flex h-5 min-w-0 items-center gap-2 text-sm';
export const LINE_2 = 'flex h-4 min-w-0 items-center gap-1.5 text-xs text-muted-foreground';
