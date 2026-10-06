import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogTable } from './DialogTable';
import TableSkeleton from '../TableSkeleton/TableSkeleton';
import ClientAvatar, { ACTIVITY_LABEL } from '../ClientAvatar/ClientAvatar';
import { stageColors, stageFilters } from '../../data/stages';
import { matchesQuery, matchesHeadFilters, matchesDateFilter } from '../../utils/search';
import { accountLostLabel, presenceLabel } from '../../utils/telegramStatus';
import { nextActionLabel } from '../../utils/scenario';

function fmtTime(ts) {
  return ts ? new Date(ts * 1000).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }) : '—';
}

function fmtDate(ts) {
  return ts ? new Date(ts * 1000).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—';
}

// Двести строк в DOM и их перерисовка каждые десять секунд — лишняя работа:
// менеджер смотрит верх списка, а не весь он сразу.
const PAGE_SIZE = 50;

// Цвета стадий приходят из data/stages.js и задаются инлайном через
// --badge-color / --badge-bg — единственное место, где они не из токенов.
function StatusBadge({ stage }) {
  if (!stage?.title) {
    return <span className="inline-flex h-5 items-center text-xs text-muted-foreground">—</span>;
  }
  const cfg = stageColors(stage.index);
  return (
    <Badge
      variant="outline"
      className="h-5 max-w-full rounded-full border-(--badge-color)/30 bg-(--badge-bg) font-semibold text-(--badge-color)"
      style={{ '--badge-color': cfg.color, '--badge-bg': cfg.bg }}
      title={`этап ${stage.index} из ${stage.total}`}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
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

const PILL =
  'h-8 rounded-full font-medium text-(--pill-color) border-(--pill-color)/35 hover:bg-(--pill-color)/10 hover:text-(--pill-color) dark:border-(--pill-color)/35 dark:hover:bg-(--pill-color)/10 aria-pressed:border-(--pill-color) aria-pressed:bg-(--pill-color)/15 dark:aria-pressed:border-(--pill-color) dark:aria-pressed:bg-(--pill-color)/15';

function FilterPill({ color, active, className, children, ...props }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={active}
      style={{ '--pill-color': color }}
      className={cn(PILL, className)}
      {...props}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </Button>
  );
}

function ConversationsTable({
  ready = true,
  rows = [],
  query = '',
  headFilters = { lead: '', account: '' },
  dateFilter = '',
  showHidden = false,
  onToggleShowHidden = null,
  onHide = null,
  onDealStage = null,
}) {
  const [activeFilter, setActiveFilter] = useState(null);
  const [onlyNew, setOnlyNew] = useState(false);
  const [page, setPage] = useState(1);
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

  const total = rows.total ?? rows.length;
  const truncated = total > rows.length;
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Условия отбора сменились — показываем сначала, иначе можно застрять на
  // странице, которой больше нет.
  useEffect(() => {
    setPage(1);
    // Зависимости — только значения: объект фильтров пересоздаётся на каждой
    // отрисовке, и по нему страница сбрасывалась бы сразу после переключения.
  }, [query, headFilters.lead, headFilters.account, dateFilter, activeFilter, onlyNew, showHidden]);
  const current = Math.min(page, pages);
  const visible = useMemo(
    () => sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    [sorted, current],
  );

  return (
    <section className="pt-7 pb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="h-5 w-0.5 shrink-0 rounded-full bg-primary" />
          <h2 className="text-[15px] font-bold">{showHidden ? 'Архив' : 'Мои диалоги'}</h2>
          <Button
            type="button"
            variant={activeFilter ? 'secondary' : 'outline'}
            size="xs"
            className={cn('h-6 px-2 font-mono text-[11px] font-normal tabular-nums', !activeFilter && 'cursor-default text-muted-foreground')}
            onClick={() => setActiveFilter(null)}
            title={activeFilter ? 'Reset filter' : undefined}
          >
            {filtered.length === rows.length
              ? `ВСЕГО: ${total}${truncated ? ` · показаны последние ${rows.length}` : ''}`
              : `НАЙДЕНО: ${filtered.length} из ${rows.length}`}
          </Button>
        </div>

        <div className="flex min-h-[26px] min-w-0 max-w-full flex-wrap gap-1.5">
          {onToggleShowHidden && (
            <FilterPill
              color="var(--muted-foreground)"
              active={showHidden}
              onClick={() => onToggleShowHidden(!showHidden)}
            >
              {showHidden ? 'Вернуться к диалогам' : 'Архив'}
            </FilterPill>
          )}
          {(newCount > 0 || onlyNew) && (
            <FilterPill
              color="var(--primary)"
              active={onlyNew}
              className="font-semibold"
              onClick={() => setOnlyNew((v) => !v)}
              title="Чаты на ручном режиме, где клиент написал, а переписку ещё не открывали"
              data-testid="filter-new"
            >
              Новые на ручном · {newCount}
            </FilterPill>
          )}
          {stageFilters(rows).map((f) => (
            <FilterPill
              key={f.key}
              color={f.color}
              active={activeFilter === f.key}
              onClick={() => setActiveFilter(activeFilter === f.key ? null : f.key)}
            >
              {f.label}
            </FilterPill>
          ))}
        </div>
      </div>

      <div className="min-h-[200px]">
        {!ready && rows.length === 0 && <TableSkeleton rows={8} label="Загружаем диалоги…" />}

        {(ready || rows.length > 0) && <DialogTable rows={visible} totalRows={rows.length} archived={showHidden}
          sort={sort} onSort={handleSort} setSort={setSort}
          onOpen={id => navigate(`/conversation/${id}`)} onHide={onHide} onDealStage={onDealStage}
          helpers={{ Avatar: ClientAvatar, Stage: StatusBadge, isNew: waitsForManager,
            unreadLabel: newLabel, presence: presenceLabel, nextAction: nextActionLabel,
            time: fmtTime, date: fmtDate, accountLost: accountLostLabel, typingLabels: ACTIVITY_LABEL }} />}
      </div>

      {pages > 1 && (
        <nav className="flex items-center justify-center gap-3 pt-3.5 pb-1" aria-label="Страницы диалогов">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage(current - 1)}
            disabled={current === 1}
          >
            Назад
          </Button>
          <span className="min-w-32 text-center font-mono text-xs tabular-nums text-muted-foreground" role="status">
            {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, sorted.length)} из {sorted.length}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage(current + 1)}
            disabled={current === pages}
          >
            Вперёд
          </Button>
        </nav>
      )}
    </section>
  );
}

export default ConversationsTable;
