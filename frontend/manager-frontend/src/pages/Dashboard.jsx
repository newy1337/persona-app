import { useCallback, useState, useEffect, useRef } from 'react';
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
  { key: 'need_manager', label: 'Ждут менеджера', color: '#00D4FF' },
  { key: 'total', label: 'Всего диалогов', color: '#10B981' },
  { key: 'active_now', label: 'Активны сейчас', color: '#A78BFA' },
  { key: 'leads', label: 'Лидов оформлено', color: '#F59E0B' },
  { key: 'accounts', label: 'Мои аккаунты', color: '#4A9EFF' },
];

const POLL_MS = 10000;

function Dashboard() {
  const [liveAgents, setLiveAgents] = useState([]);
  const [managerAgents, setManagerAgents] = useState([]);
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [headFilters, setHeadFilters] = useState({ lead: '', account: '' });
  const [dateFilter, setDateFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [ready, setReady] = useState(false);

  const inFlight = useRef(false);
  const load = useCallback(() => {
    // Опрос раз в 5 секунд: если прошлый ещё не ответил, новый не запускаем,
    // иначе при медленном сервере запросы копятся и панель «подвисает».
    if (inFlight.current) return;
    inFlight.current = true;
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
        setStats(STAT_TILES.map((t) => ({ id: t.key, label: t.label, color: t.color, value: String(raw?.[t.key] ?? '—') })));
      })
      .catch((e) => setError(e.detail || e.message))
      .finally(() => {
        inFlight.current = false;
        setReady(true);
      });
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
          {error && <div className="loadError">Не удалось загрузить: {error}</div>}
          {reminder && (
            <div className="stageReminder" role="status" data-testid="stage-reminder">
              <span>В {reminder.count} {reminder.count === 1 ? 'диалоге' : reminder.count < 5 ? 'диалогах' : 'диалогах'} не указан этап — выберите его в колонке «Стадия и режим».</span>
              <button type="button" onClick={dismissReminder} aria-label="Скрыть напоминание">Понятно</button>
            </div>
          )}
          <NeedManagerAssist agents={managerAgents} query={query} headFilters={headFilters} dateFilter={dateFilter} />
          <LiveConversations agents={liveAgents} query={query} headFilters={headFilters} dateFilter={dateFilter} />
          <StatsBar stats={stats} dateFilter={dateFilter} onDateFilterChange={setDateFilter} />
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
