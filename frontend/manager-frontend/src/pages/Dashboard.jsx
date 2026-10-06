import { useCallback, useState, useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import Header from '../components/Header/Header';
import NeedManagerAssist from '../components/NeedManagerAssist/NeedManagerAssist';
import LiveConversations from '../components/LiveConversations/LiveConversations';
import StatsBar from '../components/StatsBar/StatsBar';
import ConversationsTable from '../components/ConversationsTable/ConversationsTable';
import {
  getConversations,
  getHiddenConversations,
  getNeedManagerAssist,
  setConversationHidden,
  setDealStage,
} from '../api/conversations';
import { getStats } from '../api/stats';
import { liveRows } from '../utils/chat';
import { moscowDay } from '../utils/panelTime';
import { rememberReminder, shouldRemind } from '../utils/stageReminder';

const STAT_TILES = [
  { key: 'need_manager', label: 'Ждут менеджера' },
  { key: 'total', label: 'Всего диалогов' },
  { key: 'active_now', label: 'Активны сейчас' },
  { key: 'leads', label: 'Лидов оформлено' },
  { key: 'accounts', label: 'Мои аккаунты' },
];

// Подписи плиток известны заранее: рисуем их сразу, значения до первого
// ответа — null, StatsBar ставит на их место Skeleton той же высоты.
const EMPTY_STATS = STAT_TILES.map((t) => ({ id: t.key, label: t.label, value: null }));

const POLL_MS = 10000;

function Dashboard() {
  const [liveAgents, setLiveAgents] = useState([]);
  const [managerAgents, setManagerAgents] = useState([]);
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [headFilters, setHeadFilters] = useState({ lead: '', account: '' });
  const [dateFilter, setDateFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [ready, setReady] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      getNeedManagerAssist(),
      showHidden ? getHiddenConversations() : getConversations(),
      getStats(),
      showHidden ? getConversations() : null,
    ])
      .then(([queue, all, raw, visible]) => {
        setLiveAgents(liveRows(visible ?? all));
        setManagerAgents(queue);
        setRows(all);
        setStats(STAT_TILES.map((t) => ({ id: t.key, label: t.label, value: String(raw?.[t.key] ?? '—') })));
      })
      .catch((e) => setError(e.detail || e.message))
      .finally(() => setReady(true));
  }, [showHidden]);

  const changeDealStage = useCallback(
    (chatId, stage, row) => {
      let note = '';
      if (stage === 'archive') {
        note = window.prompt('Почему в архив?', row?.deal_note || '');
        if (note == null || !note.trim()) return;
        note = note.trim();
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
    (chatId, hidden) => {
      let request;
      if (hidden) {
        const note = window.prompt('Почему в архив?', '');
        if (note == null || !note.trim()) return;
        request = setDealStage(chatId, 'archive', note.trim());
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

  useEffect(() => {
    load();
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

  return (
    <div className="app">
      <Header
        liveCount={liveAgents.length}
        query={query}
        onQueryChange={setQuery}
        filters={headFilters}
        onFiltersChange={setHeadFilters}
        accounts={[...new Set(rows.map((r) => r.account_id).filter((a) => a != null))].sort()}
      />
      <main className="main">
        <div className="container">
          {/* Слоты под ошибку и напоминание держат высоту, чтобы страница не прыгала. */}
          <div className="mt-4 min-h-[50px]">
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>Не удалось загрузить: {error}</AlertDescription>
              </Alert>
            )}
          </div>
          <StatsBar stats={stats} dateFilter={dateFilter} onDateFilterChange={setDateFilter} />
          <div className="mt-3 min-h-[50px]">
            {reminder && (
              <Alert
                variant="warning"
                role="status"
                data-testid="stage-reminder"
                className="flex items-center justify-between gap-3 py-2"
              >
                <span>В {reminder.count} {reminder.count === 1 ? 'диалоге' : reminder.count < 5 ? 'диалогах' : 'диалогах'} не указан этап — выберите его в колонке «Стадия и режим».</span>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={dismissReminder} aria-label="Скрыть напоминание">Понятно</Button>
              </Alert>
            )}
          </div>
          <NeedManagerAssist agents={managerAgents} query={query} headFilters={headFilters} dateFilter={dateFilter} />
          <LiveConversations agents={liveAgents} query={query} headFilters={headFilters} dateFilter={dateFilter} />
          <ConversationsTable
            ready={ready}
            rows={rows}
            query={query}
            headFilters={headFilters}
            dateFilter={dateFilter}
            showHidden={showHidden}
            onToggleShowHidden={setShowHidden}
            onHide={toggleHidden}
            onDealStage={changeDealStage}
          />
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
