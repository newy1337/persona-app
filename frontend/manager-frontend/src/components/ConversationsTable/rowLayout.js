// Раскладка строки списка диалогов. Её делят таблица и заглушка первой
// загрузки: одни и те же колонки, отступы и две строки в ячейке — высота
// заглушки совпадает с настоящей строкой по построению, без подбора чисел.
export const COLUMNS = [
  { label: 'Собеседник', sort: 'name', width: '28%' },
  { label: 'Стадия и режим', sort: 'status', width: '34%' },
  { label: 'Менеджер · аккаунт', sort: null, width: undefined },
  { label: 'Последнее', sort: 'time', width: '96px' },
  { label: 'Действия', sort: null, width: '88px', quiet: true },
];

export const TABLE_MIN_WIDTH = 'min-w-[880px]';
export const HEAD_CELL = 'h-9 px-3 text-xs font-medium text-muted-foreground';
export const CELL = 'px-3 py-2 align-middle';
// Первая строка ячейки — высотой с селект этапа (28px), вторая — 20px.
export const LINE_1 = 'flex h-7 min-w-0 items-center gap-2 text-sm';
export const LINE_2 = 'flex h-5 min-w-0 items-center gap-1.5 text-xs text-muted-foreground';
