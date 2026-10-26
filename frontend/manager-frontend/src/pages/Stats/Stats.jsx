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
import { EDGE, NUM, Section, SkeletonRows, TD, TH, kilo, money, num, pct } from './StatsUi';

const STAGE_LABEL = {
  judge_plan: 'Судья: разбор',
  judge_review: 'Судья: проверка',
  generator: 'Ответ',
  media_photo: 'Просмотр фото',
  media_reaction: 'Реакция',
};

// Доли одной величины (расход): главная доля — акцентом, остальные — ступенями
// нейтрального тона.
const SPLIT_COLORS = [
  'bg-primary',
  'bg-muted-foreground/70',
  'bg-muted-foreground/45',
  'bg-muted-foreground/30',
  'bg-muted-foreground/15',
];

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

function Split({ rows, label }) {
  const total = rows.reduce((n, r) => n + r.cost_usd, 0) || 1;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {rows.map((r, i) => (
          <span
            key={r.key}
            className={cn('block h-full', SPLIT_COLORS[i % SPLIT_COLORS.length])}
            style={{ width: `${(r.cost_usd / total) * 100}%` }}
            title={`${r.label}: ${money(r.cost_usd)}`}
          />
        ))}
      </div>
      <div className="flex flex-col gap-1.5 text-xs">
        {rows.map((r, i) => (
          <span key={r.key} className="inline-flex items-center gap-2">
            <i className={cn('size-2 shrink-0 rounded-xs', SPLIT_COLORS[i % SPLIT_COLORS.length])} />
            {r.label} <span className="text-muted-foreground tabular-nums">{money(r.cost_usd)} · {num(r.calls)}</span>
          </span>
        ))}
        {rows.length === 0 && <span className="text-muted-foreground">{label}</span>}
      </div>
    </div>
  );
}

// Та же полоса h-2 и те же строки легенды по h-4 (строка text-xs), что у Split;
// строк столько, сколько этапов расхода знает панель.
function SplitSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <Skeleton className="h-2 rounded-full" />
      <div className="flex flex-col gap-1.5">
        {Object.keys(STAGE_LABEL).map((key) => <Skeleton key={key} className="h-4 w-44 max-w-full" />)}
      </div>
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
                  <Section title="Куда уходят деньги" className="min-w-0">
                    {data ? (
                      <Split
                        label="вызовов ещё не было"
                        rows={data.by_stage.map((r) => ({ key: r.stage, label: STAGE_LABEL[r.stage] ?? r.stage, cost_usd: r.cost_usd, calls: r.calls }))}
                      />
                    ) : (
                      <SplitSkeleton />
                    )}
                    {data?.by_persona.length > 1 && (
                      <>
                        <h3 className="mt-4 mb-2.5 text-sm font-medium">По личностям</h3>
                        <Split
                          label="—"
                          rows={data.by_persona.map((r) => ({ key: r.persona_id, label: r.persona_id, cost_usd: r.cost_usd, calls: r.calls }))}
                        />
                      </>
                    )}
                  </Section>

                  <Section title="Модели" description={modelsDescription} flush className="min-w-0">
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
                  </Section>
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
