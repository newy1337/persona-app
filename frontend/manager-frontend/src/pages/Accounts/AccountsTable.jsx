import { Fragment, useState } from 'react';
import { ChevronRight, Globe, Image, ImageOff, LogIn, LogOut, Pause, Pencil, Play, TimerOff, Trash2 } from 'lucide-react';
import { PanelUX as ux } from '../../ui/PanelUX';
import { cn } from '@/lib/utils';
import { useMe } from '@/components/AppLayout/me';
import { accountContact, channelBadge } from '../../utils/channel';
import { ColumnFilter } from '@/components/ColumnFilter/ColumnFilter';
import { FilterChips } from '@/components/ColumnFilter/FilterChips';
import { applyFilters, isActive, optionsFrom } from '@/components/ColumnFilter/filters';
import { useColumnFilters } from '@/components/ColumnFilter/useColumnFilters';
import { ColumnPicker } from '@/components/ColumnPicker/ColumnPicker';
import { tableMinWidth, useColumnPrefs } from '@/components/ColumnPicker/columnPrefs';
import { IconAction } from '@/components/IconAction/IconAction';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableCell, TableHead, TableHeader } from '@/components/ui/table';
import { Peek } from '../../components/ConversationsTable/CellPeek';

/** Статус -> вариант Badge (цветная точка). Всё, чего здесь нет, — нейтральный outline. */
export const STATUS_VARIANT = {
  active: 'success',
  paused: 'warning',
  error: 'destructive',
  banned: 'destructive',
};

/* Сетка аккаунтов: одно значение в ячейке (у аккаунта под именем — ник, у
   состояния — строка под ограничение). Ширины (px) заданы у всех колонок, кроме
   «Состояния» — оно забирает остаток: под бейджем идёт причина (почему не в
   сети, чем ограничен), и ей нужно место. Раньше остаток забирал «Прокси», а
   причина обрезалась на 176px. Обрезанная причина раскрывается щелчком. «Регион» и «Пульс»
   по умолчанию видны с 1536px. Какие колонки показывать, пользователь выбирает
   сам — «Настроить поля» в заголовке колонки действий; раскрытие, аккаунт и
   действия скрыть нельзя. Значение скрытой колонки остаётся в раскрытии
   строки. Уже минимальной ширины таблица прокручивается внутри рамки. */
const WIDE_QUERY = '(min-width: 96rem)';
// Меньше этого «Состояние» не сжимается.
const FLEX_MIN_WIDTH = 200;
const COLUMNS = [
  { key: 'toggle', label: 'Подробнее', width: 44, required: true, quiet: true },
  { key: 'account', label: 'Аккаунт', width: 260, required: true },
  { key: 'channel', label: 'Соцсеть', width: 104 },
  { key: 'phone', label: 'Телефон', width: 148 },
  { key: 'persona', label: 'Личность', width: 140 },
  { key: 'manager', label: 'Менеджер', width: 140, adminOnly: true },
  { key: 'region', label: 'Регион', width: 84, show: 'wide', adminOnly: true },
  { key: 'chats', label: 'Диалоги', width: 84 },
  { key: 'photoSet', label: 'Образ', width: 150, show: 'wide' },
  { key: 'proxy', label: 'Прокси', width: 180 },
  { key: 'state', label: 'Состояние', filterAlign: 'end' },
  { key: 'pulse', label: 'Пульс', width: 120, show: 'wide', filterAlign: 'end' },
  { key: 'actions', label: 'Действия', width: 88, required: true, quiet: true },
];
// «Менеджер» и «Регион» нужны тем, кто видит чужие аккаунты (админ, хед,
// тимлид). Менеджеру они всегда про него самого — их нет нигде: ни в сетке, ни
// в настройке полей, ни в фильтрах.
const PUBLIC_COLUMNS = COLUMNS.filter((col) => !col.adminOnly);

/**
 * Колонки таблицы — общие для неё и её заглушки: all — все колонки, доступные
 * этому пользователю, columns — видимые сейчас.
 */
function useAccountColumns() {
  const me = useMe();
  // Вне каркаса (me нет) — всё, как и раньше.
  const admin = !me || me.role !== 'manager';
  const all = admin ? COLUMNS : PUBLIC_COLUMNS;
  const prefs = useColumnPrefs('accounts', all, { wide: WIDE_QUERY });
  return { ...prefs, all, admin };
}

// ── Фильтры колонок ──────────────────────────────────────────────────────────
const ONLINE = 'В сети';
const OFFLINE = 'Не в сети';
const personaOf = (row) => row.persona_name || row.persona_id || '';
const displayName = (row) =>
  row.display_name || accountContact(row)?.display || row.login || row.phone_e164 || `Аккаунт #${row.id}`;
const isOnline = (row, alive) => Boolean(alive?.[row.id] ?? row.online);

/**
 * Что с аккаунтом не так — из-за этого строка красная: бан, нет сессии
 * (отвалился), включён, но не в сети, ограничение мессенджера, нет прокси.
 * Пауза и выведенные — решение человека, не проблема.
 */
export function accountProblems(row, online, now = Math.floor(Date.now() / 1000)) {
  if (row.status === 'retired') return [];
  const out = [];
  if (row.status === 'banned') out.push('бан');
  if (row.status === 'unauthorized') out.push(row.lost_at ? `сессия завершена${row.lost_reason ? `: ${row.lost_reason}` : ''}` : 'нет сессии');
  if (row.status === 'active' && !online) out.push(`не в сети${row.offline_reason ? `: ${row.offline_reason}` : ''}`);
  if (row.flood_until && row.flood_until > now) out.push('ограничен мессенджером');
  if (row.needs_proxy_setup) out.push('прокси не задан');
  return out;
}

/** Выбранное значение остаётся в списке, даже если строк с ним больше нет. */
function keepPicked(options, value, empty = '—') {
  if (!Array.isArray(value)) return options;
  const have = new Set(options.map((o) => String(o.value)));
  const lost = value.map(String).filter((v) => !have.has(v));
  return lost.length ? [...options, ...lost.map((v) => ({ value: v, label: v === '' ? empty : v, count: 0 }))] : options;
}

/**
 * Описания фильтров по ключам колонок. Варианты списков собираются из ВСЕХ
 * строк, а не из отфильтрованных — список не меняется, пока человек выбирает.
 */
function filterDefs(rows, alive, statusLabel, state) {
  const fromRows = (key, get, empty) => ({
    type: 'options',
    get,
    options: keepPicked(optionsFrom(rows, get, { empty }), state[key], empty),
  });
  const count = (test) => rows.filter(test).length;
  const proxySet = (row) => !row.needs_proxy_setup;
  const online = (row) => isOnline(row, alive);
  return {
    account: { type: 'text', placeholder: 'Имя или @ник', get: (row) => [displayName(row), row.username && `@${row.username}`, row.login] },
    channel: {
      type: 'options',
      get: (row) => channelBadge(row.channel).key,
      options: keepPicked(
        [...new Set(rows.map((row) => channelBadge(row.channel).key))].map((key) => ({
          value: key,
          label: channelBadge(key).title,
          count: count((row) => channelBadge(row.channel).key === key),
        })),
        state.channel,
      ),
    },
    phone: { type: 'text', placeholder: 'Номер или логин…', get: (row) => [row.phone_e164, row.login] },
    persona: fromRows('persona', personaOf, 'Без личности'),
    manager: fromRows('manager', (row) => row.manager_username || '', 'без менеджера'),
    region: fromRows('region', (row) => row.region_code || '', 'не задан'),
    photoSet: fromRows('photoSet', (row) => row.photo_set_name || '', 'без образа'),
    proxy: {
      type: 'options',
      get: (row) => (proxySet(row) ? 'set' : 'unset'),
      options: [
        { value: 'set', label: 'задан', count: count(proxySet) },
        { value: 'unset', label: 'не задан', count: count((row) => !proxySet(row)) },
      ],
    },
    // Один список: подписи состояния (как на бейдже) и присутствие в сети.
    state: {
      type: 'options',
      get: (row) => [statusLabel(row), online(row) ? ONLINE : OFFLINE],
      options: keepPicked(
        [
          ...optionsFrom(rows, statusLabel),
          { value: ONLINE, label: ONLINE, count: count(online) },
          { value: OFFLINE, label: OFFLINE, count: count((row) => !online(row)) },
        ],
        state.state,
      ),
    },
    pulse: { type: 'period', get: (row) => row.last_heartbeat_at },
  };
}

// ── Каркас строки ────────────────────────────────────────────────────────────
// Настоящая строка и строка-заглушка первой загрузки собираются ОДНИМ каркасом:
// те же <tr>/<td> и та же высота ячейки, поэтому высота заглушки равна высоте
// строки по построению. Меняете колонки — меняйте COLUMNS, заглушка подтянется.
const ROW = 'border-b last:border-b-0';
const CELL = 'h-[52px] px-3 py-0';
const ONE = 'flex min-w-0 items-center gap-1.5 text-sm';
const LINE_1 = 'truncate text-sm leading-5';
const LINE_2 = 'min-h-4 truncate text-xs leading-4 text-muted-foreground';
const AVATAR_BOX = 'size-8 shrink-0 rounded-full';
const SLOT = 'block size-8 shrink-0';
const Empty = () => <span className="text-muted-foreground">—</span>;

/**
 * Строка над таблицей: слева заданные фильтры, справа счётчик. Её высота
 * занята всегда — и в заглушке, и без фильтров, — поэтому таблица не прыгает.
 */
function Shell({ bar, children }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center gap-3">{bar}</div>
      {children}
    </div>
  );
}

/**
 * prefs — выбор колонок; picker: показывать ли «Настроить поля» (в заглушке кнопки нет);
 * filters — { defs, state, onChange }: воронки в заголовках (в заглушке их нет).
 */
function Frame({ children, className, tableProps, prefs, picker = false, filters, ...props }) {
  return (
    <div className={cn('rounded-lg border bg-card', className)} {...props}>
      <Table className="table-fixed" style={{ minWidth: tableMinWidth(prefs.columns, FLEX_MIN_WIDTH) }} {...tableProps}>
        <TableHeader>
          <tr>
            {prefs.columns.map((col) => (
              <TableHead
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className="h-9 px-3 text-xs font-medium text-muted-foreground"
              >
                {col.key === 'actions' ? (
                  <div className="flex items-center justify-end">
                    <span className="sr-only">{col.label}</span>
                    {picker && <ColumnPicker prefs={prefs} />}
                  </div>
                ) : col.quiet ? (
                  <span className="sr-only">{col.label}</span>
                ) : (
                  // Название сжимается раньше, чем воронка выйдет за колонку.
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="min-w-0 truncate">{col.label}</span>
                    {filters?.defs[col.key] && (
                      <ColumnFilter
                        label={col.label}
                        def={filters.defs[col.key]}
                        value={filters.state[col.key]}
                        onChange={(value) => filters.onChange(col.key, value)}
                        align={col.filterAlign}
                      />
                    )}
                  </div>
                )}
              </TableHead>
            ))}
          </tr>
        </TableHeader>
        <tbody>{children}</tbody>
      </Table>
    </div>
  );
}

/** cells — содержимое по ключам колонок, cellProps — атрибуты отдельных ячеек. */
function RowShell({ columns, className, cells, cellProps = {}, ...props }) {
  return (
    <tr className={cn(ROW, className)} {...props}>
      {columns.map((col) => (
        <TableCell
          key={col.key}
          className={cn(CELL, col.key === 'toggle' && 'pr-0')}
          {...cellProps[col.key]}
        >
          {cells[col.key]}
        </TableCell>
      ))}
    </tr>
  );
}

/** Аккаунт: аватар, имя и строка под ним. */
function Who({ avatar, title, sub }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {avatar}
      <div className="min-w-0 flex-1">
        <div className={cn(LINE_1, 'font-medium')}>{title}</div>
        <div className={LINE_2}>{sub}</div>
      </div>
    </div>
  );
}

/** Состояние: бейдж и строка под ограничение / причину потери сессии — место занято всегда. */
function State({ badge, note, noteId, problem = true }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      {badge}
      {/* Причина — до двух строк: строка с проблемой чуть выше, зато текст читается. */}
      <div className={cn('line-clamp-2 min-h-4 max-w-full text-xs leading-4 whitespace-normal [overflow-wrap:anywhere]', problem ? 'text-destructive' : 'text-muted-foreground')} title={note || undefined} data-testid={note ? noteId : undefined}>{note}</div>
    </div>
  );
}

// Полоска-заглушка внутри строки текста: строка сохраняет свой line-height,
// сама полоска ниже неё и выровнена по середине.
function Bar({ className }) {
  return <Skeleton className={cn('inline-block h-3 align-middle', className)} />;
}

/**
 * Заглушка первой загрузки. Показывается только пока не пришёл первый ответ;
 * дальше список никогда не подменяется ни ею, ни текстом.
 */
export function AccountsTableSkeleton({ rows = 3 }) {
  const prefs = useAccountColumns();
  const one = (width) => <div className={ONE}><Bar className={cn('max-w-full', width)} /></div>;
  return (
    <Shell>
    <Frame prefs={prefs} role="status" aria-label="Загрузка аккаунтов" tableProps={{ 'aria-hidden': true }}>
      {Array.from({ length: rows }, (_, i) => (
        <RowShell
          key={i}
          columns={prefs.columns}
          cells={{
            toggle: <span className={SLOT} />,
            account: (
              <Who
                avatar={<Skeleton className={AVATAR_BOX} />}
                title={<Bar className="w-28 max-w-full" />}
                sub={<Bar className="h-2.5 w-24 max-w-full" />}
              />
            ),
            channel: one('w-8'),
            phone: one('w-24'),
            persona: one('w-20'),
            manager: one('w-20'),
            region: one('w-10'),
            chats: one('w-6'),
            photoSet: one('w-20'),
            proxy: one('w-28'),
            state: (
              <State badge={<Badge variant="outline" className="w-[72px] animate-pulse border-transparent bg-accent">{' '}</Badge>} />
            ),
            pulse: one('w-20'),
            actions: (
              <div className="flex items-center justify-end gap-0.5">
                <Skeleton className={SLOT} />
                <Skeleton className={SLOT} />
              </div>
            ),
          }}
        />
      ))}
    </Frame>
    </Shell>
  );
}

const stop = (e) => e.stopPropagation();

function Count({ children }) {
  return (
    <span data-testid="accounts-count" className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

export function AccountsTable({ rows, alive, onEdit, onLogin, onProxy, onStatus, onClearFlood, onDelete, helpers, onPhotoAutoSend }) {
  const pending = ux.useActions().pending;
  // Раскрытые строки — по id аккаунта: несколько сразу, и опрос их не закрывает.
  const [expanded, setExpanded] = useState(() => new Set());
  const { Avatar, statusLabel, date } = helpers;
  const prefs = useAccountColumns();
  const { columns, has, all, admin } = prefs;
  const [filterState, setFilter, resetFilters] = useColumnFilters('accounts');

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Фильтр есть только у колонок, доступных пользователю; скрытая в настройке
  // полей колонка фильтр сохраняет — он виден в плашках над таблицей.
  const everyDef = filterDefs(rows, alive, statusLabel, filterState);
  const filterColumns = all.filter((col) => everyDef[col.key]).map((col) => ({ key: col.key, label: col.label, filter: everyDef[col.key] }));
  const defs = Object.fromEntries(filterColumns.map((col) => [col.key, col.filter]));
  const filtered = filterColumns.some((col) => isActive(filterState[col.key]));
  const shown = applyFilters(rows, defs, filterState);
  const tableProps = { 'aria-label': 'Аккаунты' };

  if (!rows.length) {
    return (
      <Shell bar={<Count>Аккаунтов: 0</Count>}>
        <Frame prefs={prefs} picker tableProps={tableProps}>
          <tr>
            <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-muted-foreground">
              Аккаунтов нет. Telegram: добавьте номер и войдите — код придёт в Telegram. ВКонтакте: добавьте логин, куки и прокси.
            </td>
          </tr>
        </Frame>
      </Shell>
    );
  }

  return (
    <Shell
      bar={(
        <>
          <FilterChips className="flex-1" columns={filterColumns} state={filterState} onChange={setFilter} onReset={resetFilters} />
          <Count>{filtered ? `Найдено: ${shown.length} из ${rows.length}` : `Аккаунтов: ${rows.length}`}</Count>
        </>
      )}
    >
    <Frame prefs={prefs} picker tableProps={tableProps} filters={{ defs, state: filterState, onChange: setFilter }}>
      {!shown.length && (
        <tr>
          <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-muted-foreground">
            По этим условиям аккаунтов нет.{' '}
            <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={resetFilters}>
              Сбросить фильтры
            </Button>
          </td>
        </tr>
      )}
      {shown.map((row) => {
        const busy = pending.some(
          (key) => key.split(':').slice(1).join(':') === `/api/tg-accounts/${row.id}` || key.includes(`/api/tg-accounts/${row.id}/`),
        );
        const name = displayName(row);
        const badge = channelBadge(row.channel);
        const profile = accountContact(row);
        const network = badge.title;
        const online = isOnline(row, alive);
        const problems = accountProblems(row, online);
        const presence = online ? ONLINE : OFFLINE;
        const open = expanded.has(row.id);
        const loginNeeded = row.status === 'unauthorized' || row.status === 'banned';
        const detailsId = `account-details-${row.id}`;
        const lost = row.status === 'unauthorized' && row.lost_at;
        const proxy = row.needs_proxy_setup ? 'не задан' : row.proxy_label || row.proxy_geo || 'задан';
        const owner = `${row.manager_username || 'без менеджера'}${row.region_code ? ` · регион ${row.region_code}` : ''}`;
        const offlineReason = !online && row.offline_reason ? row.offline_reason : '';
        const note = row.flood_until ? `Ограничен до ${date(row.flood_until)}` : lost ? row.lost_reason || '' : offlineReason;
        const photoSet = row.photo_set_name || 'без образа';
        // Значения скрытых колонок не пропадают: они добавляются в раскрытие строки.
        const facts = [
          problems.length > 0 && { label: 'Проблемы', value: problems.join('; ') },
          { label: 'ID аккаунта', value: `#${row.id}`, mono: true },
          !has('phone') && { label: row.login && !row.phone_e164 ? 'Логин' : 'Телефон', value: row.phone_e164 || row.login || '—', mono: Boolean(row.phone_e164 || row.login) },
          !has('persona') && { label: 'Личность', value: row.persona_name || row.persona_id || 'Без личности' },
          admin && !has('manager') && { label: 'Менеджер', value: row.manager_username || 'без менеджера' },
          !has('state') && { label: 'Состояние', value: [statusLabel(row), note].filter(Boolean).join(' · ') },
          { label: 'Диалогов', value: row.chats ?? 0 },
          { label: 'Прокси', value: proxy, mono: Boolean(row.proxy_label) && !row.needs_proxy_setup },
          { label: 'Назначение', value: row.purpose === 'test' ? 'Тестовый' : row.purpose === 'prod' ? 'Рабочий' : row.purpose || '—' },
          admin && { label: 'Регион', value: row.region_code || 'не задан' },
          { label: 'Последний вход', value: date(row.last_login_at) },
          { label: 'Пульс', value: date(row.last_heartbeat_at) },
          { label: 'Лимит сообщений в день', value: row.daily_msg_quota ?? 'Без лимита' },
          { label: 'Образ', value: row.photo_set_name || 'Не назначен' },
          { label: 'Автоотправка фото', value: row.photo_auto_send ? 'Разрешена' : 'Выключена для аккаунта' },
        ].filter(Boolean);
        return (
          <Fragment key={row.id}>
            <RowShell
              columns={columns}
              data-account-id={row.id}
              data-problem={problems.length ? 'true' : undefined}
              title={problems.length ? `Проблемы: ${problems.join('; ')}` : undefined}
              className={cn(
                'cursor-pointer transition-colors hover:bg-muted/50',
                open && 'border-b-0 bg-muted/30',
                // Аккаунт отвалился, в бане, не в сети и т.п. — строка красная, как срочные диалоги.
                problems.length > 0 &&
                  'bg-destructive/15 hover:bg-destructive/20 [&>td:first-child]:shadow-[inset_3px_0_0_var(--destructive)]',
              )}
              // Клик по строке раскрывает её; выделение текста мышью раскрытием не считается.
              onClick={() => !window.getSelection?.()?.toString() && toggle(row.id)}
              cellProps={{ actions: { onClick: stop } }}
              cells={{
                toggle: (
                  <IconAction
                    icon={ChevronRight}
                    label={open ? 'Свернуть' : 'Подробнее'}
                    aria-expanded={open}
                    aria-controls={open ? detailsId : undefined}
                    className={cn('[&_svg]:transition-transform', open && '[&_svg]:rotate-90')}
                    onClick={(e) => { e.stopPropagation(); toggle(row.id); }}
                  />
                ),
                account: (
                  <Who
                    avatar={(
                      <div className="relative shrink-0">
                        <Avatar
                          className={cn('flex items-center justify-center border bg-muted text-[11px] font-medium text-muted-foreground', AVATAR_BOX)}
                          src={row.avatar_url}
                          name={name}
                        />
                        <span
                          role="img"
                          aria-label={presence}
                          title={presence}
                          className={cn('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card', online ? 'bg-success-foreground' : 'bg-muted-foreground/50')}
                        />
                      </div>
                    )}
                    title={(
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate" title={name}>{name}</span>
                        {/* Колонку «Соцсеть» скрыли — метка канала у имени, у всех, и у Telegram тоже. */}
                        {!has('channel') && (
                          <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]" data-testid="channel-badge" data-channel={badge.key} title={badge.title}>
                            {badge.label}
                          </Badge>
                        )}
                      </span>
                    )}
                    sub={profile ? (
                      <a
                        className="text-primary hover:underline"
                        href={profile.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={stop}
                        aria-label={row.display_name ? undefined : `Профиль ${profile.display}`}
                      >
                        {row.display_name ? profile.display : network}
                      </a>
                    ) : presence}
                  />
                ),
                channel: (
                  <div className={ONE}>
                    <Badge variant="outline" className="h-5" data-testid="channel-cell" data-channel={badge.key} title={badge.title}>
                      {badge.label}
                    </Badge>
                  </div>
                ),
                phone: (
                  <div className={ONE}>
                    {row.phone_e164 || row.login
                      ? <span className="truncate font-mono text-xs tabular-nums">{row.phone_e164 || row.login}</span>
                      : <Empty />}
                  </div>
                ),
                persona: (
                  <div className={ONE} title={row.persona_name || row.persona_id || undefined}>
                    <span className={cn('truncate', !(row.persona_name || row.persona_id) && 'text-muted-foreground')}>
                      {row.persona_name || row.persona_id || 'Без личности'}
                    </span>
                    {row.purpose === 'test' && <span className="shrink-0 text-xs text-muted-foreground">тест</span>}
                  </div>
                ),
                manager: (
                  <div className={ONE} data-testid="account-owner" title={owner}>
                    <span className={cn('truncate', !row.manager_username && 'text-muted-foreground')}>
                      {row.manager_username || 'без менеджера'}
                    </span>
                  </div>
                ),
                region: (
                  <div className={ONE}>
                    {row.region_code ? <span className="truncate tabular-nums">{row.region_code}</span> : <Empty />}
                  </div>
                ),
                chats: <div className={cn(ONE, 'tabular-nums')} data-testid="account-chats">{row.chats ?? 0}</div>,
                photoSet: (
                  <div className={ONE} data-testid="account-photo-set" title={`Образ: ${photoSet}`}>
                    <span className={cn('truncate', !row.photo_set_name && 'text-muted-foreground')}>{photoSet}</span>
                    {row.photo_set_id && !row.photo_auto_send && (
                      <span className="shrink-0 text-xs text-muted-foreground" title="Автоотправка фото выключена для аккаунта">без авто</span>
                    )}
                  </div>
                ),
                proxy: (
                  <div className={ONE} title={`Прокси: ${proxy}`}>
                    <span className={cn('truncate', row.needs_proxy_setup && 'text-muted-foreground')}>{proxy}</span>
                  </div>
                ),
                // Причина обрезана многоточием — щелчок по ней раскрывает полный текст (строка при этом не раскрывается).
                state: (
                  <Peek className="min-w-0">
                  <State
                    badge={(
                      <Badge variant={lost ? 'destructive' : STATUS_VARIANT[row.status] || 'outline'} title={row.lost_reason || undefined}>
                        {statusLabel(row)}
                      </Badge>
                    )}
                    note={note}
                    noteId={note && note === offlineReason ? 'offline-reason' : undefined}
                    // На паузе «не в сети» — норма: причина серая, красная — только у проблемных.
                    problem={problems.length > 0}
                  />
                  </Peek>
                ),
                pulse: <div className={cn(ONE, 'tabular-nums text-muted-foreground')}><span className="truncate">{date(row.last_heartbeat_at)}</span></div>,
                actions: (
                  <div className="flex items-center justify-end gap-0.5">
                    <IconAction icon={Pencil} label="Изменить" disabled={busy} onClick={() => onEdit(row)} />
                    {loginNeeded ? (
                      <IconAction icon={LogIn} label="Войти" disabled={busy} onClick={() => onLogin(row)} />
                    ) : row.status === 'active' || row.status === 'paused' ? (
                      // Одна и та же кнопка: меняются только значок и подпись.
                      <IconAction
                        icon={row.status === 'active' ? Pause : Play}
                        label={row.status === 'active' ? 'Пауза' : 'Включить'}
                        disabled={busy}
                        onClick={() => onStatus(row, row.status === 'active' ? 'paused' : 'active')}
                      />
                    ) : (
                      <span aria-hidden="true" className={SLOT} />
                    )}
                  </div>
                ),
              }}
            />
            {open && (
              <tr className="border-b bg-muted/30 last:border-b-0">
                <td colSpan={columns.length} className="px-3 pt-1 pb-3 pl-14 whitespace-normal">
                  <div id={detailsId} role="region" aria-label={`Подробности: ${name}`}>
                    <dl className="m-0 grid max-w-5xl grid-cols-4 gap-x-6 gap-y-3">
                      {facts.map(({ label, value, mono }) => (
                        <div key={label} className="min-w-0">
                          <dt className="text-xs leading-4 text-muted-foreground">{label}</dt>
                          <dd className={cn('m-0 mt-0.5 text-sm leading-5 tabular-nums [overflow-wrap:anywhere]', mono && 'font-mono')}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {row.lost_at && (
                      <p className="mt-3 text-xs leading-4 text-destructive [overflow-wrap:anywhere]">
                        {`${row.lost_reason || 'Аккаунт потерян'} · ${date(row.lost_at)}`}
                      </p>
                    )}
                    {row.flood_until && (
                      <p className="mt-3 text-xs leading-4 text-destructive [overflow-wrap:anywhere]">
                        {`${row.flood_reason || `Ограничение ${network}`} · до ${date(row.flood_until)}`}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onProxy(row)}>
                        <Globe aria-hidden="true" />Прокси
                      </Button>
                      {onPhotoAutoSend && (
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onPhotoAutoSend(row, !row.photo_auto_send)}>
                          {row.photo_auto_send ? <ImageOff aria-hidden="true" /> : <Image aria-hidden="true" />}
                          {row.photo_auto_send ? 'Выключить автофото' : 'Включить автофото'}
                        </Button>
                      )}
                      {!loginNeeded && row.status !== 'retired' && (
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onLogin(row)}>
                          <LogIn aria-hidden="true" />{badge.key === 'vk' ? 'Новые куки' : 'Перелогин'}
                        </Button>
                      )}
                      {row.flood_until && (
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onClearFlood(row)} title="Аккаунт снова будет брать новых лидов">
                          <TimerOff aria-hidden="true" />Снять флуд
                        </Button>
                      )}
                      {row.status !== 'retired' && row.status !== 'banned' && (
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onStatus(row, 'retired')}>
                          <LogOut aria-hidden="true" />Вывести
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onDelete(row)}
                      >
                        <Trash2 aria-hidden="true" />Удалить
                      </Button>
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </Frame>
    </Shell>
  );
}
