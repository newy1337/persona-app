import { useCallback, useState, useEffect } from 'react';
import { Archive, ArrowLeft, CircleAlert, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useRouteBusy } from '../components/AppLayout/routeBusy';
import { PageHeader } from '../components/PageHeader/PageHeader';
import NeedManagerAssist from '../components/NeedManagerAssist/NeedManagerAssist';
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

function Dashboard() {
  const [managerAgents, setManagerAgents] = useState([]);
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [error, setError] = useState(null);
  const [showHidden, setShowHidden] = useState(false);
  const [ready, setReady] = useState(false);
  useRouteBusy(!ready);

  const load = useCallback(() => {
    Promise.all([
      getNeedManagerAssist(),
      showHidden ? getHiddenConversations() : getConversations(),
      getStats(),
    ])
      .then(([queue, all, raw]) => {
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
    <div className="container">
      <PageHeader title={showHidden ? 'Архив' : 'Диалоги'}>
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
          rows={rows}
          showHidden={showHidden}
          onHide={toggleHidden}
          onDealStage={changeDealStage}
          headerExtra={reminder && <StageReminder count={reminder.count} onDismiss={dismissReminder} />}
        />
      </div>
    </div>
  );
}

export default Dashboard;
