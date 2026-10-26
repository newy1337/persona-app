import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Columns3, Loader2, Play, Plus, Rows3, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PanelUX } from '../../ui/PanelUX';
import { CreateLeadForm } from './CreateLeadForm';
import { LeadsTable } from './LeadsTable';
import { LeadCard } from './LeadCard';
import { LeadsBoard } from './LeadsBoard';
import { LEADS_BY_FILTER, NEXT_FILTER, PROBLEM_FILTER, TYPE_FILTER, leadProblems, leadsBy, matchesType, nextStepState } from './leadInfo';
import { setDealStage } from '../../api/conversations';
import {
  deleteLead,
  getLeadPersonas,
  getLeads,
  getOutreachStatus,
  importLeads,
  startOutreach,
  stopOutreach,
  updateLead,
  writeFromAnother,
} from '../../api/leads';
import { useRouteBusy } from '../../components/AppLayout/routeBusy';
import { FilterChips } from '../../components/ColumnFilter/FilterChips';
import { SavedFilters } from '../../components/ColumnFilter/SavedFilters';
import { useColumnFilters } from '../../components/ColumnFilter/useColumnFilters';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { Pager } from '../../components/Pager/Pager';
import { SearchInput } from '../../components/SearchInput/SearchInput';
import { StageTabs } from '../../components/StageTabs/StageTabs';
import { DEAL_STAGES } from '../../data/dealStages';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogError,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

const STATUS = [
  { key: '', label: 'Все' },
  { key: 'pending', label: 'В базе' },
  { key: 'queued', label: 'В очереди' },
  { key: 'assigned', label: 'Найден' },
  { key: 'contacted', label: 'Написали' },
  { key: 'replied', label: 'Ответил' },
  { key: 'dead', label: 'Недоступен' },
];
const LABEL = Object.fromEntries(STATUS.map((x) => [x.key, x.label]));
const STATUS_KEYS = STATUS.map((x) => x.key).filter(Boolean);
/* Фильтр «Этап»: этапы сделки по порядку и «не указан» — диалог есть, этапа нет. */
const STAGE_OPTIONS = [...DEAL_STAGES.map((s) => ({ value: s.id, label: s.label })), { value: 'none', label: 'не указан' }];
const STAGE_KEYS = STAGE_OPTIONS.map((o) => o.value);
// Из сохранённого значения фильтра берём только известные ключи, в порядке списка.
const pick = (value, known) => (Array.isArray(value) ? known.filter((key) => value.map(String).includes(key)) : []);
/* Единственная карта «статус лида -> Badge». Нарочно не совпадает с цветами
   стадий диалогов из data/stages.js: статусы лида — про воронку прозвона. */
const BADGE = {
  pending: { variant: 'outline' },
  queued: { variant: 'secondary' },
  assigned: { variant: 'default' },
  contacted: { variant: 'success' },
  replied: { variant: 'success' },
  dead: { variant: 'destructive' },
};
const SEARCH_DEBOUNCE_MS = 250;
/* Бэкенд (как в рабочей панели) фильтрует по одному статусу и одному этапу и
   отдаёт первые limit строк без total. Один выбранный статус/этап уходит в
   запрос; несколько — отбираются здесь. Страницы листаются тоже здесь. */
const FETCH_LIMIT = 1000;
const onlyOne = (values) => (values.length === 1 ? values[0] : '');
const stageOf = (row) => row.deal_stage || 'none';
const PAGE_SIZES = [25, 50, 100];
/* Фильтры, которые сервер не знает, — отбираются здесь по загруженному списку. */
const GENDER_FILTER = [
  { value: 'm', label: 'мужской' },
  { value: 'f', label: 'женский' },
  { value: 'unknown', label: 'не указан' },
];
const UNREAD_FILTER = [
  { value: 'yes', label: 'есть' },
  { value: 'no', label: 'нет' },
];
const keysOf = (options) => options.map((o) => o.value);
const genderOf = (row) => (row.gender === 'm' || row.gender === 'f' ? row.gender : 'unknown');
const VIEW_KEY = 'leads_view';
const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'table';
  } catch {
    return 'table';
  }
};
const DOT = {
  success: 'bg-success-foreground',
  warning: 'bg-warning-foreground',
  destructive: 'bg-destructive',
};

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function PersonaSelect({ personas, value, onChange, className, ...props }) {
  return (
    <NativeSelect className={className} value={value || ''} onChange={(e) => onChange(e.target.value)} {...props}>
      <option value="">любая личность</option>
      {personas.map((p) => (
        <option key={p.slug} value={p.slug}>
          {p.name}
          {p.accounts_ready ? ` · ${p.accounts_ready} акк. в сети` : ' · нет аккаунтов в сети'}
        </option>
      ))}
    </NativeSelect>
  );
}

const Mono = ({ children }) => <span className="font-mono text-foreground">{children}</span>;

/* Строка состояния: цветная точка и одно короткое предложение. */
function StatusLine({ tone, children, ...props }) {
  return (
    <p className="flex min-w-0 items-start gap-2 leading-4" {...props}>
      <span className={cn('mt-[5px] size-1.5 shrink-0 rounded-full', DOT[tone])} aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function ImportDialog({ personas, onClose }) {
  const [text, setText] = useState('');
  const [queue, setQueue] = useState(false);
  const [personaId, setPersonaId] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const lines = text.split('\n').filter((l) => l.trim()).length;

  async function submit(e) {
    e.preventDefault();
    if (busy || !lines) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await importLeads({ text, queue, persona_id: personaId }));
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(Boolean(result)); }}>
      <DialogContent portal={false} showCloseButton={false}>
        <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={submit} aria-label="Импорт лидов">
          <DialogHeader>
            <DialogTitle>Импорт номеров</DialogTitle>
            <DialogDescription>
              По одному лиду в строке: <Mono>контакт;имя;город;возраст;сайт</Mono>, где контакт —
              телефон, <Mono>@username</Mono> или ссылка <Mono>t.me/…</Mono>. Имя, город,
              возраст и сайт необязательны — город и сайт идут в <Mono>{'{city}'}</Mono> и{' '}
              <Mono>{'{site}'}</Mono> диалога. Разделитель — <Mono>;</Mono>, запятая или таб.
              Дубли пропускаются.
            </DialogDescription>
          </DialogHeader>
          {/* Высота тела одна и та же у формы и у итога: окно не прыгает после импорта. */}
          <DialogBody className="flex min-h-[328px] min-w-0 flex-col gap-3">
            {result ? (
              <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-4 text-sm">
                <StatusLine tone="success">Добавлено: <span className="tabular-nums">{result.created}</span>, дублей: <span className="tabular-nums">{result.duplicates}</span></StatusLine>
                {result.errors.length > 0 && (
                  <>
                    <StatusLine tone="destructive">Пропущено строк: <span className="tabular-nums">{result.errors.length}</span></StatusLine>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{result.errors.slice(0, 5).join(' · ')}{result.errors.length > 5 ? ' …' : ''}</p>
                  </>
                )}
              </div>
            ) : (
              <>
                <Textarea
                  className="min-h-[240px] resize-y font-mono text-xs field-sizing-fixed [field-sizing:fixed]"
                  rows={10}
                  autoFocus
                  aria-label="Список лидов"
                  placeholder={'+79001234567;Олег;Москва;34;beboo\n@some_name;Ира;;;mamba\nt.me/other_name'}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <Field label="С какой личности писать всем из списка">
                  <PersonaSelect personas={personas} value={personaId} onChange={setPersonaId} />
                </Field>
                <div className="flex items-center gap-2">
                  <Checkbox id="import-queue" checked={queue} onCheckedChange={(v) => setQueue(v === true)} />
                  <Label htmlFor="import-queue" className="cursor-pointer font-normal">Сразу поставить в очередь прозвона</Label>
                </div>
              </>
            )}
          </DialogBody>
          <DialogError aria-live="polite">{error}</DialogError>
          <DialogFooter>
            {result ? (
              <Button type="button" onClick={() => onClose(true)}>Готово</Button>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={() => onClose(false)}>Отмена</Button>
                <Button type="submit" disabled={busy || !lines}>
                  {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
                  <span>{busy ? 'Импорт…' : <>Импортировать (<span className="tabular-nums">{lines}</span>)</>}</span>
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* Состояние прозвона одной строкой; подробности лимитов — в подсказке. */
function OutreachBar({ status, queued }) {
  if (!status) return null;
  const online = status.accounts.filter((a) => a.online);
  const sent = status.accounts.reduce((n, a) => n + a.sent_today, 0);
  const cap = status.accounts.length * status.daily_per_account;
  const today = `сегодня ${sent} из ${cap}`;
  const waiting = queued > 0 ? `в очереди ${queued}` : null;
  const detail = `Лимит ${status.daily_per_account} в день на аккаунт, пауза ${Math.round(status.min_gap_s / 60)} мин между сообщениями, очередь проверяется раз в минуту.`;
  let tone = 'success';
  let parts = ['Прозвон работает', `${online.length} акк. онлайн`, today];
  let accountsLink = false;
  if (!status.enabled) {
    tone = 'destructive';
    parts = ['Прозвон выключен', 'нет ключей Telegram или включён аварийный стоп', waiting];
  } else if (!online.length) {
    tone = 'destructive';
    parts = ['Прозвон стоит', 'нет ни одного активного аккаунта онлайн', waiting];
    accountsLink = true;
  } else if (!status.within_hours) {
    tone = 'warning';
    parts = ['Прозвон ждёт', `вне рабочих часов (${status.hours_msk[0]}:00–${status.hours_msk[1]}:00 МСК)`, waiting, today];
  }
  return (
    <StatusLine tone={tone} data-testid="outreach-status" data-tone={tone}>
      <span className="tabular-nums" title={detail}>{parts.filter(Boolean).join(' · ')}</span>
      {accountsLink && <>{' '}<Link to="/accounts" className="text-primary underline-offset-4 hover:underline">Открыть аккаунты →</Link></>}
    </StatusLine>
  );
}

function StuckWarning({ items, personas }) {
  const idle = personas.filter((p) => !p.accounts_ready).map((p) => p.slug);
  const stuck = items.filter((l) => l.status === 'queued' && l.persona_id && idle.includes(l.persona_id));
  if (!stuck.length) return null;
  const names = [...new Set(stuck.map((l) => l.persona_name || l.persona_id))].join(', ');
  return (
    <StatusLine tone="warning">
      <span className="tabular-nums">{stuck.length}</span> лид(ов) в очереди ждут: у личности {names} нет аккаунтов в сети. Включите аккаунт этой личности
      или смените личность у лида.
    </StatusLine>
  );
}

export function DeleteLeadDialog(props) { return <PanelUX.DeleteLeadModal {...props} />; }

export default function Leads() {
  const navigate = useNavigate();
  // items === null только до первого ответа: таблица рисует скелет нужной высоты.
  const [data, setData] = useState({ items: null, counts: {} });
  // Фильтры колонок («Статус», «Этап») живут в sessionStorage; воронка над
  // таблицей — то же самое состояние, что и фильтр «Статус».
  const [filterState, setFilter, resetFilters, replaceFilters] = useColumnFilters('leads');
  const statuses = pick(filterState.status, STATUS_KEYS);
  const dealStages = pick(filterState.stage, STAGE_KEYS);
  const status = onlyOne(statuses);
  const dealStage = onlyOne(dealStages);
  const types = pick(filterState.type, keysOf(TYPE_FILTER));
  const genders = pick(filterState.gender, keysOf(GENDER_FILTER));
  const nexts = pick(filterState.next, keysOf(NEXT_FILTER));
  const unreads = pick(filterState.unread, keysOf(UNREAD_FILTER));
  const bys = pick(filterState.leads, keysOf(LEADS_BY_FILTER));
  const problemsPicked = pick(filterState.problem, keysOf(PROBLEM_FILTER));
  const [view, setViewState] = useState(readView);
  const setView = (next) => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // приватное окно — вид просто не запомнится
    }
  };
  // Открытая карточка: держим id, а лида берём из свежего списка — карточка обновляется вместе с ним.
  const [openId, setOpenId] = useState(null);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [outreach, setOutreach] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(null);
  const [personas, setPersonas] = useState([]);
  const busy = PanelUX.useActions().pending.some((key) => key.includes('/api/leads'));
  // Номер последнего запроса: ответ прошлой страницы не затирает новую.
  const request = useRef(0);

  useRouteBusy(data.items === null);

  useEffect(() => {
    if (qInput === q) return undefined;
    const t = setTimeout(() => { setQ(qInput); setPage(1); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [qInput, q]);

  const loadPersonas = useCallback(() => {
    getLeadPersonas().then((r) => setPersonas(r.items ?? [])).catch(() => setPersonas([]));
  }, []);

  const load = useCallback(() => {
    const id = ++request.current;
    Promise.all([
      getLeads({ status, deal_stage: dealStage || undefined, q, limit: FETCH_LIMIT }),
      getOutreachStatus().catch(() => null),
    ])
      .then(([d, o]) => {
        if (id !== request.current) return;
        setData(d);
        if (o) setOutreach(o);
      })
      .catch((e) => { if (id === request.current) setError(e.detail || e.message); });
  }, [status, dealStage, q]);

  useEffect(() => {
    load();
    loadPersonas();
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      load();
      loadPersonas();
    };
    const t = setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load, loadPersonas]);

  async function run(fn) {
    setError(null);
    try {
      await fn();
      setSelected(new Set());
      load();
    } catch (e) {
      setError(e.detail || e.message);
    }
  }

  const toggle = (id) => setSelected((v) => { const n = new Set(v); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = [...selected];
  const counts = data.counts ?? {};
  const stageCounts = data.stages ?? {};
  // Несколько статусов или этапов сервер не фильтрует — отбираем здесь.
  // Личности без аккаунтов в сети: их очередь некому разбирать — это проблема лида.
  const idlePersonas = personas.filter((p) => !p.accounts_ready).map((p) => p.slug);
  const hasProblem = (row) => leadProblems(row, idlePersonas).length > 0;
  const matched = (data.items ?? []).filter((row) =>
    (statuses.length < 2 || statuses.includes(row.status)) &&
    (dealStages.length < 2 || dealStages.includes(stageOf(row))) &&
    matchesType(row, types) &&
    (genders.length === 0 || genders.includes(genderOf(row))) &&
    (nexts.length === 0 || nexts.includes(nextStepState(row))) &&
    (unreads.length === 0 || unreads.includes(row.unread_count > 0 ? 'yes' : 'no')) &&
    (bys.length === 0 || bys.includes(leadsBy(row))) &&
    (problemsPicked.length === 0 || problemsPicked.includes(hasProblem(row) ? 'yes' : 'no')));
  const problemCount = (data.items ?? []).filter(hasProblem).length;
  const overdue = (data.items ?? []).filter((row) => nextStepState(row) === 'overdue').length;
  const openLead = openId === null ? null : (data.items ?? []).find((row) => row.id === openId) ?? null;
  const total = matched.length;
  const items = matched.slice((page - 1) * pageSize, page * pageSize);
  const loaded = data.items !== null;

  // Список стал короче (удаление, смена статуса) — возвращаемся на последнюю страницу.
  useEffect(() => {
    if (!loaded) return;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (page > pages) setPage(pages);
  }, [loaded, total, pageSize, page]);

  const changeFilter = (key, value) => { setFilter(key, value); setPage(1); };
  const filterColumns = [
    {
      key: 'status',
      label: 'Статус',
      filter: { type: 'options', options: STATUS_KEYS.map((key) => ({ value: key, label: LABEL[key], count: counts[key] })) },
    },
    {
      key: 'stage',
      label: 'Этап',
      filter: { type: 'options', options: STAGE_OPTIONS.map((o) => ({ ...o, count: stageCounts[o.value] })) },
    },
    { key: 'type', label: 'Тип', filter: { type: 'options', options: TYPE_FILTER } },
    { key: 'gender', label: 'Пол', filter: { type: 'options', options: GENDER_FILTER } },
    { key: 'next', label: 'Следующий шаг', filter: { type: 'options', options: NEXT_FILTER } },
    { key: 'unread', label: 'Непрочитанные', filter: { type: 'options', options: UNREAD_FILTER } },
    { key: 'leads', label: 'Ведёт', filter: { type: 'options', options: LEADS_BY_FILTER } },
    { key: 'problem', label: 'Проблемы', filter: { type: 'options', options: PROBLEM_FILTER } },
  ];
  const filters = {
    defs: Object.fromEntries(filterColumns.map((col) => [col.key, col.filter])),
    state: { status: statuses, stage: dealStages, type: types, gender: genders, next: nexts, unread: unreads, leads: bys, problem: problemsPicked },
    onChange: changeFilter,
  };
  const filtered = Boolean(status || dealStage || types.length || genders.length || nexts.length || unreads.length || bys.length || problemsPicked.length);

  // Воронка: перенос карточки меняет этап диалога лида; в архив — с причиной.
  async function moveToStage(lead, stage) {
    let note = '';
    if (stage === 'archive') {
      note = await PanelUX.prompt({ title: 'В архив', message: 'Почему диалог уходит в архив?', value: '', confirmLabel: 'В архив' });
      if (!note) return;
    }
    setError(null);
    try {
      await setDealStage(lead.telegram_user_id, stage, note);
    } catch (e) {
      setError(e.detail || e.message);
    }
    load();
  }

  const written = (counts.contacted ?? 0) + (counts.replied ?? 0);
  const stages = STATUS.map((st) => ({
    key: st.key,
    label: st.label,
    count: st.key ? counts[st.key] : counts.total,
    hint: st.key === 'replied' && written > 0
      ? `${Math.round(((counts.replied ?? 0) / written) * 100)}% от тех, кому написали`
      : undefined,
  }));

  return (
    <>
      <div className="container">
        <PageHeader title="Лиды">
          <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
            <Upload aria-hidden="true" />
            Импорт списка
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Добавить номер
          </Button>
          <Button size="sm" disabled={!counts.pending} onClick={() => run(() => startOutreach())}>
            <Play aria-hidden="true" />
            <span>Запустить прозвон (<span className="inline-block min-w-[1ch] text-center tabular-nums">{counts.pending ?? 0}</span>)</span>
          </Button>
        </PageHeader>

        <div className="flex flex-col gap-4">
          <div className="flex min-h-4 flex-col gap-1 text-xs" aria-live="polite">
            <OutreachBar status={outreach} queued={counts.queued ?? 0} />
            <StuckWarning items={data.items ?? []} personas={personas} />
            {problemCount > 0 && (
              <StatusLine tone="destructive" data-testid="lead-problems">
                {`${problemCount} ${problemCount === 1 ? 'лид' : problemCount < 5 ? 'лида' : 'лидов'} с проблемами: ошибки, недоступные, застрявшие в очереди, просроченные шаги. `}
                <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => changeFilter('problem', ['yes'])}>
                  Показать
                </button>
              </StatusLine>
            )}
            {overdue > 0 && (
              <StatusLine tone="destructive" data-testid="overdue-steps">
                {`Просрочен следующий шаг у ${overdue} ${overdue === 1 ? 'лида' : 'лидов'}. `}
                <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => changeFilter('next', ['overdue'])}>
                  Показать
                </button>
              </StatusLine>
            )}
            {error && <p className="leading-4 text-destructive [overflow-wrap:anywhere]">{error}</p>}
          </div>

          <div className="flex items-center gap-1" role="radiogroup" aria-label="Вид" data-testid="leads-view">
            {[
              ['table', 'Таблица', Rows3],
              ['board', 'Воронка', Columns3],
            ].map(([key, label, Icon]) => (
              <Button key={key} type="button" role="radio" aria-checked={view === key} variant={view === key ? 'secondary' : 'ghost'} size="xs" onClick={() => setView(key)}>
                <Icon aria-hidden="true" />
                {label}
              </Button>
            ))}
          </div>

          <StageTabs
            aria-label="Статус"
            items={stages}
            value={statuses.length > 1 ? null : (statuses[0] ?? '')}
            total={counts.total}
            onChange={(key) => changeFilter('status', key ? [key] : [])}
          />

          <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
            <SavedFilters tableId="leads" state={filters.state} onApply={(state) => { replaceFilters(state); setPage(1); }} />
            <FilterChips
              columns={filterColumns}
              state={filters.state}
              onChange={changeFilter}
              onReset={() => { resetFilters(); setPage(1); }}
            />
            {loaded && (filtered || q) && (
              <span className="text-xs tabular-nums text-muted-foreground" data-testid="leads-found">
                Найдено {total} из {counts.total ?? total}
              </span>
            )}
            {ids.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Действия с выбранными">
                <span className="min-w-[11ch] text-xs tabular-nums text-muted-foreground" role="status">Выбрано: {ids.length}</span>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => startOutreach(ids))}>
                  <span>В очередь (<span className="tabular-nums">{ids.length}</span>)</span>
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => stopOutreach(ids))}>
                  <span>Снять (<span className="tabular-nums">{ids.length}</span>)</span>
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>Снять выделение</Button>
              </div>
            )}
            <SearchInput
              className="ml-auto w-full sm:w-80"
              aria-label="Поиск лидов"
              placeholder="Телефон, @username, имя, город"
              value={qInput}
              onChange={setQInput}
            />
          </div>

          {view === 'board' && loaded ? (
            <LeadsBoard rows={matched} idlePersonas={idlePersonas} onOpen={(row) => setOpenId(row.id)} onMove={moveToStage} />
          ) : (
          <LeadsTable rows={loaded ? items : null} query={q} filtered={filtered} filters={filters} selected={selected} idlePersonas={idlePersonas}
            onToggle={toggle} onSelectVisible={checked => setSelected(previous => {
              const next = new Set(previous);
              for (const row of items) { if (checked) next.add(row.id); else next.delete(row.id); }
              return next;
            })}
            onOpen={(row) => setOpenId(row.id)}
            onChat={id => navigate(`/conversation/${id}`)}
            onQueue={ids => run(() => startOutreach(ids))} onUnqueue={ids => run(() => stopOutreach(ids))}
            onReassign={row => run(() => writeFromAnother(row.id))} onDelete={setDeleting}
            onPersonaChange={(id, persona_id) => run(() => updateLead(id, { persona_id }))}
            personas={personas} helpers={{ PersonaSelect, statusLabels: LABEL, statusBadges: BADGE, date: fmtTs }} />
          )}

          {view === 'board' ? null : loaded ? (
            <Pager
              label="Страницы лидов"
              page={page}
              pageSize={pageSize}
              total={total}
              onPage={setPage}
              pageSizes={PAGE_SIZES}
              onPageSize={(size) => { setPageSize(size); setPage(1); }}
            />
          ) : (
            <div className="min-h-8" />
          )}
        </div>
      </div>
      {openLead && (
        <LeadCard
          lead={openLead}
          statusLabel={LABEL[openLead.status] || openLead.status}
          statusBadge={BADGE[openLead.status]}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onChat={(id) => navigate(`/conversation/${id}`)}
          onQueue={(ids) => run(() => startOutreach(ids))}
          onUnqueue={(ids) => run(() => stopOutreach(ids))}
          onDelete={(lead) => { setOpenId(null); setDeleting(lead); }}
        />
      )}
      {adding && <CreateLeadForm personas={personas} PersonaSelect={PersonaSelect} onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
      {importing && <ImportDialog personas={personas} onClose={() => { setImporting(false); load(); }} />}
      {deleting && (
        <DeleteLeadDialog
          lead={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={async ({ telegram }) => {
            setError(null);
            try {
              const r = await deleteLead(deleting.id, { telegram });
              const failed = r?.telegram?.failed ?? [];
              if (failed.length) {
                setError(`Лид удалён, но переписку в Telegram удалить не удалось: ${failed.map((f) => (f.account_id ? `аккаунт #${f.account_id} — ${f.error}` : f.error)).join('; ')}`);
              }
            } catch (e) {
              setError(e.detail || e.message);
              throw e;
            }
            setDeleting(null);
            setSelected(new Set());
            load();
          }}
        />
      )}
    </>
  );
}
