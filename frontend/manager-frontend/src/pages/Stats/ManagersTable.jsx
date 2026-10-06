import { useMemo, useState } from 'react';
import { ArrowDown, ChevronDown, ChevronRight } from 'lucide-react';
import { CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { DEAL_STAGES } from '../../data/dealStages';
import { EDGE, NUM, Section, SkeletonRows, TD, TH, kilo, money, num, pct, shortDay } from './StatsUi';

const tokensOf = (t) => (t ? t.input + t.cache_read + t.cache_write : 0);

const COLUMNS = [
  { id: 'cost_usd', title: 'Расход', hint: 'Деньги за вызовы моделей' },
  { id: 'calls', title: 'Вызовов', hint: 'Обращений к модели' },
  { id: 'leads_uploaded', title: 'Номеров', hint: 'Загружено номеров и ников за период' },
  { id: 'leads_valid', title: 'Валидных', hint: 'Из загруженных нашлись в Telegram' },
  { id: 'leads_replied', title: 'Ответили', hint: 'Из загруженных ответили на первое сообщение' },
  { id: 'active_chats', title: 'Переписок', hint: 'Диалоги, где собеседник писал в этот период' },
  { id: 'messages_out', title: 'Сообщений', hint: 'Исходящие и входящие' },
  { id: 'stages_total', title: 'Этапы', hint: 'Сколько чатов менеджера перешло в этап за период' },
];

const Muted = ({ children }) => <span className="text-muted-foreground">{children}</span>;
const Dash = () => <Muted>—</Muted>;

const stagesTotal = (st) => DEAL_STAGES.reduce((n, s) => n + (st?.[s.id] ?? 0), 0);
function StagesCell({ stages }) {
  const parts = DEAL_STAGES.filter((s) => stages?.[s.id]).map((s) => `${s.label.toLowerCase()} ${stages[s.id]}`);
  const title = DEAL_STAGES.map((s) => `${s.label}: ${stages?.[s.id] ?? 0}`).join('\n');
  return (
    <TableCell className={cn(TD, NUM)} title={title} data-testid="stages-cell">
      {parts.length ? parts.join(' · ') : <Dash />}
    </TableCell>
  );
}

function Cells({ row, share }) {
  const c = cn(TD, NUM);
  return (
    <>
      <TableCell className={c}>
        {money(row.cost_usd)}
        {share !== null && <Muted> · {pct(share)}</Muted>}
      </TableCell>
      <TableCell className={c}>
        {num(row.calls)}
        <Muted> · {kilo(tokensOf(row.tokens))}</Muted>
      </TableCell>
      <TableCell className={c}>{row.leads_uploaded ? num(row.leads_uploaded) : <Dash />}</TableCell>
      <TableCell className={c}>
        {row.leads_uploaded ? (
          <>
            {num(row.leads_valid)}
            <Muted> · {pct(row.leads_valid / row.leads_uploaded)}</Muted>
          </>
        ) : (
          <Dash />
        )}
      </TableCell>
      <TableCell className={c}>
        {row.leads_valid ? (
          <>
            {num(row.leads_replied)}
            <Muted> · {pct(row.leads_replied / row.leads_valid)}</Muted>
          </>
        ) : (
          <Dash />
        )}
      </TableCell>
      <TableCell className={c}>{num(row.active_chats)}</TableCell>
      <TableCell className={c}>
        {num(row.messages_out)} ↑<Muted> / {num(row.messages_in)} ↓</Muted>
        {row.manual_share > 0 && <Muted> · руками {pct(row.manual_share)}</Muted>}
      </TableCell>
      <StagesCell stages={row.stages} />
    </>
  );
}

const TITLE = 'По менеджерам';

const DESCRIPTION = (
  <CardDescription className="text-xs">
    Нажмите на строку — раскроются дни. Заголовок столбца сортирует таблицу.
  </CardDescription>
);

function Head({ sort, onSort }) {
  return (
    <TableHeader>
      <TableRow>
        <TableHead className={TH}>Менеджер</TableHead>
        {COLUMNS.map((c) => (
          <TableHead
            key={c.id}
            title={c.hint}
            aria-sort={sort === c.id ? 'descending' : 'none'}
            className={cn(TH, 'cursor-pointer select-none text-right hover:text-foreground', sort === c.id && 'text-foreground')}
            onClick={onSort && (() => onSort(c.id))}
          >
            {c.title}
            <span className="ml-1 inline-flex w-3.5 justify-center align-[-2px]" aria-hidden="true">
              {sort === c.id && <ArrowDown className="size-3.5" />}
            </span>
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

// Первая загрузка: та же карточка, описание и шапка, что у готовой таблицы, —
// отличаются только строки тела.
export function ManagersTableSkeleton({ label, ...props }) {
  return (
    <Section title={TITLE} flush description={DESCRIPTION} aria-busy="true" {...props}>
      <span className="sr-only">{label}</span>
      <Table className={EDGE}>
        <Head sort="cost_usd" />
        <TableBody>
          <SkeletonRows rows={6} cols={COLUMNS.length + 1} />
        </TableBody>
      </Table>
    </Section>
  );
}

export default function ManagersTable({ rows }) {
  const [open, setOpen] = useState(() => new Set());
  const [sort, setSort] = useState('cost_usd');

  const metric = (r, key) => (key === 'stages_total' ? stagesTotal(r.stages) : r[key] ?? 0);
  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => metric(b, sort) - metric(a, sort)), [rows, sort]);
  const total = useMemo(
    () =>
      (rows ?? []).reduce(
        (acc, r) => {
          for (const key of ['cost_usd', 'calls', 'leads_uploaded', 'leads_valid', 'leads_replied', 'active_chats', 'messages_in', 'messages_out']) {
            acc[key] += r[key] ?? 0;
          }
          for (const key of ['input', 'output', 'cache_read', 'cache_write']) acc.tokens[key] += r.tokens?.[key] ?? 0;
          for (const st of DEAL_STAGES) acc.stages[st.id] += r.stages?.[st.id] ?? 0;
          return acc;
        },
        {
          cost_usd: 0, calls: 0, leads_uploaded: 0, leads_valid: 0, leads_replied: 0,
          active_chats: 0, messages_in: 0, messages_out: 0, manual_share: 0,
          tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
          stages: Object.fromEntries(DEAL_STAGES.map((st) => [st.id, 0])),
        },
      ),
    [rows],
  );

  const toggle = (id) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onRowKey = (e, id) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    toggle(id);
  };

  if (!rows?.length) {
    return (
      <Section title={TITLE}>
        <p className="text-sm text-muted-foreground">За период работы не было</p>
      </Section>
    );
  }

  return (
    <Section title={TITLE} flush description={DESCRIPTION}>
      <Table className={EDGE}>
        <Head sort={sort} onSort={setSort} />
        <TableBody>
          {sorted.map((r) => {
            const id = r.manager_id ?? 'none';
            const shown = open.has(id);
            return [
              <TableRow
                key={id}
                className="cursor-pointer"
                tabIndex={0}
                aria-expanded={shown}
                onClick={() => toggle(id)}
                onKeyDown={(e) => onRowKey(e, id)}
                data-testid={`manager-row-${id}`}
              >
                <TableCell className={cn(TD, 'whitespace-nowrap')}>
                  <span className="mr-1.5 inline-flex w-3.5 justify-center align-[-2px] text-muted-foreground" aria-hidden="true">
                    {shown ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  </span>
                  {r.username}
                </TableCell>
                <Cells row={r} share={total.cost_usd ? r.cost_usd / total.cost_usd : null} />
              </TableRow>,
              ...(shown
                ? r.days.map((d) => (
                    <TableRow key={`${id}-${d.day}`} className="bg-muted/30 text-xs" data-testid={`manager-day-${id}-${d.day}`}>
                      <TableCell className={cn(TD, 'pl-8 text-muted-foreground tabular-nums whitespace-nowrap')}>{shortDay(d.day)}</TableCell>
                      <Cells row={d} share={r.cost_usd ? d.cost_usd / r.cost_usd : null} />
                    </TableRow>
                  ))
                : []),
              shown && !r.days.length && (
                <TableRow key={`${id}-empty`} className="bg-muted/30 text-xs" data-testid={`manager-day-${id}-none`}>
                  <TableCell className={cn(TD, 'pl-8 text-muted-foreground tabular-nums')}>—</TableCell>
                  <TableCell colSpan={COLUMNS.length} className={cn(TD, 'text-muted-foreground')}>Дней с работой нет</TableCell>
                </TableRow>
              ),
            ];
          })}
          <TableRow className="border-t bg-muted/30 font-semibold hover:bg-muted/30">
            <TableCell className={TD}>Итого</TableCell>
            <Cells row={total} share={null} />
          </TableRow>
        </TableBody>
      </Table>
    </Section>
  );
}
