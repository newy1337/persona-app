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
import { Skeleton } from '@/components/ui/skeleton';
import { DEAL_STAGES } from '../../data/dealStages';
import { EDGE, NUM, Section, SkeletonRows, TD, TH, num, shortDay } from './StatsUi';

const TITLE = 'Этапы сделки по дням';

const DESCRIPTION = (
  <p>
    Чат засчитывается в этап один раз — в день, когда впервые до него дошёл; пройденные
    этапы остаются, откат назад ничего не снимает. Архив отдельно: по дням — сколько чатов
    отправили в архив, «всего» — сколько чатов в архиве сейчас.
  </p>
);

function Head({ stages }) {
  return (
    <TableHeader>
      <TableRow>
        <TableHead scope="col" className={TH}>День</TableHead>
        {stages.map((st) => (
          <TableHead key={st.id} scope="col" className={cn(TH, 'text-right')}>{st.label}</TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

// Первая загрузка: та же карточка, описание, шапка и подвал, что у готовой таблицы;
// столбцы берём из справочника этапов, пока сервер не прислал свои.
export function StagesTableSkeleton({ label, ...props }) {
  return (
    <Section title={TITLE} flush description={DESCRIPTION} aria-busy="true" {...props}>
      <span className="sr-only">{label}</span>
      <Table className={EDGE}>
        <Head stages={DEAL_STAGES} />
        <TableBody>
          <SkeletonRows rows={5} cols={DEAL_STAGES.length + 1} />
        </TableBody>
        <TableFooter>
          {['За период', 'Всего'].map((name) => (
            <TableRow key={name}>
              <TableCell className={TD}>{name}</TableCell>
              {DEAL_STAGES.map((st) => (
                <TableCell key={st.id} className={TD}><Skeleton className="ml-auto h-5 w-8" /></TableCell>
              ))}
            </TableRow>
          ))}
        </TableFooter>
      </Table>
    </Section>
  );
}

export default function StagesTable({ data }) {
  const { stages, days, totals, reached } = data;
  return (
    <Section title={TITLE} flush description={DESCRIPTION}>
      <Table className={EDGE} aria-label="Этапы сделки по дням" data-testid="stages-table">
        <Head stages={stages} />
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
