import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { channelBadge } from '../../utils/channel';
import { EDGE, NUM, Section, TD, TH, money, num } from './StatsUi';

// Вкладки статистики «про результат» (ответ GET /api/stats/insights):
// «Воронка» — шаги когорты лидов, стоимость результата и разрезы;
// «Аккаунты» — работа каждого аккаунта за период; «Активность» — когда пишут
// клиенты и как быстро мы отвечаем. Когорта — лиды, которым впервые написали
// в выбранный период; шаги засчитываются за всё время.

const share = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

// ── Воронка ─────────────────────────────────────────────────────────────────

function FunnelBars({ steps, funnel }) {
  const top = funnel.written || 1;
  return (
    <div className="flex flex-col gap-2.5" data-testid="funnel">
      {steps.map((s, i) => {
        const n = funnel[s.id] ?? 0;
        const prev = i > 0 ? funnel[steps[i - 1].id] ?? 0 : null;
        return (
          <div key={s.id} className="grid grid-cols-[96px_1fr_auto] items-center gap-3 text-sm" data-step={s.id}>
            <span className="text-muted-foreground">{s.label}</span>
            <div className="h-7 overflow-hidden rounded-md bg-muted/60">
              <div
                className="flex h-full items-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground tabular-nums transition-[width] duration-500"
                style={{ width: `${Math.max((n / top) * 100, n > 0 ? 3 : 0)}%` }}
              >
                {n > 0 && num(n)}
              </div>
            </div>
            <span className="w-28 text-right text-xs text-muted-foreground tabular-nums" title={prev === null ? undefined : 'от предыдущего шага · от написанных'}>
              {prev === null ? `${num(n)} лидов` : `${share(n, prev)} · ${share(n, funnel.written)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CostTiles({ steps, cost }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-6" data-testid="cost-tiles">
      <div className="flex flex-col gap-0.5 bg-card px-4 py-3">
        <span className="text-xs text-muted-foreground">Деньги на когорту</span>
        <span className="text-lg font-semibold tabular-nums">{money(cost.total_usd)}</span>
      </div>
      {steps.map((s) => (
        <div key={s.id} className="flex flex-col gap-0.5 bg-card px-4 py-3">
          <span className="text-xs text-muted-foreground">{s.id === 'written' ? 'За написанного' : `За «${s.label.toLowerCase()}»`}</span>
          <span className="text-lg font-semibold tabular-nums">{cost.per_step[s.id] == null ? '—' : money(cost.per_step[s.id])}</span>
        </div>
      ))}
    </div>
  );
}

const SLICES = [
  ['persona', 'Личность'],
  ['manager', 'Менеджер'],
  ['source', 'Источник'],
  ['account', 'Аккаунт'],
  ['type', 'Холодка / хот'],
];

function SliceTable({ data }) {
  const [by, setBy] = useState('source');
  const rows = data.by[by] ?? [];
  return (
    <Section
      flush
      title="Разрезы воронки"
      description={
        <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Разрез" data-testid="slice-switch">
          {SLICES.map(([id, label]) => (
            <Button key={id} type="button" role="radio" aria-checked={by === id} variant={by === id ? 'secondary' : 'ghost'} size="xs" onClick={() => setBy(id)}>
              {label}
            </Button>
          ))}
        </div>
      }
    >
      <Table className={EDGE} data-testid="slice-table">
        <TableHeader>
          <TableRow>
            <TableHead className={TH}>{SLICES.find(([id]) => id === by)[1]}</TableHead>
            {data.steps.map((s) => (
              <TableHead key={s.id} className={cn(TH, 'text-right')}>{s.label}</TableHead>
            ))}
            <TableHead className={cn(TH, 'text-right')}>Расход</TableHead>
            <TableHead className={cn(TH, 'text-right')}>За депозит</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={data.steps.length + 3} className="h-20 text-center text-sm text-muted-foreground">За период лидам не писали</TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.key} data-key={r.key}>
              <TableCell className={cn(TD, 'font-medium')}>{r.label}</TableCell>
              {data.steps.map((s) => (
                <TableCell key={s.id} className={cn(TD, NUM)}>
                  {num(r[s.id])}
                  {s.id !== 'written' && <span className="ml-1.5 text-xs text-muted-foreground">{share(r[s.id], r.written)}</span>}
                </TableCell>
              ))}
              <TableCell className={cn(TD, NUM, 'text-muted-foreground')}>{money(r.cost_usd)}</TableCell>
              <TableCell className={cn(TD, NUM)}>{r.deposit > 0 ? money(r.cost_usd / r.deposit) : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

export function FunnelTab({ data }) {
  return (
    <>
      <Section
        title="Воронка лидов"
        description="Лиды, которым впервые написали в выбранный период. Шаги засчитываются за всё время; проценты — от предыдущего шага и от написанных."
      >
        <FunnelBars steps={data.steps} funnel={data.funnel} />
      </Section>
      <CostTiles steps={data.steps} cost={data.cost} />
      <SliceTable data={data} />
    </>
  );
}

// ── Аккаунты ────────────────────────────────────────────────────────────────

const LOST = { banned: 'бан', unauthorized: 'нет сессии' };

export function AccountsTab({ data }) {
  const rows = data.accounts ?? [];
  return (
    <Section
      flush
      title="Аккаунты за период"
      description="Сколько аккаунт написал и в скольких чатах ему ответили; лиды — из когорты периода. Красные — в бане или без сессии."
    >
      <Table className={EDGE} data-testid="accounts-insights">
        <TableHeader>
          <TableRow>
            <TableHead className={TH}>Аккаунт</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Сообщений</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Чатов</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Ответили</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Лидов</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Ответили лиды</TableHead>
            <TableHead className={cn(TH, 'text-right')}>Депозиты</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="h-20 text-center text-sm text-muted-foreground">За период аккаунты не писали</TableCell>
            </TableRow>
          )}
          {rows.map((a) => {
            const lost = LOST[a.status];
            const badge = channelBadge(a.channel);
            return (
              <TableRow
                key={a.id}
                data-account-id={a.id}
                data-problem={lost ? 'true' : undefined}
                className={cn(lost && 'bg-destructive/15 hover:bg-destructive/20 [&>td:first-child]:shadow-[inset_3px_0_0_var(--destructive)]')}
              >
                <TableCell className={TD}>
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{badge.label}</Badge>
                    <span className="font-medium">{a.label}</span>
                    {lost && <span className="text-xs font-medium text-destructive">{lost}</span>}
                  </span>
                </TableCell>
                <TableCell className={cn(TD, NUM)}>{`${num(a.messages_out)} ↑ / ${num(a.messages_in)} ↓`}</TableCell>
                <TableCell className={cn(TD, NUM)}>{num(a.chats)}</TableCell>
                <TableCell className={cn(TD, NUM)}>
                  {num(a.replied_chats)}
                  <span className="ml-1.5 text-xs text-muted-foreground">{a.reply_rate == null ? '—' : `${Math.round(a.reply_rate * 100)}%`}</span>
                </TableCell>
                <TableCell className={cn(TD, NUM)}>{num(a.leads_written)}</TableCell>
                <TableCell className={cn(TD, NUM)}>
                  {num(a.leads_replied)}
                  <span className="ml-1.5 text-xs text-muted-foreground">{share(a.leads_replied, a.leads_written)}</span>
                </TableCell>
                <TableCell className={cn(TD, NUM)}>{num(a.deposits)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Section>
  );
}

// ── Активность ──────────────────────────────────────────────────────────────

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** «45 с», «12 мин», «2 ч 15 мин», «3 дн». */
export function duration(s) {
  if (s == null) return '—';
  if (s < 60) return `${s} с`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`;
  return `${Math.round(h / 24)} дн`;
}

function Heatmap({ grid }) {
  const max = Math.max(1, ...grid.flat());
  const [hover, setHover] = useState(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-[28px_repeat(24,minmax(0,1fr))] gap-[3px]" data-testid="heatmap" onMouseLeave={() => setHover(null)}>
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center text-[10px] text-muted-foreground tabular-nums">{h % 3 === 0 ? h : ''}</span>
          ))}
          {grid.map((row, d) => (
            <div key={DAYS[d]} className="contents">
              <span className="flex items-center text-xs text-muted-foreground">{DAYS[d]}</span>
              {row.map((n, h) => (
                <span
                  key={h}
                  data-cell={`${d}-${h}`}
                  title={`${DAYS[d]}, ${h}:00–${h + 1}:00 — ${num(n)} сообщ.`}
                  onMouseEnter={() => setHover({ d, h, n })}
                  className={cn('h-6 rounded-[3px]', hover && hover.d === d && hover.h === h && 'ring-2 ring-foreground/60')}
                  // Одна шкала одного тона: светлее — меньше, насыщеннее — больше.
                  style={{ background: n ? `color-mix(in oklab, var(--primary) ${Math.round(15 + (n / max) * 85)}%, transparent)` : 'var(--muted)' }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-h-4 items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums" data-testid="heatmap-hover">
          {hover ? `${DAYS[hover.d]}, ${hover.h}:00–${hover.h + 1}:00 — ${num(hover.n)} сообщений` : 'Наведите на клетку — покажу число сообщений'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          меньше
          {[15, 40, 65, 100].map((p) => (
            <i key={p} className="size-3 rounded-[3px]" style={{ background: `color-mix(in oklab, var(--primary) ${p}%, transparent)` }} />
          ))}
          больше
        </span>
      </div>
    </div>
  );
}

function SpeedTile({ title, stat, hint }) {
  return (
    <div className="flex flex-col gap-0.5 bg-card px-4 py-3">
      <span className="text-xs text-muted-foreground">{title}</span>
      <span className="text-lg font-semibold tabular-nums">{duration(stat.median_s)}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {stat.n ? `медиана · у 9 из 10 быстрее ${duration(stat.p90_s)} · ${num(stat.n)} раз` : hint}
      </span>
    </div>
  );
}

export function ActivityTab({ data }) {
  const total = data.heatmap.flat().reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3" data-testid="speed">
        <SpeedTile title="Бот отвечает за" stat={data.speed.bot} hint="ответов бота не было" />
        <SpeedTile title="Менеджер отвечает за" stat={data.speed.manager} hint="менеджеры за период не отвечали" />
        <SpeedTile title="Лид впервые отвечает через" stat={data.speed.first_reply} hint="лиды ещё не отвечали" />
      </div>
      <Section title="Когда пишут клиенты" description={`Сообщения клиентов по дням недели и часам, время московское · всего ${num(total)}`}>
        <Heatmap grid={data.heatmap} />
      </Section>
    </>
  );
}

export function InsightsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only">Считаю срезы…</span>
      <Skeleton className="h-[220px] w-full rounded-lg" />
      <Skeleton className="h-[86px] w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
