import { DialogTable } from '../../ui/ManagerRegion';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './ConversationsTable.module.scss';
import { stageColors, stageFilters } from '../../data/stages';
import { matchesQuery, matchesHeadFilters, matchesDateFilter } from '../../utils/search';

function fmtTime(ts) {
  return ts ? new Date(ts * 1000).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }) : '—';
}

function fmtDate(ts) {
  return ts ? new Date(ts * 1000).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—';
}
import ClientAvatar, { ACTIVITY_LABEL } from '../ClientAvatar/ClientAvatar';
import { accountLostLabel, presenceLabel } from '../../utils/telegramStatus';
import { nextActionLabel } from '../../utils/scenario';

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

function ConversationsTable({
  rows = [],
  query = '',
  headFilters = { lead: '', account: '' },
  dateFilter = '',
  showHidden = false,
  onToggleShowHidden = null,
  onHide = null,
}) {
  const [activeFilter, setActiveFilter] = useState(null);
  const [onlyNew, setOnlyNew] = useState(false);
  const newCount = rows.filter(waitsForManager).length;
  const [sort, setSort] = useState({ col: null, dir: 'asc' });
  const navigate = useNavigate();

  function handleSort(col) {
    setSort(prev =>
      prev.col === col
        ? prev.dir === 'asc' ? { col, dir: 'desc' } : { col: null, dir: 'asc' }
        : { col, dir: 'asc' },
    );
  }

  const filtered = rows.filter(
    (c) =>
      (!activeFilter || c.stage?.id === activeFilter) &&
      (!onlyNew || waitsForManager(c)) &&
      matchesQuery(c, query) &&
      matchesHeadFilters(c, headFilters) &&
      matchesDateFilter(c, dateFilter),
  );

  const sorted = sort.col
    ? [...filtered].sort((a, b) => {
      const aVal = sort.col === 'name' ? (a.name || '')
        : sort.col === 'status' ? (a.stage?.index ?? 0)
          : (a.last_message_ts || 0);
      const bVal = sort.col === 'name' ? (b.name || '')
        : sort.col === 'status' ? (b.stage?.index ?? 0)
          : (b.last_message_ts || 0);
      if (aVal < bVal) {
        return sort.dir === 'asc' ? -1 : 1;
      }
      if (aVal > bVal) {
        return sort.dir === 'asc' ? 1 : -1;
      }
      return 0;
    })
    : filtered;

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.accent}></span>
          <h2 className={styles.title}>{showHidden ? 'Архив' : 'Мои диалоги'}</h2>
          <button
            className={`${styles.total} ${activeFilter ? styles.totalActive : ''}`}
            onClick={() => setActiveFilter(null)}
            title={activeFilter ? 'Reset filter' : undefined}
          >
            {filtered.length === rows.length
              ? `ВСЕГО: ${rows.length}`
              : `НАЙДЕНО: ${filtered.length} из ${rows.length}`}
          </button>
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
          {stageFilters(rows).map((f) => (
            <button
              key={f.key}
              className={`${styles.filterPill} ${activeFilter === f.key ? styles.filterPillActive : ''}`}
              style={{ '--pill-color': f.color }}
              onClick={() => setActiveFilter(activeFilter === f.key ? null : f.key)}
            >
              <span className={styles.filterDot}></span>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <DialogTable rows={sorted} totalRows={rows.length} archived={showHidden}
        sort={sort} onSort={handleSort} setSort={setSort}
        onOpen={id => navigate(`/conversation/${id}`)} onHide={onHide}
        helpers={{ Avatar: ClientAvatar, Stage: StatusBadge, isNew: waitsForManager,
          unreadLabel: newLabel, presence: presenceLabel, nextAction: nextActionLabel,
          time: fmtTime, date: fmtDate, accountLost: accountLostLabel, typingLabels: ACTIVITY_LABEL }} />
    </section>
  );
}

export default ConversationsTable;
