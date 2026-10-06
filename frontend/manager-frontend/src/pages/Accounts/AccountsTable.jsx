import { Fragment, useState } from 'react';
import { ChevronRight, Globe, LogIn, LogOut, MessageSquare, Pause, Pencil, Play, TimerOff, Trash2 } from 'lucide-react';
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

// [подпись, ширина, подпись только для экранного диктора]
const COLUMNS = [
  ['Подробнее', '44px', true],
  ['Аккаунт', '30%'],
  ['Личность · менеджер', '20%'],
  ['Диалоги · прокси'],
  ['Состояние', '17%'],
  ['Действия', '96px', true],
];

// ── Каркас строки ────────────────────────────────────────────────────────────
// Настоящая строка и строка-заглушка первой загрузки собираются ОДНИМ каркасом:
// те же <tr>/<td>, та же высота ячейки и те же строки текста. Высота заглушки
// равна высоте строки по построению. Меняете разметку строки — меняйте её
// здесь, заглушка подтянется сама.
//
// До 1100px таблица складывается: thead прячется, строка становится сеткой
//   стрелка | аккаунт             | действия
//           | личность · менеджер | состояние
//           | диалоги · прокси
// внутри того же блока с рамкой. Классы написаны целиком — сканер Tailwind
// не собирает их из кусочков.
const ROW =
  'border-b last:border-b-0 max-[1100px]:grid max-[1100px]:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] max-[1100px]:items-center max-[1100px]:gap-x-2 max-[1100px]:gap-y-1.5 max-[1100px]:px-3 max-[1100px]:py-2.5';
const CELL = 'h-14 px-3 py-0 whitespace-normal max-[1100px]:block max-[1100px]:h-auto max-[1100px]:min-w-0 max-[1100px]:p-0';
const LINE_1 = 'truncate text-sm leading-5';
const LINE_2 = 'min-h-4 truncate text-xs leading-4 text-muted-foreground';
const AVATAR_BOX = 'size-9 shrink-0 rounded-full';
const SLOT = 'block size-8 shrink-0';

function Frame({ children, className, tableProps, ...props }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card', className)} {...props}>
      <Table className="table-fixed max-[1100px]:block" {...tableProps}>
        <TableHeader className="max-[1100px]:hidden">
          <tr>
            {COLUMNS.map(([label, width, hidden]) => (
              <TableHead key={label} scope="col" style={width ? { width } : undefined} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                {hidden ? <span className="sr-only">{label}</span> : label}
              </TableHead>
            ))}
          </tr>
        </TableHeader>
        <tbody className="max-[1100px]:block">{children}</tbody>
      </Table>
    </div>
  );
}

function RowShell({ className, toggle, avatar, title, sub, persona, owner, ownerProps, facts, badge, note, actions, actionsProps, ...props }) {
  return (
    <tr className={cn(ROW, className)} {...props}>
      <TableCell className={cn(CELL, 'pr-0 max-[1100px]:col-start-1 max-[1100px]:row-start-1')}>{toggle}</TableCell>
      <TableCell className={cn(CELL, 'max-[1100px]:col-span-2 max-[1100px]:col-start-2 max-[1100px]:row-start-1')}>
        <div className="flex min-w-0 items-center gap-2.5">
          {avatar}
          <div className="min-w-0 flex-1">
            <div className={cn(LINE_1, 'font-medium')}>{title}</div>
            <div className={LINE_2}>{sub}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, 'max-[1100px]:col-start-2 max-[1100px]:row-start-2')}>
        <div className={LINE_1}>{persona}</div>
        <div className={LINE_2} {...ownerProps}>{owner}</div>
      </TableCell>
      <TableCell className={cn(CELL, 'max-[1100px]:col-span-2 max-[1100px]:col-start-2 max-[1100px]:row-start-3')}>
        <div className="flex min-w-0 items-center gap-3 text-xs leading-4 text-muted-foreground tabular-nums">{facts}</div>
      </TableCell>
      <TableCell className={cn(CELL, 'max-[1100px]:col-start-3 max-[1100px]:row-start-2')}>
        <div className="flex min-w-0 flex-col items-start gap-0.5">
          {badge}
          {/* Строка под ограничение / причину потери сессии: место занято всегда, высота строки не меняется. */}
          <div className={cn(LINE_2, 'max-w-full text-destructive')} title={note || undefined}>{note}</div>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, 'max-[1100px]:col-start-4 max-[1100px]:row-start-1')} {...actionsProps}>
        <div className="flex items-center justify-end gap-0.5">{actions}</div>
      </TableCell>
    </tr>
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
  return (
    <Frame role="status" aria-label="Загрузка аккаунтов" tableProps={{ 'aria-hidden': true }}>
      {Array.from({ length: rows }, (_, i) => (
        <RowShell
          key={i}
          toggle={<span className={SLOT} />}
          avatar={<Skeleton className={AVATAR_BOX} />}
          title={<Bar className="w-32 max-w-full" />}
          sub={<Bar className="h-2.5 w-44 max-w-full" />}
          persona={<Bar className="w-20 max-w-full" />}
          owner={<Bar className="h-2.5 w-28 max-w-full" />}
          facts={<Bar className="h-2.5 w-36 max-w-full" />}
          badge={<Badge variant="outline" className="w-[72px] animate-pulse border-transparent bg-accent">{' '}</Badge>}
          actions={<><Skeleton className={SLOT} /><Skeleton className={SLOT} /></>}
        />
      ))}
    </Frame>
  );
}

function Fact({ icon: Icon, label, className, children }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)} title={`${label}: ${children}`}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">{label}: </span>
      <span className="truncate">{children}</span>
    </span>
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
        <tr className="max-[1100px]:block">
          <td colSpan={COLUMNS.length} className="px-3 py-10 text-center text-sm text-muted-foreground max-[1100px]:block">
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
        const showPhone = row.phone_e164 && row.phone_e164 !== name;
        const owner = `${row.manager_username || 'без менеджера'}${row.region_code ? ` · регион ${row.region_code}` : ''}`;
        const note = row.flood_until ? `Ограничен до ${date(row.flood_until)}` : lost ? row.lost_reason || '' : '';
        const facts = [
          { label: 'ID аккаунта', value: `#${row.id}`, mono: true },
          { label: 'Диалогов', value: row.chats ?? 0 },
          { label: 'Прокси', value: proxy, mono: !row.needs_proxy_setup },
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
              toggle={(
                <IconAction
                  icon={ChevronRight}
                  label={open ? 'Свернуть' : 'Подробнее'}
                  aria-expanded={open}
                  aria-controls={open ? detailsId : undefined}
                  className={cn('[&_svg]:transition-transform', open && '[&_svg]:rotate-90')}
                  onClick={(e) => { e.stopPropagation(); toggle(row.id); }}
                />
              )}
              avatar={(
                <div className="relative shrink-0">
                  <Avatar
                    className={cn('flex items-center justify-center border bg-muted text-[11px] font-semibold text-muted-foreground', AVATAR_BOX)}
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
              sub={(
                <>
                  {row.username && (
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
                  )}
                  {row.username && showPhone && ' · '}
                  {showPhone && <span className="font-mono tabular-nums">{row.phone_e164}</span>}
                </>
              )}
              persona={(
                <>
                  {row.persona_name || row.persona_id || 'Без личности'}
                  {row.purpose === 'test' && <span className="ml-1.5 text-xs text-muted-foreground">тест</span>}
                </>
              )}
              ownerProps={{ 'data-testid': 'account-owner', title: owner }}
              owner={owner}
              facts={(
                <>
                  <Fact icon={MessageSquare} label="Диалогов" className="shrink-0">{row.chats ?? 0}</Fact>
                  <Fact icon={Globe} label="Прокси">{proxy}</Fact>
                </>
              )}
              badge={(
                <Badge variant={lost ? 'destructive' : STATUS_VARIANT[row.status] || 'outline'} title={row.lost_reason || undefined}>
                  {statusLabel(row)}
                </Badge>
              )}
              note={note}
              actionsProps={{ onClick: stop }}
              actions={(
                <>
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
                </>
              )}
            />
            {open && (
              <tr className="border-b bg-muted/30 last:border-b-0 max-[1100px]:block">
                <td colSpan={COLUMNS.length} className="px-3 pt-1 pb-3 pl-14 whitespace-normal max-[1100px]:block max-[1100px]:pt-0 max-[1100px]:pl-3">
                  <div id={detailsId} role="region" aria-label={`Подробности: ${name}`}>
                    <dl className="m-0 grid grid-cols-4 gap-x-6 gap-y-3 max-[1100px]:grid-cols-2">
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
