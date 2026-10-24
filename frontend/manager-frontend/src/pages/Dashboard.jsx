import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { Archive, ArrowLeft, CircleAlert, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useRouteBusy } from '../components/AppLayout/routeBusy';
import { usePublishHeaderTools } from '../components/AppLayout/headerTools';
import { PageHeader } from '../components/PageHeader/PageHeader';
import NeedManagerAssist from '../components/NeedManagerAssist/NeedManagerAssist';
import StatsBar from '../components/StatsBar/StatsBar';
import ConversationsTable from '../components/ConversationsTable/ConversationsTable';
import { useColumnFilters } from '../components/ColumnFilter/useColumnFilters';
import { isActive } from '../components/ColumnFilter/filters';
import { PanelUX } from '../ui/PanelUX';
import {
  getConversations,
  getHiddenConversations,
  getNeedManagerAssist,
  setConversationHidden,
  setDealStage,
} from '../api/conversations';
import { getStats } from '../api/stats';
import { liveRows } from '../utils/chat';
import { moscowDay, rangeForFilter } from '../utils/panelTime';
import { rememberReminder, shouldRemind } from '../utils/stageReminder';
import { withArchive } from '../utils/search';

// periodLabel — подпись, когда выбран период: плитка считает за него.
const STAT_TILES = [
  { key: 'need_manager', label: 'Ждут менеджера' },
  { key: 'total', label: 'Всего диалогов', periodLabel: 'Диалогов за период' },
  { key: 'active_now', label: 'Активны сейчас' },
  { key: 'leads', label: 'Лидов оформлено' },
  { key: 'accounts', label: 'Мои аккаунты' },
  { key: 'stage_vbros', label: 'Вброс', periodLabel: 'Вброс за период' },
  { key: 'stage_predloga', label: 'Предлога', periodLabel: 'Предлога за период' },
  { key: 'stage_soglas', label: 'Соглас', periodLabel: 'Соглас за период' },
  { key: 'stage_lead', label: 'Лид', periodLabel: 'Лид за период' },
  { key: 'stage_deposit', label: 'Депозит', periodLabel: 'Депозит за период' },
  { key: 'stage_archive', label: 'В архиве', periodLabel: 'В архив за период' },
];

// Подписи плиток известны заранее: рисуем их сразу, значения до первого
// ответа — null, StatsBar ставит на их место Skeleton той же высоты.
const EMPTY_STATS = STAT_TILES.map((t) => ({ id: t.key, label: t.label, value: null }));

const PERIODS = [
  { value: '', label: 'Вся история' },
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: 'date', label: 'Дата…' },
];

const POLL_MS = 10000;

/** Напоминание об этапах: тихая строка в шапке таблицы, а не баннер. */
function StageReminder({ count, onDismiss }) {
  const text = `В ${count} ${count === 1 ? 'диалоге' : 'диалогах'} не указан этап — выберите его в колонке «Этап».`;
  return (
    <div role="status" data-testid="stage-reminder" className="flex min-w-0 items-center gap-1.5 text-xs">
      <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-warning-foreground" />
      <span className="truncate text-muted-foreground" title={text}>{text}</span>
      <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={onDismiss} aria-label="Скрыть напоминание">
        Понятно
      </Button>
    </div>
  );
}

/**
 * Период страницы: меняет и плитки (статистика за дни), и список (колонка
 * «Последнее»). Значение то же, что у фильтра этой колонки; конкретный день —
 * «date:ГГГГ-ММ-ДД».
 */
function PeriodPicker({ value, onChange }) {
  const day = String(value || '').startsWith('date:') ? value.slice(5) : '';
  const [picking, setPicking] = useState(Boolean(day));
  const selected = day || picking ? 'date' : value || '';
  return (
    <div className="flex items-center gap-2">
      <NativeSelect
        aria-label="Период"
        title="Период: плитки и список по дате последнего сообщения"
        className="w-36"
        value={selected}
        onChange={(e) => {
          const next = e.target.value;
          if (next === 'date') {
            setPicking(true);
            return;
          }
          setPicking(false);
          onChange(next);
        }}
      >
        {PERIODS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </NativeSelect>
      {selected === 'date' && (
        <Input
          type="date"
          aria-label="День"
          className="w-40"
          value={day}
          onChange={(e) => onChange(e.target.value ? `date:${e.target.value}` : '')}
        />
      )}
    </div>
  );
}

function Dashboard() {
  const [managerAgents, setManagerAgents] = useState([]);
  const [liveAgents, setLiveAgents] = useState([]);
  const [rows, setRows] = useState([]);
  const [archiveRows, setArchiveRows] = useState([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [error, setError] = useState(null);
  const [showHidden, setShowHidden] = useState(false);
  const [ready, setReady] = useState(false);
  useRouteBusy(!ready);

  // Фильтры колонок держит страница: поиск по имени и контакту тянет архив,
  // а период колонки «Последнее» пересчитывает плитки.
  const filters = useColumnFilters('dialogs');
  const [filterState, setFilter] = filters;
  const searching = isActive(filterState.who) || isActive(filterState.contact);
  const dateFilter = typeof filterState.last === 'string' ? filterState.last : '';

  const inFlight = useRef(false);
  const searchRef = useRef(searching);
  searchRef.current = searching;
  const dateRef = useRef(dateFilter);
  dateRef.current = dateFilter;
  const load = useCallback(() => {
    // Опрос раз в 10 секунд: если прошлый ещё не ответил, новый не запускаем,
    // иначе при медленном сервере запросы копятся и панель «подвисает».
    if (inFlight.current) return;
    inFlight.current = true;
    // Поиск должен находить и архивные диалоги: пока ищем, архив подтягивается
    // вместе с основным списком.
    const wantArchive = searchRef.current && !showHidden;
    Promise.all([
      getNeedManagerAssist(),
      showHidden ? getHiddenConversations() : getConversations(),
      getStats(rangeForFilter(dateRef.current)),
      showHidden ? getConversations() : null,
      wantArchive ? getHiddenConversations().catch(() => []) : null,
    ])
      .then(([queue, all, raw, visible, archive]) => {
        setLiveAgents(liveRows(visible ?? all));
        setManagerAgents(queue);
        setRows(all);
        setArchiveRows(archive ?? []);
        setStats(STAT_TILES.map((t) => ({
          id: t.key,
          label: raw?.period && t.periodLabel ? t.periodLabel : t.label,
          value: String(raw?.[t.key] ?? '—'),
        })));
      })
      .catch((e) => setError(e.detail || e.message))
      .finally(() => {
        inFlight.current = false;
        setReady(true);
      });
  }, [showHidden]);

  const changeDealStage = useCallback(
    async (chatId, stage, row) => {
      let note = '';
      if (stage === 'archive') {
        note = await PanelUX.prompt({ title: 'В архив', message: 'Почему диалог уходит в архив?', value: row?.deal_note || '', confirmLabel: 'В архив' });
        if (!note) return;
      }
      setDealStage(chatId, stage, note)
        .then(load)
        .catch((e) => {
          setError(e.detail || e.message);
          load();
        });
    },
    [load],
  );

  const [reminder, setReminder] = useState(null);
  useEffect(() => {
    if (!ready || showHidden) return;
    const r = shouldRemind(rows, moscowDay());
    setReminder(r.show ? r : null);
  }, [rows, ready, showHidden]);
  const dismissReminder = () => {
    if (reminder) rememberReminder(reminder.signature, moscowDay());
    setReminder(null);
  };

  const toggleHidden = useCallback(
    async (chatId, hidden) => {
      let request;
      if (hidden) {
        const note = await PanelUX.prompt({ title: 'В архив', message: 'Почему диалог уходит в архив?', confirmLabel: 'В архив' });
        if (!note) return;
        request = setDealStage(chatId, 'archive', note);
      } else {
        request = setConversationHidden(chatId, false);
      }
      setRows((prev) => prev.filter((r) => r.chat_id !== chatId));
      request
        .then(load)
        .catch((e) => {
          setError(e.detail || e.message);
          load();
        });
    },
    [load],
  );

  // Начали искать — сразу дотянуть архив, не дожидаясь следующего опроса.
  useEffect(() => {
    if (searching && !showHidden) load();
  }, [searching, showHidden, load]);

  // Сменили период — плитки пересчитываются сразу.
  useEffect(() => {
    load();
  }, [dateFilter, load]);

  // Первую загрузку делает эффект периода выше; здесь только опрос и возврат на вкладку.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Счётчик живых диалогов и аккаунты списка — общей шапке через контекст.
  const accounts = useMemo(
    () => [...new Set(rows.map((r) => r.account_id).filter((a) => a != null))].sort(),
    [rows],
  );
  usePublishHeaderTools({
    liveCount: liveAgents.length,
    accounts,
    accountsKey: accounts.join(','),
  });

  return (
    <div className="container">
      <PageHeader title={showHidden ? 'Архив' : 'Диалоги'}>
        <PeriodPicker value={dateFilter} onChange={(v) => setFilter('last', v)} />
        <Button type="button" variant="outline" size="sm" onClick={() => setShowHidden((v) => !v)}>
          {showHidden ? <ArrowLeft aria-hidden="true" /> : <Archive aria-hidden="true" />}
          {showHidden ? 'Вернуться к диалогам' : 'Архив'}
        </Button>
      </PageHeader>
      <div className="flex flex-col gap-4 pb-10">
        {/* Ошибка загрузки — исключительное состояние: появляется только когда она есть. */}
        {error && (
          <Alert variant="destructive" role="alert">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>Не удалось загрузить: {error}</AlertDescription>
          </Alert>
        )}
        <StatsBar stats={stats} />
        <NeedManagerAssist agents={managerAgents} loading={!ready} />
        <ConversationsTable
          ready={ready}
          rows={searching && !showHidden ? withArchive(rows, archiveRows) : rows}
          showHidden={showHidden}
          onHide={toggleHidden}
          onDealStage={changeDealStage}
          filters={filters}
          headerExtra={reminder && <StageReminder count={reminder.count} onDismiss={dismissReminder} />}
        />
      </div>
    </div>
  );
}

export default Dashboard;
