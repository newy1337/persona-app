import { useId, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { money, num } from './StatsUi';

// График по дням — «Area Chart — Interactive» из ui.shadcn.com/charts: плавные
// области с градиентом, подсказка по наведению, переключатель в углу. Одна
// величина на одной оси: «Сообщения» — входящие и исходящие стопкой (одна
// единица), «Расход» и «Вызовы» — по одной области. Деньги и сообщения на
// одном графике (две шкалы) читались плохо — поэтому переключатель.
//
// Цвета прошли валидатор палитры (dataviz) на светлом и тёмном фоне: синий —
// входящие и единичные величины, бирюзовый — исходящие. Два оттенка синего в
// тёмной теме проверку не проходят.
const COLOR = { in: '#3b6fe0', out: '#26a69a' };

const METRICS = {
  messages: {
    label: 'Сообщения',
    describe: (t) => `Входящие и исходящие · всего ${num(t.in + t.out)}`,
    series: [
      { key: 'messages_out', name: 'Исходящие', color: COLOR.out },
      { key: 'messages_in', name: 'Входящие', color: COLOR.in },
    ],
  },
  cost: {
    label: 'Расход',
    describe: (t) => `Деньги на модели · всего ${money(t.cost)}`,
    series: [{ key: 'cost_usd', name: 'Расход', color: COLOR.in, money: true }],
  },
  calls: {
    label: 'Вызовы',
    describe: (t) => `Обращения к моделям · всего ${num(t.calls)}`,
    series: [{ key: 'calls', name: 'Вызовы', color: COLOR.in }],
  },
};

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const parts = (day) => {
  const [y, m, d] = String(day).split('-').map(Number);
  return { m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};
export const dayLabel = (day) => `${parts(day).d} ${MONTHS[parts(day).m - 1]}`;
const dayFull = (day) => `${WEEKDAYS[parts(day).wd]}, ${dayLabel(day)}`;

const HEIGHT = 'h-[260px]';

function Frame({ metric, onMetric, description, children, footer = null }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card" aria-label="По дням">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-sm font-medium">По дням</h2>
          <p className="min-h-4 truncate text-xs text-muted-foreground tabular-nums" data-testid="daily-summary">{description}</p>
        </div>
        <Select value={metric} onValueChange={onMetric} disabled={!onMetric}>
          <SelectTrigger className="w-[150px]" aria-label="Что показывать" data-testid="daily-metric">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {Object.entries(METRICS).map(([id, m]) => (
              <SelectItem key={id} value={id}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>
      <div className="px-2 pt-4 pb-2 sm:px-4">{children}</div>
      {footer}
    </section>
  );
}

export function DailyChartSkeleton() {
  return (
    <Frame metric="messages" description={null}>
      <Skeleton className={HEIGHT} />
    </Frame>
  );
}

function TooltipBox({ active, payload, label, series }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="min-w-40 rounded-md border bg-popover px-3 py-2 text-xs shadow-md" data-testid="daily-tooltip">
      <p className="mb-1 font-medium">{dayFull(label)}</p>
      {[...series].reverse().map((s) => (
        <p key={s.key} className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <i className="size-2 rounded-xs" style={{ background: s.color }} />
            {s.name}
          </span>
          <span className="font-medium tabular-nums">{s.money ? money(row[s.key]) : num(row[s.key])}</span>
        </p>
      ))}
      <p className="mt-1 border-t pt-1 text-muted-foreground tabular-nums">
        {`${money(row.cost_usd)} · ${num(row.calls)} вызовов`}
      </p>
    </div>
  );
}

export default function DailyChart({ days }) {
  const [metric, setMetric] = useState('messages');
  const uid = useId().replace(/:/g, '');
  const m = METRICS[metric];
  const totals = days.reduce(
    (t, d) => ({ in: t.in + d.messages_in, out: t.out + d.messages_out, cost: t.cost + d.cost_usd, calls: t.calls + d.calls }),
    { in: 0, out: 0, cost: 0, calls: 0 },
  );
  const empty = days.every((d) => m.series.every((s) => !d[s.key]));

  return (
    <Frame
      metric={metric}
      onMetric={setMetric}
      description={m.describe(totals)}
      footer={
        m.series.length > 1 && !empty ? (
          <div className="flex items-center justify-center gap-4 pb-3 text-xs" data-testid="daily-legend">
            {[...m.series].reverse().map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <i className="size-2 rounded-xs" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
        ) : null
      }
    >
      {empty ? (
        <p className={`${HEIGHT} flex items-center justify-center text-sm text-muted-foreground`}>
          {metric === 'messages' ? 'За период сообщений не было' : 'За период вызовов не было'}
        </p>
      ) : (
        <div className={HEIGHT} role="img" aria-label={`По дням: ${m.label}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={days} margin={{ left: 12, right: 12, top: 8, bottom: 0 }}>
              <defs>
                {m.series.map((s) => (
                  <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={s.color} stopOpacity={0.55} />
                    <stop offset="95%" stopColor={s.color} stopOpacity={0.04} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={dayLabel}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              />
              <Tooltip cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} content={<TooltipBox series={m.series} />} />
              {m.series.map((s) => (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  type="natural"
                  stackId="a"
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#${uid}-${s.key})`}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Frame>
  );
}
