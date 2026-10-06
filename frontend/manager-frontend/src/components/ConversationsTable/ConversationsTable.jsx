import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogTable } from './DialogTable';
import TableSkeleton from '../TableSkeleton/TableSkeleton';
import ClientAvatar, { ACTIVITY_LABEL } from '../ClientAvatar/ClientAvatar';
import { Pager } from '../Pager/Pager';
import { StageTabs } from '../StageTabs/StageTabs';
import { stageColors, stageFilters } from '../../data/stages';
import { matchesQuery, matchesHeadFilters } from '../../utils/search';
import { accountLostLabel, presenceLabel } from '../../utils/telegramStatus';
import { nextActionLabel } from '../../utils/scenario';

function fmtTime(ts) {
  return ts ? new Date(ts * 1000).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }) : '—';
}

function fmtDate(ts) {
  return ts ? new Date(ts * 1000).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—';
}

// Сотни строк в DOM и их перерисовка каждые десять секунд — лишняя работа:
// менеджер смотрит верх списка, а не весь он сразу.
export const PAGE_SIZES = [25, 50, 100];
const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

// Цвет стадии приходит из data/stages.js и живёт только в точке 6px —
// единственное место, где цвет задаётся инлайном, а не токеном.
function StatusBadge({ stage }) {
  if (!stage?.title) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <Badge
      variant="outline"
      className="min-w-0 shrink font-normal"
      title={`${stage.title} · этап ${stage.index} из ${stage.total}`}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: stageColors(stage.index).color }}
      />
      <span className="truncate">{stage.title}</span>
    </Badge>
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
  ready = true,
  rows = [],
  query = '',
  headFilters = { lead: '', account: '' },
  onlyNew = false,
  showHidden = false,
  onHide = null,
  onDealStage = null,
  headerExtra = null,
}) {
  const [activeFilter, setActiveFilter] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
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
      matchesHeadFilters(c, headFilters),
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

  const total = rows.total ?? rows.length;
  const truncated = total > rows.length;
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  // Условия отбора сменились — показываем сначала, иначе можно застрять на
  // странице, которой больше нет.
  useEffect(() => {
    setPage(1);
    // Зависимости — только значения: объект фильтров пересоздаётся на каждой
    // отрисовке, и по нему страница сбрасывалась бы сразу после переключения.
  }, [query, headFilters.lead, headFilters.account, activeFilter, onlyNew, showHidden, pageSize]);
  const current = Math.min(page, pages);
  const visible = useMemo(
    () => sorted.slice((current - 1) * pageSize, current * pageSize),
    [sorted, current, pageSize],
  );

  const loading = !ready && rows.length === 0;
  const stageItems = useMemo(() => {
    const counts = new Map();
    for (const row of rows) {
      const id = row.stage?.id;
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [
      { key: '', label: 'Все', count: loading ? null : rows.length },
      ...stageFilters(rows).map((f) => ({ key: f.key, label: f.label, count: counts.get(f.key) || 0, hint: f.label })),
    ];
  }, [rows, loading]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="text-sm font-medium">{showHidden ? 'Архив' : 'Мои диалоги'}</h2>
        {/* Одна и та же кнопка в обоих состояниях: без фильтра по стадии она
            выглядит обычным текстом, с фильтром — сбрасывает его. */}
        <Button
          type="button"
          variant={activeFilter ? 'secondary' : 'ghost'}
          size="xs"
          className="min-w-20 justify-start font-normal tabular-nums text-muted-foreground disabled:opacity-100"
          disabled={!activeFilter}
          onClick={() => setActiveFilter(null)}
          title={activeFilter ? 'Сбросить фильтр по стадии' : undefined}
        >
          {filtered.length === rows.length
            ? `ВСЕГО: ${total}${truncated ? ` · показаны последние ${rows.length}` : ''}`
            : `НАЙДЕНО: ${filtered.length} из ${rows.length}`}
        </Button>
        {headerExtra && <div className="ml-auto flex min-w-0 items-center">{headerExtra}</div>}
      </div>

      <StageTabs
        aria-label="Стадии диалогов"
        items={stageItems}
        value={activeFilter ?? ''}
        onChange={(key) => setActiveFilter(key && key !== activeFilter ? key : null)}
        total={rows.length}
      />

      {loading ? (
        <TableSkeleton rows={8} label="Загружаем диалоги…" />
      ) : (
        <DialogTable
          rows={visible}
          totalRows={rows.length}
          archived={showHidden}
          sort={sort}
          onSort={handleSort}
          onOpen={(id) => navigate(`/conversation/${id}`)}
          onHide={onHide}
          onDealStage={onDealStage}
          helpers={{
            Avatar: ClientAvatar,
            Stage: StatusBadge,
            isNew: waitsForManager,
            unreadLabel: newLabel,
            presence: presenceLabel,
            nextAction: nextActionLabel,
            time: fmtTime,
            date: fmtDate,
            accountLost: accountLostLabel,
            typingLabels: ACTIVITY_LABEL,
          }}
        />
      )}

      {loading ? (
        <div className="min-h-8" />
      ) : (
        <Pager
          label="Страницы диалогов"
          page={current}
          pageSize={pageSize}
          total={sorted.length}
          onPage={setPage}
          pageSizes={PAGE_SIZES}
          onPageSize={setPageSize}
        />
      )}
    </section>
  );
}

export default ConversationsTable;
