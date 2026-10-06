import { cn } from '@/lib/utils';

/**
 * Общие наборы классов для таблиц страниц. Подключаются через className
 * у <Table>, чтобы каждая страница не собирала свои селекторы заново.
 *   stickyLastCol — последняя колонка (действия) прилипает к правому краю
 *                   при горизонтальной прокрутке;
 *   denseTable    — плотные ячейки для таблиц с большим числом строк.
 */
const stickyLastCol =
  '[&_th:last-child]:sticky [&_th:last-child]:right-0 [&_th:last-child]:bg-card [&_td:last-child]:sticky [&_td:last-child]:right-0 [&_td:last-child]:bg-card';
const denseTable = '[&_td]:p-2 [&_th]:h-9 text-xs';

function Table({ className, ...props }) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

function TableBody({ className, ...props }) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('bg-muted/30 border-t font-semibold [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'text-muted-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }) {
  return (
    <td
      data-slot="table-cell"
      className={cn('p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  stickyLastCol,
  denseTable,
};
