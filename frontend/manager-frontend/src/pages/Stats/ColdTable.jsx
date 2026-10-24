import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EDGE, NUM, Section, TD, TH, num } from './StatsUi';

const share = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

const ROLE = { manager: 'менеджер', teamlead: 'тимлид', head: 'хед' };

// Та же полоса показателей, что на «Обзоре»: одна рамка, ячейки разделены линиями.
const KPI_STRIP =
  'grid auto-cols-[minmax(148px,1fr)] grid-flow-col divide-x overflow-x-auto rounded-lg border bg-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

function Kpi({ title, value, hint }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
      <span className="truncate text-xs text-muted-foreground">{title}</span>
      <span className="flex h-7 items-center text-lg font-semibold whitespace-nowrap tabular-nums">{value}</span>
      {hint && <span className="truncate text-xs text-muted-foreground" title={hint}>{hint}</span>}
    </div>
  );
}

const Muted = ({ children }) => <span className="text-muted-foreground">{children}</span>;

function Cells({ row }) {
  const c = cn(TD, NUM);
  return (
    <>
      <TableCell className={c}>{num(row.received)}</TableCell>
      <TableCell className={c}>
        {num(row.written)} <Muted>{share(row.written, row.received)}</Muted>
      </TableCell>
      <TableCell className={c}>
        {num(row.invalid ?? 0)} <Muted>{share(row.invalid ?? 0, row.received)}</Muted>
      </TableCell>
      <TableCell className={c}>
        {num(row.replied)} <Muted>{share(row.replied, row.written)}</Muted>
      </TableCell>
      <TableCell className={c}>
        {num(row.active)} <Muted>{share(row.active, row.replied)}</Muted>
      </TableCell>
    </>
  );
}

/** Вкладка «Холодка»: что стало с холодными лидами периода, итогом и по менеджерам. */
export default function ColdTable({ data }) {
  const { totals: t, by_manager: rows, active_after: after } = data;
  return (
    <div className="flex flex-col gap-4">
      <div className={KPI_STRIP} data-testid="cold-kpis">
        <Kpi title="Получено лидов" value={num(t.received)} hint="холодка за период" />
        <Kpi title="Написали" value={num(t.written)} hint={`${share(t.written, t.received)} от полученных`} />
        <Kpi title="Невалид" value={num(t.invalid ?? 0)} hint={`${share(t.invalid ?? 0, t.received)} — не найти в Telegram`} />
        <Kpi title="Ответили" value={num(t.replied)} hint={`${share(t.replied, t.written)} от написанных`} />
        <Kpi title="Активные диалоги" value={num(t.active)} hint={`${share(t.active, t.replied)} от ответивших`} />
      </div>
      <Section
        title="Холодка по менеджерам"
        flush
        description={
          <p>
            Считаются холодные лиды, пришедшие за период, — что с ними стало к этому моменту. «Ответили» — лид
            написал хотя бы одно сообщение после нашего первого, «активные» — больше {after} его сообщений.
            «Невалид» — написать невозможно: Telegram не нашёл человека по номеру и нику, аккаунт удалён или
            он принимает сообщения только от Premium.
          </p>
        }
      >
        <Table className={EDGE} aria-label="Холодка по менеджерам" data-testid="cold-table">
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className={TH}>Менеджер</TableHead>
              <TableHead scope="col" className={cn(TH, 'text-right')}>Получено</TableHead>
              <TableHead scope="col" className={cn(TH, 'text-right')}>Написали</TableHead>
              <TableHead scope="col" className={cn(TH, 'text-right')}>Невалид</TableHead>
              <TableHead scope="col" className={cn(TH, 'text-right')}>Ответили</TableHead>
              <TableHead scope="col" className={cn(TH, 'text-right')}>Активные</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className={cn(TD, 'text-center text-muted-foreground')}>
                  За период холодных лидов не было
                </TableCell>
              </TableRow>
            )}
            {rows.map((m) => (
              <TableRow key={m.user_id ?? 'none'}>
                <TableCell className={TD}>
                  {m.username}
                  {(m.role || m.region_code) && (
                    <Muted>
                      {' '}· {[ROLE[m.role] ?? m.role, m.region_code && `регион ${m.region_code}`].filter(Boolean).join(' · ')}
                    </Muted>
                  )}
                </TableCell>
                <Cells row={m} />
              </TableRow>
            ))}
          </TableBody>
          {rows.length > 1 && (
            <TableFooter>
              <TableRow className="font-semibold">
                <TableCell className={TD}>Всего</TableCell>
                <Cells row={t} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </Section>
    </div>
  );
}
