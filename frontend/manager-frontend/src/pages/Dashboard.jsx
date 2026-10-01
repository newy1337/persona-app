import { useCallback, useState, useEffect } from 'react';
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
} from '../api/conversations';
import { getStats } from '../api/stats';
import { liveRows } from '../utils/chat';

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
        setStats(STAT_TILES.map((t) => ({ id: t.key, label: t.label, color: t.color, value: String(raw?.[t.key] ?? '—') })));
      })
      .catch((e) => setError(e.detail || e.message))
      .finally(() => setReady(true));
  }, [showHidden]);

  const toggleHidden = useCallback(
    (chatId, hidden) => {
      setRows((prev) => prev.filter((r) => r.chat_id !== chatId));
      setConversationHidden(chatId, hidden)
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
          />
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
