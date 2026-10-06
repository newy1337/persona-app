import { Fragment, useState } from 'react';
import { ChevronRight, Globe, LogIn, LogOut, Pause, Pencil, Play, TimerOff, Trash2 } from 'lucide-react';
import { PanelUX as ux } from '../../ui/PanelUX';
import { cn } from '@/lib/utils';
import { IconAction } from '@/components/IconAction/IconAction';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableCell, TableHead, TableHeader } from '@/components/ui/table';

/** Статус -> вариант Badge (цветная точка). Всё, чего здесь нет, — нейтральный outline. */
export const STATUS_VARIANT = {
  active: 'success',
  paused: 'warning',
  error: 'destructive',
  banned: 'destructive',
};

/* Сетка аккаунтов: одно значение в ячейке (у аккаунта под именем — ник, у
   состояния — строка под ограничение). Ширины заданы у всех колонок, кроме
   «Прокси» — она забирает остаток (адрес прокси длинный). «Регион» и «Пульс» видны с 1536px, на
   экранах уже они остаются в раскрытии строки. Уже 1250px таблица
   прокручивается внутри рамки. */
const WIDE_ONLY = 'max-2xl:hidden';
const COLUMNS = [
  { key: 'toggle', label: 'Подробнее', width: '44px', quiet: true },
  { key: 'account', label: 'Аккаунт', width: '260px' },
  { key: 'phone', label: 'Телефон', width: '148px' },
  { key: 'persona', label: 'Личность', width: '140px' },
  { key: 'manager', label: 'Менеджер', width: '140px' },
  { key: 'region', label: 'Регион', width: '84px', wide: true },
  { key: 'chats', label: 'Диалоги', width: '84px' },
  { key: 'proxy', label: 'Прокси' },
  { key: 'state', label: 'Состояние', width: '176px' },
  { key: 'pulse', label: 'Пульс', width: '120px', wide: true },
  { key: 'actions', label: 'Действия', width: '88px', quiet: true },
];

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

function Frame({ children, className, tableProps, ...props }) {
  return (
    <div className={cn('rounded-lg border bg-card', className)} {...props}>
      <Table className="min-w-[1250px] table-fixed" {...tableProps}>
        <TableHeader>
          <tr>
            {COLUMNS.map((col) => (
              <TableHead
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className={cn('h-9 px-3 text-xs font-medium text-muted-foreground', col.wide && WIDE_ONLY)}
              >
                {col.quiet ? <span className="sr-only">{col.label}</span> : col.label}
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
function RowShell({ className, cells, cellProps = {}, ...props }) {
  return (
    <tr className={cn(ROW, className)} {...props}>
      {COLUMNS.map((col) => (
        <TableCell
          key={col.key}
          className={cn(CELL, col.key === 'toggle' && 'pr-0', col.wide && WIDE_ONLY)}
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
function State({ badge, note }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      {badge}
      <div className={cn(LINE_2, 'max-w-full text-destructive')} title={note || undefined}>{note}</div>
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
  const one = (width) => <div className={ONE}><Bar className={cn('max-w-full', width)} /></div>;
  return (
    <Frame role="status" aria-label="Загрузка аккаунтов" tableProps={{ 'aria-hidden': true }}>
      {Array.from({ length: rows }, (_, i) => (
        <RowShell
          key={i}
          cells={{
            toggle: <span className={SLOT} />,
            account: (
              <Who
                avatar={<Skeleton className={AVATAR_BOX} />}
                title={<Bar className="w-28 max-w-full" />}
                sub={<Bar className="h-2.5 w-24 max-w-full" />}
              />
            ),
            phone: one('w-24'),
            persona: one('w-20'),
            manager: one('w-20'),
            region: one('w-10'),
            chats: one('w-6'),
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
  );
}

const stop = (e) => e.stopPropagation();

export function AccountsTable({ rows, alive, onEdit, onLogin, onProxy, onStatus, onClearFlood, onDelete, helpers }) {
  const pending = ux.useActions().pending;
  // Раскрытые строки — по id аккаунта: несколько сразу, и опрос их не закрывает.
  const [expanded, setExpanded] = useState(() => new Set());
  const { Avatar, statusLabel, date } = helpers;

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  if (!rows.length) {
    return (
      <Frame tableProps={{ 'aria-label': 'Telegram-аккаунты' }}>
        <tr>
          <td colSpan={COLUMNS.length} className="px-3 py-10 text-center text-sm text-muted-foreground">
            Аккаунтов нет. Добавьте номер, затем войдите — код придёт в Telegram.
          </td>
        </tr>
      </Frame>
    );
  }

  return (
    <Frame tableProps={{ 'aria-label': 'Telegram-аккаунты' }}>
      {rows.map((row) => {
        const busy = pending.some(
          (key) => key.split(':').slice(1).join(':') === `/api/tg-accounts/${row.id}` || key.includes(`/api/tg-accounts/${row.id}/`),
        );
        const name = row.display_name || (row.username ? `@${row.username}` : row.phone_e164 || `Аккаунт #${row.id}`);
        const online = Boolean(alive[row.id] ?? row.online);
        const presence = online ? 'В сети' : 'Не в сети';
        const open = expanded.has(row.id);
        const loginNeeded = row.status === 'unauthorized' || row.status === 'banned';
        const detailsId = `account-details-${row.id}`;
        const lost = row.status === 'unauthorized' && row.lost_at;
        const proxy = row.needs_proxy_setup ? 'не задан' : row.proxy_label || row.proxy_geo || 'задан';
        const owner = `${row.manager_username || 'без менеджера'}${row.region_code ? ` · регион ${row.region_code}` : ''}`;
        const note = row.flood_until ? `Ограничен до ${date(row.flood_until)}` : lost ? row.lost_reason || '' : '';
        const facts = [
          { label: 'ID аккаунта', value: `#${row.id}`, mono: true },
          { label: 'Диалогов', value: row.chats ?? 0 },
          { label: 'Прокси', value: proxy, mono: Boolean(row.proxy_label) && !row.needs_proxy_setup },
          { label: 'Назначение', value: row.purpose === 'test' ? 'Тестовый' : row.purpose === 'prod' ? 'Рабочий' : row.purpose || '—' },
          { label: 'Регион', value: row.region_code || 'не задан' },
          { label: 'Последний вход', value: date(row.last_login_at) },
          { label: 'Пульс', value: date(row.last_heartbeat_at) },
          { label: 'Лимит сообщений в день', value: row.daily_msg_quota ?? 'Без лимита' },
        ];
        return (
          <Fragment key={row.id}>
            <RowShell
              data-account-id={row.id}
              className={cn('cursor-pointer transition-colors hover:bg-muted/50', open && 'border-b-0 bg-muted/30')}
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
                    title={<span title={name}>{name}</span>}
                    sub={row.username ? (
                      <a
                        className="text-primary hover:underline"
                        href={`https://t.me/${row.username}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={stop}
                        aria-label={row.display_name ? undefined : `Профиль ${row.username}`}
                      >
                        {row.display_name ? `@${row.username}` : 'Telegram'}
                      </a>
                    ) : presence}
                  />
                ),
                phone: (
                  <div className={ONE}>
                    {row.phone_e164 ? <span className="truncate font-mono text-xs tabular-nums">{row.phone_e164}</span> : <Empty />}
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
                chats: <div className={cn(ONE, 'tabular-nums')}>{row.chats ?? 0}</div>,
                proxy: (
                  <div className={ONE} title={`Прокси: ${proxy}`}>
                    <span className={cn('truncate', row.needs_proxy_setup && 'text-muted-foreground')}>{proxy}</span>
                  </div>
                ),
                state: (
                  <State
                    badge={(
                      <Badge variant={lost ? 'destructive' : STATUS_VARIANT[row.status] || 'outline'} title={row.lost_reason || undefined}>
                        {statusLabel(row)}
                      </Badge>
                    )}
                    note={note}
                  />
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
                <td colSpan={COLUMNS.length} className="px-3 pt-1 pb-3 pl-14 whitespace-normal">
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
                        {`${row.flood_reason || 'Ограничение Telegram'} · до ${date(row.flood_until)}`}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onProxy(row)}>
                        <Globe aria-hidden="true" />Прокси
                      </Button>
                      {!loginNeeded && row.status !== 'retired' && (
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onLogin(row)}>
                          <LogIn aria-hidden="true" />Перелогин
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
  );
}
