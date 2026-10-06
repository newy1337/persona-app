// Раскладка списка диалогов — сетка из узких колонок: одно значение в ячейке,
// у собеседника и времени — две короткие линии. Её делят таблица и заглушка
// первой загрузки: одни и те же колонки и высота ячейки, поэтому появление
// данных ничего не сдвигает.
//
// Ширины заданы у всех колонок, кроме «Что дальше» — она забирает остаток.
// «Регион» виден с 1536px (WIDE_ONLY): на экранах уже он уходит в подсказку
// колонки «Менеджер».
export const COLUMNS = [
  { key: 'who', label: 'Собеседник', sort: 'name', width: '184px', bars: ['w-24', 'w-28'] },
  { key: 'contact', label: 'Контакт', width: '148px', bars: ['w-24'] },
  { key: 'stage', label: 'Стадия', sort: 'status', width: '164px', bars: ['w-28'] },
  { key: 'deal', label: 'Этап', width: '148px', bars: ['w-20'] },
  { key: 'lead', label: 'Ведёт', width: '112px', bars: ['w-14'] },
  { key: 'next', label: 'Что дальше', bars: ['w-40'] },
  { key: 'manager', label: 'Менеджер', width: '108px', bars: ['w-20'] },
  { key: 'region', label: 'Регион', width: '72px', wide: true, bars: ['w-8'] },
  { key: 'account', label: 'Аккаунт', width: '120px', bars: ['w-20'] },
  { key: 'last', label: 'Последнее', sort: 'time', width: '80px', bars: ['w-10', 'w-14'] },
  { key: 'actions', label: 'Действия', width: '68px', quiet: true, bars: [] },
];

export const WIDE_ONLY = 'max-2xl:hidden';
export const TABLE_MIN_WIDTH = 'min-w-[1252px]';
export const HEAD_CELL = 'h-9 px-3 text-xs font-medium text-muted-foreground';
// Высота строки задана ячейкой: 52px вмещают аватар, селект этапа и две линии.
export const CELL = 'h-[52px] px-3 py-0 align-middle';
export const LINE_1 = 'flex h-5 min-w-0 items-center gap-2 text-sm';
export const LINE_2 = 'flex h-4 min-w-0 items-center gap-1.5 text-xs text-muted-foreground';
