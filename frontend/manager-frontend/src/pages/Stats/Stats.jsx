import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/Header/Header';
import { getUsage, getManagerUsage, getBalance, getDealStages } from '../../api/usage';
import DailyChart from './DailyChart';
import DateRangePicker, { mskToday, addDays } from '../../components/DateRangePicker/DateRangePicker';
import PricesEditor from './PricesEditor';
import ManagersTable from './ManagersTable';
import StagesTable from './StagesTable';
import Balance from './Balance';
import { Button } from '@/components/ui/button';
import { Card, CardDescription } from '@/components/ui/card';
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
import { EDGE, NUM, Section, TD, TH, kilo, money, num, pct } from './StatsUi';

const STAGE_LABEL = {
  judge_plan: 'Судья: разбор',
  judge_review: 'Судья: проверка',
  generator: 'Ответ',
  media_photo: 'Просмотр фото',
  media_reaction: 'Реакция',
};

// Доли одной величины (расход) — ступени одного акцента плюс нейтральный хвост.
const SPLIT_COLORS = [
  'var(--primary)',
  'color-mix(in oklch, var(--primary) 70%, transparent)',
  'color-mix(in oklch, var(--primary) 45%, transparent)',
  'color-mix(in oklch, var(--primary) 25%, transparent)',
  'var(--muted-foreground)',
];

const KPI_GRID = 'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6';
const TABS = [['overview', 'Обзор'], ['managers', 'По менеджерам'], ['stages', 'Этапы']];

function Kpi({ title, value, hint }) {
  return (
    <Card className="min-h-[92px] gap-1 p-4 tabular-nums">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</span>
      <span className="text-2xl font-semibold leading-8 tabular-nums">{value}</span>
      <span className="min-h-4 text-xs text-muted-foreground">{hint}</span>
    </Card>
  );
}

function Split({ rows, label }) {
  const total = rows.reduce((n, r) => n + r.cost_usd, 0) || 1;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {rows.map((r, i) => (
          <span
            key={r.key}
            className="block h-full"
            style={{ width: `${(r.cost_usd / total) * 100}%`, background: SPLIT_COLORS[i % SPLIT_COLORS.length] }}
            title={`${r.label}: ${money(r.cost_usd)}`}
          />
        ))}
      </div>
      <div className="flex flex-col gap-1.5 text-xs">
        {rows.map((r, i) => (
          <span key={r.key} className="inline-flex items-center gap-2">
            <i className="size-2.5 shrink-0 rounded-sm" style={{ background: SPLIT_COLORS[i % SPLIT_COLORS.length] }} />
            {r.label} <span className="text-muted-foreground tabular-nums">{money(r.cost_usd)} · {num(r.calls)}</span>
          </span>
        ))}
        {rows.length === 0 && <span className="text-muted-foreground">{label}</span>}
      </div>
    </div>
  );
}

function RowsSkeleton({ label, ...props }) {
  return (
    <div className="space-y-2" aria-busy="true" {...props}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <span className="sr-only">Загружаю…</span>
      <div className={KPI_GRID}>
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)}
      </div>
      <Skeleton className="h-[230px] rounded-xl" />
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    </div>
  );
}

export default function Stats() {
  const navigate = useNavigate();
  const [range, setRange] = useState(() => ({ from: addDays(mskToday(), -29), to: mskToday() }));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showPrices, setShowPrices] = useState(false);
  const [tab, setTab] = useState('overview');
  const [managers, setManagers] = useState(null);
  const [managersLoading, setManagersLoading] = useState(false);
  const [balance, setBalance] = useState(null);
  const [stages, setStages] = useState(null);

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
    if (tab !== 'managers') return undefined;
    let alive = true;
    setManagersLoading(true);
    const pull = () => getManagerUsage({ from: range.from, to: range.to })
      .then((r) => {
        if (!alive) return;
        setManagers(r.by_manager ?? []);
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

  const modelsDescription =
    data?.prices?.is_default || data?.unpriced_models?.length > 0 ? (
      <CardDescription className="space-y-1 text-xs">
        {data?.prices?.is_default && (
          <p>Деньги посчитаны по ценам из кода — если прайс-лист изменился, поправьте его в «Ценах моделей».</p>
        )}
        {data?.unpriced_models?.length > 0 && (
          <p className="text-destructive">
            Без цены в таблице: {data.unpriced_models.join(', ')} — их вызовы считаются по нулю.
          </p>
        )}
      </CardDescription>
    ) : null;

  return (
    <div className="app">
      <Header />
      <main className="main">
        <div className="container pb-8">
          <div className="my-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Статистика</h2>
            <div className="flex flex-wrap items-center gap-2">
              <DateRangePicker
                from={range.from}
                to={range.to}
                firstDay={data?.range?.first_day ?? null}
                onChange={setRange}
              />
              <Button variant="outline" className="min-w-[128px]" aria-pressed={showPrices} onClick={() => setShowPrices((v) => !v)}>
                {showPrices ? 'Скрыть цены' : 'Цены моделей'}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {balance ? <Balance data={balance} /> : <Skeleton className="h-[74px] rounded-xl" />}

            <p className="min-h-5 text-sm text-destructive" role="status">{error}</p>

            {showPrices && <PricesEditor onChanged={load} onError={setError} />}

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                {TABS.map(([id, label]) => (
                  <TabsTrigger key={id} value={id} className="px-4" data-testid={`stats-tab-${id}`}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="min-h-[320px] space-y-3">
              {tab === 'stages' ? (
                stages ? <StagesTable data={stages} /> : <RowsSkeleton label="Считаю этапы…" />
              ) : tab === 'managers' ? (
                <>
                  <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
                    {managers && managersLoading ? 'обновляю…' : ''}
                  </p>
                  {managers ? (
                    <ManagersTable rows={managers} />
                  ) : (
                    <RowsSkeleton label="Считаю по менеджерам…" data-testid="managers-loading" />
                  )}
                </>
              ) : !data ? (
                <OverviewSkeleton />
              ) : (
                <>
                  <div className={KPI_GRID}>
                    <Kpi title="Расход" value={money(t.cost_usd)} hint={`${num(t.calls)} вызовов модели`} />
                    <Kpi
                      title="За ход клиента"
                      value={t.messages_in ? money(t.cost_usd / t.messages_in) : '—'}
                      hint={`${num(t.messages_in)} входящих`}
                    />
                    <Kpi title="Из кеша" value={pct(t.cache_hit_rate)} hint={`${kilo(t.tokens.cache_read)} токенов дешёвых`} />
                    <Kpi
                      title="Токенов"
                      value={kilo(t.tokens.input + t.tokens.cache_read + t.tokens.cache_write)}
                      hint={`выход ${kilo(t.tokens.output)}`}
                    />
                    <Kpi title="Сообщений" value={`${num(t.messages_in)} ↓ / ${num(t.messages_out)} ↑`} hint={`руками ${pct(t.manual_share)}`} />
                    <Kpi title="Чатов" value={num(t.chats)} hint={t.avg_latency_ms ? `ответ модели ~${(t.avg_latency_ms / 1000).toFixed(1)} с` : null} />
                  </div>

                  <DailyChart days={data.by_day} />

                  <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_minmax(320px,1.4fr)]">
                    <Section title="Куда уходят деньги" className="min-w-0">
                      <Split
                        label="вызовов ещё не было"
                        rows={data.by_stage.map((r) => ({ key: r.stage, label: STAGE_LABEL[r.stage] ?? r.stage, cost_usd: r.cost_usd, calls: r.calls }))}
                      />
                      {data.by_persona.length > 1 && (
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
                          {data.by_model.map((m) => (
                            <TableRow key={m.model}>
                              <TableCell className={cn(TD, 'font-mono text-xs')}>
                                {m.model}
                                {!m.priced && <span className="text-destructive"> без цены</span>}
                              </TableCell>
                              <TableCell className={cn(TD, NUM)}>{num(m.calls)}</TableCell>
                              <TableCell className={cn(TD, NUM, 'text-muted-foreground')}>{kilo(m.tokens.input + m.tokens.cache_read + m.tokens.cache_write)}</TableCell>
                              <TableCell className={cn(TD, NUM, 'text-muted-foreground')}>{kilo(m.tokens.output)}</TableCell>
                              <TableCell className={cn(TD, NUM)}>{money(m.cost_usd)}</TableCell>
                              <TableCell className={cn(TD, NUM, 'text-muted-foreground')}>{m.avg_latency_ms ? `${(m.avg_latency_ms / 1000).toFixed(1)} с` : '—'}</TableCell>
                            </TableRow>
                          ))}
                          {data.by_model.length === 0 && (
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
                        {data.top_chats.map((c) => (
                          <TableRow key={c.chat_id}>
                            <TableCell className={cn(TD, 'font-mono text-xs')}>{c.chat_id}</TableCell>
                            <TableCell className={cn(TD, NUM)}>{num(c.calls)}</TableCell>
                            <TableCell className={cn(TD, NUM, 'text-muted-foreground')}>{kilo(c.tokens.input + c.tokens.cache_read + c.tokens.cache_write + c.tokens.output)}</TableCell>
                            <TableCell className={cn(TD, NUM)}>{money(c.cost_usd)}</TableCell>
                            <TableCell className={cn(TD, 'py-1 text-right align-middle')}>
                              <Button variant="outline" size="sm" onClick={() => navigate(`/conversation/${c.chat_id}`)}>Открыть</Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {data.top_chats.length === 0 && (
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
      </main>
    </div>
  );
}
