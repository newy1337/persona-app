import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogTable } from './DialogTable';
import { useChatWatch } from '../ChatWatch/chatWatch';
import { useHotkeys } from '../Hotkeys/hotkeys';
import TableSkeleton from '../TableSkeleton/TableSkeleton';
import ClientAvatar, { ACTIVITY_LABEL } from '../ClientAvatar/ClientAvatar';
import { Pager } from '../Pager/Pager';
import { FilterChips } from '../ColumnFilter/FilterChips';
import { SavedFilters } from '../ColumnFilter/SavedFilters';
import { applyFilters, isActive } from '../ColumnFilter/filters';
import { useColumnFilters } from '../ColumnFilter/useColumnFilters';
import { stageColors } from '../../data/stages';
import { accountLostLabel, presenceLabel } from '../../utils/telegramStatus';
import { nextActionLabel } from '../../utils/scenario';
import { matchesDateFilter } from '../../utils/search';
import { CHANNEL_FILTERS, channelKey, matchesChannel } from '../../utils/channel';
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
  // Диалоги, где срочно нужен менеджер: chat_id → причина. Строки красные.
  urgent = null,
  // Состояние фильтров колонок может держать страница (ей нужны поиск и период
  // для архива и плиток); без него таблица хранит его сама.
  filters = null,
}) {
  const own = useColumnFilters('dialogs');
  const [filterState, setFilter, resetFilters, replaceFilters] = filters ?? own;
  const [channel, setChannel] = useState('all');
  // Фильтр канала — когда в списке больше одного мессенджера (или он уже выбран).
  const channelCounts = CHANNEL_FILTERS.map(([key, label]) => [
    key,
    label,
    key === 'all' ? rows.length : rows.filter((c) => channelKey(c.channel) === key).length,
  ]);
  const multiChannel = channelCounts.filter(([key, , n]) => key !== 'all' && n > 0).length > 1 || channel !== 'all';
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
  const hasFilters = filterKey !== '' || channel !== 'all';
  // Конкретный день («date:ГГГГ-ММ-ДД» из периода страницы) фильтр колонки не
  // знает — его отбираем здесь, как в рабочей панели.
  const byDay = String(filterState.last ?? '').startsWith('date:') ? filterState.last : '';
  const filtered = applyFilters(rows, filterDefs, filterState).filter(
    (c) => matchesChannel(c, channel) && (!byDay || matchesDateFilter(c, byDay)),
  );
  const resetAll = () => {
    resetFilters();
    setChannel('all');
  };

  const sorted = sort.col
    ? [...filtered].sort((a, b) => {
      const value = (row) => (sort.col === 'name' ? (row.name || '')
        : sort.col === 'status' ? (row.stage?.index ?? 0)
          : sort.col === 'unread' ? (row.unread_count ?? 0)
            : sort.col === 'age' ? (row.age ?? 0)
              : (row.last_message_ts || 0));
      const aVal = value(a);
      const bVal = value(b);
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
  }, [filterKey, showHidden, pageSize, channel, byDay]);
  const current = Math.min(page, pages);
  // Курсор горячих клавиш: J/K двигают, Enter открывает, W — окно наблюдения.
  const [cursor, setCursor] = useState(-1);
  const watch = useChatWatch();
  const visibleRef = useRef([]);
  const moveCursor = (delta) =>
    setCursor((cur) => {
      const list = visibleRef.current;
      if (!list.length) return -1;
      const next = Math.max(0, Math.min(list.length - 1, (cur < 0 ? (delta > 0 ? -1 : list.length) : cur) + delta));
      const id = list[next]?.chat_id;
      requestAnimationFrame(() => document.querySelector(`tr[data-chat-id="${id}"]`)?.scrollIntoView?.({ block: 'nearest' }));
      return next;
    });
  const atCursor = () => visibleRef.current[cursor];
  useHotkeys({
    j: () => moveCursor(1),
    k: () => moveCursor(-1),
    Enter: () => atCursor() && navigate(`/conversation/${atCursor().chat_id}`),
    w: () => {
      const row = atCursor();
      if (!row || !watch) return;
      if (watch.isOpen(row.chat_id)) watch.close(row.chat_id);
      else watch.open({ chatId: row.chat_id, name: row.name || `Чат ${row.chat_id}`, avatar: row.avatar_url || null });
    },
  });

  const visible = useMemo(
    () => sorted.slice((current - 1) * pageSize, current * pageSize),
    [sorted, current, pageSize],
  );
  visibleRef.current = visible;
  // Страница сменилась или строк стало меньше — курсор не указывает в пустоту.
  useEffect(() => {
    setCursor((cur) => (cur >= visible.length ? visible.length - 1 : cur));
  }, [visible.length]);

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
          onClick={resetAll}
          title={hasFilters ? 'Сбросить все фильтры' : undefined}
        >
          {hasFilters
            ? `НАЙДЕНО: ${filtered.length} из ${rows.length}`
            : `ВСЕГО: ${total}${truncated ? ` · показаны последние ${rows.length}` : ''}`}
        </Button>
        {multiChannel && (
          <div className="flex shrink-0 items-center gap-1" data-testid="channel-filters" role="radiogroup" aria-label="Канал">
            {channelCounts.map(([key, label, n]) => (
              <Button
                key={key}
                type="button"
                role="radio"
                aria-checked={channel === key}
                data-channel={key === 'all' ? undefined : key}
                variant={channel === key ? 'secondary' : 'ghost'}
                size="xs"
                className="font-normal tabular-nums"
                onClick={() => setChannel(key)}
              >
                {label} · {n}
              </Button>
            ))}
          </div>
        )}
        {replaceFilters && <SavedFilters tableId={showHidden ? 'dialogs_archive' : 'dialogs'} state={filterState} onApply={replaceFilters} />}
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
          cursorId={visible[cursor]?.chat_id ?? null}
          onHide={onHide}
          onDealStage={onDealStage}
          urgent={urgent}
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
