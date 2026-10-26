import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUsage, getManagerUsage, getBalance, getDealStages, getColdLeads, getInsights } from '../../api/usage';
import DailyChart, { DailyChartSkeleton } from './DailyChart';
import DateRangePicker, { mskToday, addDays } from '../../components/DateRangePicker/DateRangePicker';
import PricesEditor from './PricesEditor';
import ManagersTable, { ManagersTableSkeleton } from './ManagersTable';
import StagesTable, { StagesTableSkeleton } from './StagesTable';
import Balance, { BalanceSkeleton } from './Balance';
import ColdTable from './ColdTable';
import { AccountsTab, ActivityTab, FunnelTab, InsightsSkeleton } from './Insights';
import { getPersonas } from '../../api/personas';
import { ArrowUpRight, Tags } from 'lucide-react';
import { useRouteBusy } from '@/components/AppLayout/routeBusy';
import { IconAction } from '@/components/IconAction/IconAction';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  stickyLastCol,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Cell, Pie, PieChart, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { EDGE, NUM, Section, SkeletonRows, TD, TH, kilo, money, num, pct } from './StatsUi';

const STAGE_LABEL = {
  judge_plan: 'Судья: разбор',
  judge_review: 'Судья: проверка',
  judge: 'Судья',
  review: 'Проверка ответа',
  draft: 'Черновик ответа',
  generator: 'Ответ',
  media_photo: 'Просмотр фото',
  media_reaction: 'Реакция',
  transcribe: 'Расшифровка голосовых',
  time_location: 'Время и место',
  pain: 'Боли клиента',
};

const TABS = [
  ['overview', 'Обзор'],
  ['funnel', 'Воронка'],
  ['managers', 'По менеджерам'],
  ['teams', 'По командам'],
  ['accounts', 'Аккаунты'],
  ['activity', 'Активность'],
  ['stages', 'Этапы'],
  ['cold', 'Холодка'],
];
// Вкладки срезов «про результат» — один запрос на все три.
const INSIGHT_TABS = ['funnel', 'accounts', 'activity'];

const TEAMS_HINT =
  'Хед — вся цепочка: тимлиды, их менеджеры и прямые менеджеры. Тимлид — его менеджеры. Цифры руководителя включены в команду. Нажмите на строку — раскроются дни.';

// Первая загрузка «Холодки»: та же полоса показателей и рамка таблицы, без цифр.
function ColdSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only">Считаю холодку…</span>
      <Skeleton className="h-[86px] w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}

// Показатели — одна полоса в общей рамке, ячейки разделены линиями. Ячейка одна
// и на загрузку, и на данные: заглушки стоят внутри тех же строк (значение h-7,
// подпись min-h-4), поэтому высота полосы не меняется.
const KPI_STRIP =
  'grid auto-cols-[minmax(148px,1fr)] grid-flow-col divide-x overflow-x-auto rounded-lg border bg-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

function Kpi({ title, value, hint, loading = false }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
      <span className="truncate text-xs text-muted-foreground">{title}</span>
      <span className="flex h-7 items-center text-lg font-semibold whitespace-nowrap tabular-nums">
        {loading ? <Skeleton className="h-5 w-20 max-w-full" /> : value}
      </span>
      <span className="flex min-h-4 items-center truncate text-xs text-muted-foreground" title={loading ? undefined : hint ?? undefined}>
        {loading ? <Skeleton className="h-3 w-24 max-w-full" /> : <span className="truncate">{hint}</span>}
      </span>
    </div>
  );
}

/**
 * Расход списком полосок (BarList): строка на статью, название лежит на
 * полоске, длина — доля от самой дорогой статьи, справа сумма и доля от
 * всего. Один тон: сравниваются величины, а не категории.
 */
function BarList({ rows, empty, unit = 'вызовов' }) {
  const sorted = [...rows].sort((a, b) => b.cost_usd - a.cost_usd);
  const total = sorted.reduce((n, r) => n + r.cost_usd, 0);
  const max = sorted[0]?.cost_usd || 1;
  if (sorted.length === 0) return <p className="py-2 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5" data-testid="bar-list">
      {sorted.map((r, i) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto_3.5rem] items-center gap-3 text-sm" data-key={r.key}>
          <div className="relative flex h-8 min-w-0 items-center overflow-hidden rounded-md bg-muted/40">
            <span
              aria-hidden="true"
              className={cn('absolute inset-y-0 left-0 rounded-md transition-[width] duration-500', i === 0 ? 'bg-primary/35' : 'bg-primary/20')}
              style={{ width: `${Math.max((r.cost_usd / max) * 100, 2)}%` }}
            />
            <span className="relative truncate px-2.5" title={`${r.label} · ${num(r.calls)} ${unit}`}>
              {r.label}
              <span className="ml-2 text-xs text-muted-foreground tabular-nums">{num(r.calls)} {unit}</span>
            </span>
          </div>
          <span className="font-medium tabular-nums">{money(r.cost_usd)}</span>
          <span className="text-right text-xs text-muted-foreground tabular-nums">{total > 0 ? `${Math.round((r.cost_usd / total) * 100)}%` : '—'}</span>
        </li>
      ))}
    </ul>
  );
}

// Кольцо: доли одного целого, сумма в центре. Больше SERIES цветов не
// придумываем — хвост сворачивается в «Остальное» нейтральным тоном.
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
const OTHER = 'var(--muted-foreground)';

function foldRows(rows) {
  const sorted = [...rows].sort((a, b) => b.cost_usd - a.cost_usd);
  if (sorted.length <= SERIES.length) return sorted.map((r, i) => ({ ...r, color: SERIES[i] }));
  const head = sorted.slice(0, SERIES.length - 1).map((r, i) => ({ ...r, color: SERIES[i] }));
  const tail = sorted.slice(SERIES.length - 1);
  return [
    ...head,
    { key: '__other', label: 'Остальное', color: OTHER, cost_usd: tail.reduce((n, r) => n + r.cost_usd, 0), calls: tail.reduce((n, r) => n + r.calls, 0) },
  ];
}

function DonutTip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="flex items-center gap-1.5 font-medium"><i className="size-2 rounded-xs" style={{ background: r.color }} />{r.label}</p>
      <p className="mt-0.5 text-muted-foreground tabular-nums">{`${money(r.cost_usd)} · ${total > 0 ? Math.round((r.cost_usd / total) * 100) : 0}% · ${num(r.calls)} вызовов`}</p>
    </div>
  );
}

function Donut({ title, rows, empty }) {
  const data = foldRows(rows);
  const total = data.reduce((n, r) => n + r.cost_usd, 0);
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="donut">
      <h3 className="text-sm font-medium">{title}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative size-[180px] shrink-0" role="img" aria-label={`${title}: ${data.map((r) => `${r.label} ${money(r.cost_usd)}`).join(', ')}`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip content={<DonutTip total={total} />} />
                <Pie data={data} dataKey="cost_usd" nameKey="label" innerRadius={58} outerRadius={86} paddingAngle={2} cornerRadius={4} stroke="none" isAnimationActive>
                  {/* Цвет — через style: атрибут fill в SVG не понимает var(--…). */}
                  {data.map((r) => <Cell key={r.key} style={{ fill: r.color }} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-semibold tabular-nums">{money(total)}</span>
              <span className="text-xs text-muted-foreground">всего</span>
            </div>
          </div>
          <ul className="flex min-w-[180px] flex-1 flex-col gap-1.5 text-sm">
            {data.map((r) => (
              <li key={r.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto_2.75rem] items-center gap-2" data-key={r.key}>
                <i className="size-2.5 rounded-xs" style={{ background: r.color }} />
                <span className="truncate">{r.label}</span>
                <span className="font-medium tabular-nums">{money(r.cost_usd)}</span>
                <span className="text-right text-xs text-muted-foreground tabular-nums">{total > 0 ? `${Math.round((r.cost_usd / total) * 100)}%` : '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const SPEND_VIEW_KEY = 'stats_spend_view';
const readSpendView = () => {
  try {
    return localStorage.getItem(SPEND_VIEW_KEY) === 'chart' ? 'chart' : 'list';
  } catch {
    return 'list';
  }
};

/** «Куда уходят деньги»: список полосок или кольца — переключатель в шапке, выбор запоминается. */
function SpendSection({ data, personaNames }) {
  const [view, setViewState] = useState(readSpendView);
  const setView = (next) => {
    setViewState(next);
    try {
      localStorage.setItem(SPEND_VIEW_KEY, next);
    } catch {
      // приватное окно — выбор просто не запомнится
    }
  };
  const stages = data ? data.by_stage.map((r) => ({ key: r.stage, label: STAGE_LABEL[r.stage] ?? r.stage, cost_usd: r.cost_usd, calls: r.calls })) : [];
  const personas = data ? data.by_persona.map((r) => ({ key: r.persona_id, label: personaNames[r.persona_id] ?? r.persona_id, cost_usd: r.cost_usd, calls: r.calls })) : [];
  return (
    <Section
      title="Куда уходят деньги"
      description={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>На что тратятся вызовы моделей; доля — от всего расхода за период</span>
          <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Вид" data-testid="spend-view">
            {[['list', 'Список'], ['chart', 'Диаграмма']].map(([id, label]) => (
              <Button key={id} type="button" role="radio" aria-checked={view === id} variant={view === id ? 'secondary' : 'ghost'} size="xs" onClick={() => setView(id)}>
                {label}
              </Button>
            ))}
          </div>
        </div>
      }
      className="min-w-0"
    >
      {!data ? (
        <BarListSkeleton />
      ) : view === 'chart' ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Donut title="По статьям" rows={stages} empty="вызовов ещё не было" />
          {personas.length > 1 && <Donut title="По личностям" rows={personas} empty="—" />}
        </div>
      ) : (
        <>
          <BarList empty="вызовов ещё не было" rows={stages} />
          {personas.length > 1 && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-medium">По личностям</h3>
              <BarList empty="—" rows={personas} />
            </>
          )}
        </>
      )}
    </Section>
  );
}

// Радар моделей: каждая модель — контур по пяти осям. Оси в разных единицах,
// поэтому каждая нормирована к максимуму среди моделей (100% — самая большая
// величина); настоящие числа — в подсказке. Больше пяти моделей не рисуем —
// берём пять самых дорогих (цветов в палитре пять).
const RADAR_AXES = [
  { id: 'calls', label: 'Вызовы', get: (m) => m.calls, text: (m) => num(m.calls) },
  { id: 'input', label: 'Вход', get: (m) => m.tokens.input + m.tokens.cache_read + m.tokens.cache_write, text: (m) => kilo(m.tokens.input + m.tokens.cache_read + m.tokens.cache_write) },
  { id: 'output', label: 'Выход', get: (m) => m.tokens.output, text: (m) => kilo(m.tokens.output) },
  { id: 'cost', label: 'Расход', get: (m) => m.cost_usd, text: (m) => money(m.cost_usd) },
  { id: 'latency', label: 'Время ответа', get: (m) => m.avg_latency_ms ?? 0, text: (m) => (m.avg_latency_ms ? `${(m.avg_latency_ms / 1000).toFixed(1)} с` : '—') },
];

/** Значения CSS-переменных цветов: атрибуты SVG у recharts не понимают var(--…). */
function seriesColors() {
  const css = typeof window === 'undefined' ? null : getComputedStyle(document.documentElement);
  return SERIES.map((v, i) => css?.getPropertyValue(`--series-${i + 1}`).trim() || ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'][i]);
}

function RadarTip({ active, payload, models }) {
  if (!active || !payload?.length) return null;
  const axis = RADAR_AXES.find((a) => a.label === payload[0].payload.axis);
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{axis.label}</p>
      {models.map((m) => (
        <p key={m.model} className="flex items-center justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground"><i className="size-2 shrink-0 rounded-xs" style={{ background: m.color }} /><span className="truncate font-mono">{m.model}</span></span>
          <span className="font-medium tabular-nums">{axis.text(m)}</span>
        </p>
      ))}
    </div>
  );
}

function ModelsRadar({ models: all }) {
  const colors = seriesColors();
  const models = [...all].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, SERIES.length).map((m, i) => ({ ...m, color: colors[i] }));
  const max = Object.fromEntries(RADAR_AXES.map((a) => [a.id, Math.max(...models.map(a.get), 0) || 1]));
  const rows = RADAR_AXES.map((a) => ({
    axis: a.label,
    ...Object.fromEntries(models.map((m) => [m.model, Math.round((a.get(m) / max[a.id]) * 100)])),
  }));
  return (
    <div className="flex flex-col gap-2 px-4 pb-4" data-testid="models-radar">
      <div className="h-[280px]" role="img" aria-label={`Модели по осям: ${models.map((m) => m.model).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={rows} outerRadius="72%">
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis dataKey="axis" tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} />
            <Tooltip content={<RadarTip models={models} />} />
            {models.map((m) => (
              <Radar key={m.model} name={m.model} dataKey={m.model} stroke={m.color} strokeWidth={2} fill={m.color} fillOpacity={0.18} dot={{ r: 3, fill: m.color, strokeWidth: 0 }} />
            ))}
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
        {models.map((m) => (
          <span key={m.model} className="inline-flex items-center gap-1.5">
            <i className="size-2 rounded-xs" style={{ background: m.color }} />
            <span className="font-mono">{m.model}</span>
          </span>
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">Каждая ось — доля от наибольшего среди моделей; точные числа — при наведении.</p>
    </div>
  );
}

const MODELS_VIEW_KEY = 'stats_models_view';

/** «Модели»: таблица или радар — переключатель в шапке, выбор запоминается. */
function ModelsSection({ data, description }) {
  const [view, setViewState] = useState(() => {
    try {
      return localStorage.getItem(MODELS_VIEW_KEY) === 'radar' ? 'radar' : 'table';
    } catch {
      return 'table';
    }
  });
  const setView = (next) => {
    setViewState(next);
    try {
      localStorage.setItem(MODELS_VIEW_KEY, next);
    } catch {
      // приватное окно — выбор просто не запомнится
    }
  };
  const radar = view === 'radar' && data?.by_model.length > 0;
  return (
    <Section
      title="Модели"
      description={
        <div className="flex flex-col gap-1">
          <div className="flex justify-end">
            <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Вид" data-testid="models-view">
              {[['table', 'Таблица'], ['radar', 'Радар']].map(([id, label]) => (
                <Button key={id} type="button" role="radio" aria-checked={view === id} variant={view === id ? 'secondary' : 'ghost'} size="xs" onClick={() => setView(id)}>
                  {label}
                </Button>
              ))}
            </div>
          </div>
          {description}
        </div>
      }
      flush={!radar}
      className="min-w-0"
    >
      {radar ? (
        <ModelsRadar models={data.by_model} />
      ) : (
<Table className={EDGE}>
      <TableHeader>
        <TableRow>
          <TableHead className={TH}>Модель</TableHead>
          <TableHead className={cn(TH, 'text-right')}>Вызовов</TableHead>
          <TableHead className={cn(TH, 'text-right')}>Вход</TableHead>
          <TableHead className={cn(TH, 'text-right')}>Выход</TableHead>
          <TableHead className={cn(TH, 'text-right')}>Расход</TableHead>
          <TableHead className={cn(TH, 'text-right')}>Ответ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {!data && <SkeletonRows rows={MODEL_SKELETON_ROWS} cols={6} />}
        {data?.by_model.map((m) => (
          <TableRow key={m.model}>
            <TableCell className={cn(TD, 'font-mono text-xs')}>
              {m.model}
              {!m.priced && <Badge variant="destructive" className="ml-2 h-5 align-middle font-sans">без цены</Badge>}
            </TableCell>
            <TableCell className={cn(TD, NUM)}>{num(m.calls)}</TableCell>
            <TableCell className={cn(TD, NUM, 'text-muted-foreground')}>{kilo(m.tokens.input + m.tokens.cache_read + m.tokens.cache_write)}</TableCell>
            <TableCell className={cn(TD, NUM, 'text-muted-foreground')}>{kilo(m.tokens.output)}</TableCell>
            <TableCell className={cn(TD, NUM)}>{money(m.cost_usd)}</TableCell>
            <TableCell className={cn(TD, NUM, 'text-muted-foreground')}>{m.avg_latency_ms ? `${(m.avg_latency_ms / 1000).toFixed(1)} с` : '—'}</TableCell>
          </TableRow>
        ))}
        {data?.by_model.length === 0 && (
          <TableRow><TableCell colSpan={6} className={cn(TD, 'text-muted-foreground')}>За период вызовов не было</TableCell></TableRow>
        )}
      </TableBody>
    </Table>
        )}
    </Section>
  );
}

// Те же строки h-8 с тем же шагом, что у BarList: высота блока не прыгает.
function BarListSkeleton({ rows = 3 }) {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-8 w-full rounded-md" />)}
    </div>
  );
}

// Колонка действий: кнопка 32px по центру строки, без своих вертикальных отступов.
const ACTION = cn(TD, 'w-0 py-1 text-right align-middle');
const KPI_TITLES = ['Расход', 'LLMR', 'За ход клиента', 'Из кеша', 'Токенов', 'Сообщений', 'Чатов'];
const MODEL_SKELETON_ROWS = 3;
const CHAT_SKELETON_ROWS = 5;

// Расход — факт OpenRouter (paid_usd); LLMR — сколько сэкономил свой шлюз и сколько через него прошло вызовов.
const kpis = (t) => {
  const paid = t.paid_usd ?? t.cost_usd;
  return [
    { title: KPI_TITLES[0], value: money(paid), hint: null },
    { title: KPI_TITLES[1], value: money(t.gateway_saved_usd ?? 0), hint: `${num(t.gateway_calls ?? 0)} вызовов` },
    {
      title: KPI_TITLES[2],
      value: t.messages_in ? money(paid / t.messages_in) : '—',
      hint: `${num(t.messages_in)} входящих`,
    },
    { title: KPI_TITLES[3], value: pct(t.cache_hit_rate), hint: `${kilo(t.tokens.cache_read)} токенов дешёвых` },
    {
      title: KPI_TITLES[4],
      value: kilo(t.tokens.input + t.tokens.cache_read + t.tokens.cache_write),
      hint: `выход ${kilo(t.tokens.output)}`,
    },
    { title: KPI_TITLES[5], value: `${num(t.messages_in)} ↓ / ${num(t.messages_out)} ↑`, hint: `руками ${pct(t.manual_share)}` },
    { title: KPI_TITLES[6], value: num(t.chats), hint: t.avg_latency_ms ? `ответ модели ~${(t.avg_latency_ms / 1000).toFixed(1)} с` : null },
  ];
};

export default function Stats() {
  const navigate = useNavigate();
  const [range, setRange] = useState(() => ({ from: addDays(mskToday(), -29), to: mskToday() }));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showPrices, setShowPrices] = useState(false);
  const [tab, setTab] = useState('overview');
  const [managers, setManagers] = useState(null);
  const [teams, setTeams] = useState(null);
  const [managersLoading, setManagersLoading] = useState(false);
  const [balance, setBalance] = useState(null);
  const [stages, setStages] = useState(null);
  const [cold, setCold] = useState(null);
  const [insights, setInsights] = useState(null);
  // Имена личностей для «По личностям»: статистика отдаёт slug.
  const [personaNames, setPersonaNames] = useState({});
  useEffect(() => {
    getPersonas()
      .then((r) => setPersonaNames(Object.fromEntries((r.items ?? []).map((p) => [p.slug, p.name]))))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    getUsage({ from: range.from, to: range.to })
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((e) => setError(e.detail || e.message));
  }, [range]);

  useEffect(load, [load]);

  useEffect(() => {
    // При ошибке опроса оставляем прошлый баланс; пока его не было — показываем ошибку словами.
    const pull = () =>
      getBalance()
        .then(setBalance)
        .catch((e) => setBalance((prev) => prev ?? { error: e.detail || e.message }));
    pull();
    const timer = setInterval(() => document.visibilityState === 'visible' && pull(), 60000);
    return () => clearInterval(timer);
  }, []);

  // Вкладки «Этапы» и «По менеджерам» живые: цифры меняются от действий в других
  // вкладках браузера, поэтому опрашиваем раз в 30 секунд и при возврате на страницу.
  // Прошлые данные при этом остаются на экране — таблица не мигает скелетом.
  useEffect(() => {
    if (tab !== 'stages') return undefined;
    let alive = true;
    const pull = () => getDealStages({ from: range.from, to: range.to })
      .then((r) => {
        if (!alive) return;
        setStages(r);
        setError(null);
      })
      .catch((e) => alive && setError(e.detail || e.message));
    pull();
    const onVisible = () => document.visibilityState === 'visible' && pull();
    const timer = setInterval(onVisible, 30000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tab, range]);

  useEffect(() => {
    if (tab !== 'cold') return undefined;
    let alive = true;
    setCold(null);
    const pull = () => getColdLeads({ from: range.from, to: range.to })
      .then((r) => {
        if (!alive) return;
        setCold(r);
        setError(null);
      })
      .catch((e) => alive && setError(e.detail || e.message));
    pull();
    const onVisible = () => document.visibilityState === 'visible' && pull();
    const timer = setInterval(onVisible, 30000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tab, range]);

  // «Воронка», «Аккаунты», «Активность» — один запрос /api/stats/insights. Период
  // сменился — прошлые цифры не показываем (они про другой период).
  const insightsTab = INSIGHT_TABS.includes(tab);
  useEffect(() => setInsights(null), [range]);
  useEffect(() => {
    if (!insightsTab) return undefined;
    let alive = true;
    const pull = () => getInsights({ from: range.from, to: range.to })
      .then((r) => {
        if (!alive) return;
        setInsights(r);
        setError(null);
      })
      .catch((e) => alive && setError(e.detail || e.message));
    pull();
    const onVisible = () => document.visibilityState === 'visible' && pull();
    const timer = setInterval(onVisible, 60000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [insightsTab, range]);

  // «По менеджерам» и «По командам» — один запрос: ответ несёт обе разбивки.
  useEffect(() => {
    if (tab !== 'managers' && tab !== 'teams') return undefined;
    let alive = true;
    setManagersLoading(true);
    const pull = () => getManagerUsage({ from: range.from, to: range.to })
      .then((r) => {
        if (!alive) return;
        setManagers(r.by_manager ?? []);
        setTeams(r.by_team ?? []);
        setError(null);
      })
      .catch((e) => alive && setError(e.detail || e.message))
      .finally(() => alive && setManagersLoading(false));
    pull();
    const onVisible = () => document.visibilityState === 'visible' && pull();
    const timer = setInterval(onVisible, 30000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tab, range]);

  const t = data?.totals;
  useRouteBusy(!data && !error);

  const modelsDescription =
    data?.prices?.is_default || data?.unpriced_models?.length > 0 ? (
      <>
        {data?.prices?.is_default && (
          <p>Деньги посчитаны по ценам из кода — если прайс-лист изменился, поправьте его в «Ценах моделей».</p>
        )}
        {data?.unpriced_models?.length > 0 && (
          <p className="text-destructive">
            Без цены в таблице: {data.unpriced_models.join(', ')} — их вызовы считаются по нулю.
          </p>
        )}
      </>
    ) : null;

  return (
    <>
      <div className="container pb-8">
        <PageHeader title="Статистика">
          <DateRangePicker
            from={range.from}
            to={range.to}
            firstDay={data?.range?.first_day ?? null}
            onChange={setRange}
          />
          <Button variant="outline" size="sm" onClick={() => setShowPrices(true)}>
            <Tags aria-hidden="true" />
            Цены моделей
          </Button>
        </PageHeader>
        <PricesEditor open={showPrices} onOpenChange={setShowPrices} onChanged={load} />

        <div className="flex flex-col gap-4">
          {balance ? <Balance data={balance} /> : <BalanceSkeleton />}

          <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="h-8">
                {TABS.map(([id, label]) => (
                  <TabsTrigger key={id} value={id} className="px-3" data-testid={`stats-tab-${id}`}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <p className="min-h-4 min-w-0 flex-1 truncate text-xs text-destructive" role="status" title={error ?? undefined}>{error}</p>
            <p className="min-h-4 min-w-[9ch] text-right text-xs text-muted-foreground" aria-live="polite">
              {(tab === 'managers' && managers && managersLoading) || (tab === 'teams' && teams && managersLoading) ? 'обновляю…' : ''}
            </p>
          </div>

          <div className="flex min-h-[320px] flex-col gap-4" aria-busy={(tab === 'overview' && !data) || undefined}>
            {insightsTab ? (
              !insights ? (
                <InsightsSkeleton />
              ) : tab === 'funnel' ? (
                <FunnelTab data={insights} />
              ) : tab === 'accounts' ? (
                <AccountsTab data={insights} />
              ) : (
                <ActivityTab data={insights} />
              )
            ) : tab === 'cold' ? (
              cold ? <ColdTable data={cold} /> : <ColdSkeleton />
            ) : tab === 'stages' ? (
              stages ? <StagesTable data={stages} /> : <StagesTableSkeleton label="Считаю этапы…" />
            ) : tab === 'managers' ? (
              managers ? (
                <ManagersTable rows={managers} />
              ) : (
                <ManagersTableSkeleton label="Считаю по менеджерам…" data-testid="managers-loading" />
              )
            ) : tab === 'teams' ? (
              teams ? (
                <ManagersTable
                  rows={teams}
                  title="По командам"
                  nameHeader="Команда"
                  hint={TEAMS_HINT}
                  empty="Тимлидов и хедов пока нет"
                />
              ) : (
                <ManagersTableSkeleton
                  label="Считаю по командам…"
                  title="По командам"
                  nameHeader="Команда"
                  hint={TEAMS_HINT}
                  data-testid="teams-loading"
                />
              )
            ) : (
              // Обзор — одно дерево и на первую загрузку, и на данные: блоки, шапки
              // таблиц и строки те же, заглушки стоят только на месте значений.
              <>
                {!data && <span className="sr-only">Загружаю…</span>}
                <div className={KPI_STRIP}>
                  {(data ? kpis(t) : KPI_TITLES.map((title) => ({ title }))).map((k) => (
                    <Kpi key={k.title} {...k} loading={!data} />
                  ))}
                </div>

                {data ? <DailyChart days={data.by_day} /> : <DailyChartSkeleton />}

                <div className="grid gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(320px,1.4fr)]">
                  <SpendSection data={data} personaNames={personaNames} />

                  <ModelsSection data={data} description={modelsDescription} />
                </div>

                <Section title="Самые дорогие диалоги" flush>
                  <Table className={cn(EDGE, stickyLastCol)}>
                    <TableHeader>
                      <TableRow>
                        <TableHead className={TH}>Чат</TableHead>
                        <TableHead className={cn(TH, 'text-right')}>Вызовов</TableHead>
                        <TableHead className={cn(TH, 'text-right')}>Токенов</TableHead>
                        <TableHead className={cn(TH, 'text-right')}>Расход</TableHead>
                        <TableHead className={cn(TH, 'w-0')}><span className="sr-only">Действия</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!data && (
                        <SkeletonRows
                          rows={CHAT_SKELETON_ROWS}
                          cols={5}
                          lastCell={
                            <TableCell className={ACTION}>
                              <Skeleton className="ml-auto size-8" />
                            </TableCell>
                          }
                        />
                      )}
                      {data?.top_chats.map((c) => (
                        <TableRow key={c.chat_id}>
                          <TableCell className={cn(TD, 'font-mono text-xs')}>{c.chat_id}</TableCell>
                          <TableCell className={cn(TD, NUM)}>{num(c.calls)}</TableCell>
                          <TableCell className={cn(TD, NUM, 'text-muted-foreground')}>{kilo(c.tokens.input + c.tokens.cache_read + c.tokens.cache_write + c.tokens.output)}</TableCell>
                          <TableCell className={cn(TD, NUM)}>{money(c.cost_usd)}</TableCell>
                          <TableCell className={ACTION}>
                            <IconAction icon={ArrowUpRight} label="Открыть" hint="Открыть диалог" onClick={() => navigate(`/conversation/${c.chat_id}`)} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {data?.top_chats.length === 0 && (
                        <TableRow><TableCell colSpan={5} className={cn(TD, 'text-muted-foreground')}>Пока пусто</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Section>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
