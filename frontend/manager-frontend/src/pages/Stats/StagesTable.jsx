import { CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { EDGE, NUM, Section, TD, TH, num, shortDay } from './StatsUi';

export default function StagesTable({ data }) {
  const { stages, days, totals, reached } = data;
  return (
    <Section
      title="Этапы сделки по дням"
      flush
      description={
        <CardDescription className="text-xs">
          Чат засчитывается в этап один раз — в день, когда впервые до него дошёл; пройденные
          этапы остаются, откат назад ничего не снимает. Архив отдельно: по дням — сколько чатов
          отправили в архив, «всего» — сколько чатов в архиве сейчас.
        </CardDescription>
      }
    >
      <Table className={EDGE} aria-label="Этапы сделки по дням" data-testid="stages-table">
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className={TH}>День</TableHead>
            {stages.map((st) => (
              <TableHead key={st.id} scope="col" className={cn(TH, 'text-right')}>{st.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {days.length === 0 && (
            <TableRow>
              <TableCell colSpan={stages.length + 1} className={cn(TD, 'text-muted-foreground')}>
                За период этапы не менялись
              </TableCell>
            </TableRow>
          )}
          {days.map((d) => (
            <TableRow key={d.day}>
              <TableCell className={cn(TD, 'text-muted-foreground tabular-nums')}>{shortDay(d.day)}</TableCell>
              {stages.map((st) => (
                <TableCell key={st.id} className={cn(TD, NUM)}>
                  {d.counts[st.id] ? num(d.counts[st.id]) : <span className="text-muted-foreground">—</span>}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className={TD}>За период</TableCell>
            {stages.map((st) => (
              <TableCell key={st.id} className={cn(TD, NUM)}>{num(totals[st.id])}</TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell className={TD}>Всего</TableCell>
            {stages.map((st) => (
              <TableCell key={st.id} className={cn(TD, NUM)}>{num(reached[st.id])}</TableCell>
            ))}
          </TableRow>
        </TableFooter>
      </Table>
    </Section>
  );
}
