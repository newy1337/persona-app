import { DialogTable } from '../../ui/ManagerRegion';
import TableSkeleton from '../TableSkeleton/TableSkeleton';
import ExportButton from './ExportButton';
import { useEffect, useRef, useState } from 'react';
import { useViewState, rememberDialogOrder } from '../../utils/viewState';
import { SearchIcon } from '../../assets/icons';
import { useNavigate } from 'react-router-dom';
import styles from './ConversationsTable.module.scss';
import { stageColors } from '../../data/stages';
import { getConversationPage } from '../../api/conversations';
import { rangeForFilter } from '../../utils/panelTime';
import { DEAL_STAGE_COLORS, DEAL_STAGE_FILTERS } from '../../data/dealStages';
import { CHANNEL_FILTERS } from '../../utils/channel';

function fmtTime(ts) {
  return ts ? new Date(ts * 1000).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }) : '—';
}

function fmtDate(ts) {
  return ts ? new Date(ts * 1000).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—';
}
import ClientAvatar, { ACTIVITY_LABEL } from '../ClientAvatar/ClientAvatar';
import { accountLostLabel, presenceLabel } from '../../utils/telegramStatus';
import { nextActionLabel } from '../../utils/scenario';

// Двести строк в DOM и их перерисовка каждые десять секунд — лишняя работа:
// менеджер смотрит верх списка, а не весь он сразу.
const PAGE_SIZE = 50;

function StatusBadge({ stage }) {
  if (!stage?.title) {
    return <span className={styles.statusEmpty}>—</span>;
  }
  const cfg = stageColors(stage.index);
  return (
    <span
      className={styles.badge}
      style={{ '--badge-color': cfg.color, '--badge-bg': cfg.bg }}
      title={`этап ${stage.index} из ${stage.total}`}
    >
      <span className={styles.badgeDot}></span>
      {stage.title}
    </span>
  );
}

export const waitsForManager = (row) => Boolean(row.is_paused) && (row.unread_count ?? 0) > 0;

export function newLabel(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'новое' : 'новых';
  return `${n} ${word}`;
}

/** Сортировка таблицы → параметры сервера: «время» там называется last. */
const SORT_PARAM = { name: 'name', status: 'status', time: 'last' };

/**
 * Список диалогов. Отбор, сортировка, страницы и счётчики фильтров считает
 * сервер по всем чатам — в браузере только текущая страница. reloadKey
 * меняется при каждом опросе дашборда: страница обновляется вместе с ним.
 */
function ConversationsTable({
  ready: parentReady = true,
  query = '',
  onQueryChange = null,
  headFilters = { lead: '', account: '' },
  dateFilter = '',
  showHidden = false,
  onToggleShowHidden = null,
  onHide = null,
  onDealStage = null,
  reloadKey = 0,
  onFacets = null,
}) {
  // Фильтры, сортировка и страница помнятся: вышли из чата — таблица та же.
  const [activeFilter, setActiveFilter] = useViewState('table.stage', null);
  const [dealStage, setDealStage] = useViewState('table.deal', null);
  const [onlyNew, setOnlyNew] = useViewState('table.new', false);
  const [channel, setChannel] = useViewState('table.channel', 'all');
  const [page, setPage] = useViewState('table.page', 1);
  const [sort, setSort] = useViewState('table.sort', { col: null, dir: 'asc' });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  function handleSort(col) {
    setSort(prev =>
      prev.col === col
        ? prev.dir === 'asc' ? { col, dir: 'desc' } : { col: null, dir: 'asc' }
        : { col, dir: 'asc' },
    );
  }

  // Условия отбора сменились — показываем сначала, иначе можно застрять на
  // странице, которой больше нет. Сравнение с прошлым отбором, а не каждый
  // запуск эффекта: при возврате из чата сохранённая страница не сбрасывается.
  const selection = JSON.stringify([query, headFilters.lead, headFilters.account, dateFilter, activeFilter, dealStage, onlyNew, showHidden, channel]);
  const lastSelection = useRef(selection);
  useEffect(() => {
    if (lastSelection.current === selection) return;
    lastSelection.current = selection;
    setPage(1);
  }, [selection, setPage]);

  const range = rangeForFilter(dateFilter);
  const params = {
    page,
    size: PAGE_SIZE,
    q: query.trim(),
    channel: channel === 'all' ? '' : channel,
    deal: dealStage,
    stage: activeFilter,
    new: onlyNew,
    lead: headFilters.lead,
    account: headFilters.account,
    from: range.from,
    to: range.to,
    sort: sort.col ? SORT_PARAM[sort.col] : '',
    dir: sort.col ? sort.dir : '',
    archive: showHidden,
  };
  const paramsKey = JSON.stringify(params);
  const onFacetsRef = useRef(onFacets);
  onFacetsRef.current = onFacets;
  useEffect(() => {
    let alive = true;
    getConversationPage(JSON.parse(paramsKey))
      .then((r) => {
        if (!alive) return;
        setData(r);
        setError(null);
        onFacetsRef.current?.(r.facets, showHidden);
      })
      .catch((e) => alive && setError(e.detail || e.message));
    return () => { alive = false; };
  }, [paramsKey, reloadKey, showHidden]);

  // Сервер мог ужать номер страницы (стало меньше чатов) — запоминаем его.
  useEffect(() => {
    if (data && data.page !== page) setPage(data.page);
  }, [data, page, setPage]);

  // Чат, открытый из списка, листает тот же список: с фильтрами и сортировкой.
  const orderKey = (data?.order ?? []).join(',');
  useEffect(() => {
    if (data) rememberDialogOrder(orderKey ? orderKey.split(',') : []);
  }, [orderKey, data]);

  const ready = parentReady && data !== null;
  const rows = data?.items ?? [];
  const facets = data?.facets;
  const all = data?.all ?? 0;
  const found = data?.total ?? 0;
  const pages = data?.pages ?? 1;
  const current = data?.page ?? 1;
  const filteredView = found !== all;
  const newCount = facets?.new ?? 0;
  const channelCounts = CHANNEL_FILTERS.map(([key, label]) => [key, label, facets?.channel?.[key] ?? 0]);
  // Фильтр канала — когда в списке больше одного мессенджера (или он уже выбран).
  const multiChannel = channelCounts.filter(([key, , n]) => key !== 'all' && n > 0).length > 1 || channel !== 'all';
  const stageButtons = (facets?.stages ?? []).map((st) => ({ key: st.id, label: st.title, color: stageColors(st.index).color, count: st.count }));

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.accent}></span>
          <h2 className={styles.title}>{showHidden ? 'Архив' : 'Мои диалоги'}</h2>
          <button
            className={`${styles.total} ${activeFilter || dealStage ? styles.totalActive : ''}`}
            data-testid="dialogs-total"
            onClick={() => { setActiveFilter(null); setDealStage(null); }}
            title={activeFilter || dealStage ? 'Сбросить фильтры' : undefined}
          >
            {filteredView ? `НАЙДЕНО: ${found} из ${all}` : `ВСЕГО: ${all}`}
          </button>
          <ExportButton chatIds={data?.order ?? []} />
        </div>

        <div className={styles.filters}>
          {onToggleShowHidden && (
            <button
              className={`${styles.filterPill} ${showHidden ? styles.filterPillActive : ''}`}
              style={{ '--pill-color': '#6B7A99' }}
              onClick={() => onToggleShowHidden(!showHidden)}
            >
              <span className={styles.filterDot}></span>
              {showHidden ? 'Вернуться к диалогам' : 'Архив'}
            </button>
          )}
          {(newCount > 0 || onlyNew) && (
            <button
              className={`${styles.filterPill} ${onlyNew ? styles.filterPillActive : ''} ${styles.newPill}`}
              style={{ '--pill-color': '#00d4ff' }}
              onClick={() => setOnlyNew((v) => !v)}
              title="Чаты на ручном режиме, где клиент написал, а переписку ещё не открывали"
              data-testid="filter-new"
            >
              <span className={styles.filterDot}></span>
              Новые на ручном · {newCount}
            </button>
          )}
          {stageButtons.map((f) => (
            <button
              key={f.key}
              className={`${styles.filterPill} ${activeFilter === f.key ? styles.filterPillActive : ''}`}
              style={{ '--pill-color': f.color }}
              onClick={() => setActiveFilter(activeFilter === f.key ? null : f.key)}
            >
              <span className={styles.filterDot}></span>
              {f.label} · {f.count}
            </button>
          ))}
        </div>
        {multiChannel && (
          <div className={styles.filters} data-testid="channel-filters" role="radiogroup" aria-label="Канал">
            <span className={styles.filtersLabel}>Канал:</span>
            {channelCounts.map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={channel === key}
                data-channel={key === 'all' ? undefined : key}
                className={`${styles.filterPill} ${channel === key ? styles.filterPillActive : ''}`}
                style={{ '--pill-color': key === 'vk' ? '#4c75a3' : key === 'tg' ? '#29a9eb' : '#6B7A99' }}
                onClick={() => setChannel(key)}
              >
                <span className={styles.filterDot}></span>
                {label} · {n}
              </button>
            ))}
          </div>
        )}
        <div className={styles.filters} data-testid="deal-stage-filters" aria-label="Этап сделки">
          <span className={styles.filtersLabel}>Этап:</span>
          {DEAL_STAGE_FILTERS.map((st) => {
            const count = facets?.deal?.[st.id] ?? 0;
            if (!count && dealStage !== st.id) return null;
            return (
              <button
                key={st.id}
                className={`${styles.filterPill} ${dealStage === st.id ? styles.filterPillActive : ''}`}
                style={{ '--pill-color': DEAL_STAGE_COLORS[st.id] }}
                onClick={() => setDealStage(dealStage === st.id ? null : st.id)}
                aria-pressed={dealStage === st.id}
              >
                <span className={styles.filterDot}></span>
                {st.label} · {count}
              </button>
            );
          })}
          {/* Поиск — у самого списка, рядом с фильтрами; ищет и по карточкам выше. */}
          {onQueryChange && (
            <label className={styles.search}>
              <span className={styles.searchIcon}><SearchIcon /></span>
              <input
                className={styles.searchInput}
                type="search"
                placeholder="Имя, @ник, номер, город, chat_id…"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                aria-label="Поиск по диалогам"
              />
            </label>
          )}
        </div>
      </div>

      {error && <div className="loadError" role="alert">Не удалось загрузить список: {error}</div>}
      {!ready && rows.length === 0 && <TableSkeleton rows={8} label="Загружаем диалоги…" />}

      {(ready || rows.length > 0) && <DialogTable rows={rows} totalRows={found} archived={showHidden}
        sort={sort} onSort={handleSort} setSort={setSort}
        onOpen={id => navigate(`/conversation/${id}`)} onHide={onHide} onDealStage={onDealStage}
        helpers={{ Avatar: ClientAvatar, Stage: StatusBadge, isNew: waitsForManager,
          unreadLabel: newLabel, presence: presenceLabel, nextAction: nextActionLabel,
          time: fmtTime, date: fmtDate, accountLost: accountLostLabel, typingLabels: ACTIVITY_LABEL }} />}

      {pages > 1 && (
        <nav className={styles.pager} aria-label="Страницы диалогов">
          <button
            className={styles.pagerButton}
            onClick={() => setPage(current - 1)}
            disabled={current === 1}
          >
            Назад
          </button>
          <span className={styles.pagerLabel} role="status">
            {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, found)} из {found}
          </span>
          <button
            className={styles.pagerButton}
            onClick={() => setPage(current + 1)}
            disabled={current === pages}
          >
            Вперёд
          </button>
        </nav>
      )}
    </section>
  );
}

export default ConversationsTable;
