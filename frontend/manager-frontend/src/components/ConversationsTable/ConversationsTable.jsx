import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogTable } from './DialogTable';
import TableSkeleton from '../TableSkeleton/TableSkeleton';
import ClientAvatar, { ACTIVITY_LABEL } from '../ClientAvatar/ClientAvatar';
import { Pager } from '../Pager/Pager';
import { FilterChips } from '../ColumnFilter/FilterChips';
import { applyFilters, isActive } from '../ColumnFilter/filters';
import { useColumnFilters } from '../ColumnFilter/useColumnFilters';
import { stageColors } from '../../data/stages';
import { accountLostLabel, presenceLabel } from '../../utils/telegramStatus';
import { nextActionLabel } from '../../utils/scenario';
import { dialogFilterDefs, useDialogColumnList, waitsForManager } from './rowLayout';

export { waitsForManager };

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

export function newLabel(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'новое' : 'новых';
  return `${n} ${word}`;
}

function ConversationsTable({
  ready = true,
  rows = [],
  showHidden = false,
  onHide = null,
  onDealStage = null,
  headerExtra = null,
}) {
  const [filterState, setFilter, resetFilters] = useColumnFilters('dialogs');
  const columnList = useDialogColumnList();
  // Названия стадий, которые уже встречались: выбранная стадия остаётся
  // подписанной и после того, как её строки ушли из списка.
  const [seenStages] = useState(() => new Map());
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

  // Фильтры строятся по всем строкам списка и по всем доступным колонкам —
  // скрытая в настройке полей колонка продолжает фильтровать.
  const filterDefs = useMemo(
    () => dialogFilterDefs(rows, filterState, columnList, seenStages),
    [rows, filterState, columnList, seenStages],
  );
  const filterColumns = useMemo(
    () => columnList.filter((col) => filterDefs[col.key]).map((col) => ({ ...col, filter: filterDefs[col.key] })),
    [columnList, filterDefs],
  );
  // Значение для колонки, которой у пользователя нет (например, осталось от
  // админа в этой же вкладке), фильтром не считается.
  const filterKey = filterColumns
    .filter((col) => isActive(filterState[col.key]))
    .map((col) => `${col.key}=${JSON.stringify(filterState[col.key])}`)
    .join('&');
  const hasFilters = filterKey !== '';
  const filtered = applyFilters(rows, filterDefs, filterState);

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
    // Зависимость — строка с заданными фильтрами, а не их объект: опрос
    // списка страницу не сбрасывает.
  }, [filterKey, showHidden, pageSize]);
  const current = Math.min(page, pages);
  const visible = useMemo(
    () => sorted.slice((current - 1) * pageSize, current * pageSize),
    [sorted, current, pageSize],
  );

  const loading = !ready && rows.length === 0;

  return (
    <section className="flex flex-col gap-3">
      {/* Строка не переносится: плашки фильтров прокручиваются внутри своего места,
          напоминание обрезается — таблица под ней не сдвигается ни на какой ширине. */}
      <div className="flex h-8 min-w-0 items-center gap-2">
        <h2 className="shrink-0 text-sm font-medium">{showHidden ? 'Архив' : 'Мои диалоги'}</h2>
        {/* Одна и та же кнопка в обоих состояниях: без фильтров она выглядит
            обычным текстом, с фильтрами — сбрасывает их все. */}
        <Button
          type="button"
          variant={hasFilters ? 'secondary' : 'ghost'}
          size="xs"
          className="min-w-20 shrink-0 justify-start font-normal tabular-nums text-muted-foreground disabled:opacity-100"
          disabled={!hasFilters}
          onClick={resetFilters}
          title={hasFilters ? 'Сбросить все фильтры' : undefined}
        >
          {hasFilters
            ? `НАЙДЕНО: ${filtered.length} из ${rows.length}`
            : `ВСЕГО: ${total}${truncated ? ` · показаны последние ${rows.length}` : ''}`}
        </Button>
        <FilterChips
          className="min-w-0 flex-1 flex-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0"
          columns={filterColumns}
          state={filterState}
          onChange={setFilter}
          onReset={resetFilters}
        />
        {headerExtra && <div className="ml-auto flex max-w-[55%] min-w-0 shrink items-center">{headerExtra}</div>}
      </div>

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
          filters={{ defs: filterDefs, state: filterState, onChange: setFilter }}
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
