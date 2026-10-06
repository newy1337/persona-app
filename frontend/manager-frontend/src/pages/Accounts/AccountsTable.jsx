import { Fragment, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { PanelUX as ux } from '../../ui/PanelUX';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableCell, TableHead, TableHeader } from '@/components/ui/table';

/**
 * Единая карта статус -> вариант Badge. helpers.statusClasses из старых
 * SCSS-модулей больше не нужен: страница может передать пустой объект.
 */
export const STATUS_VARIANT = {
  active: 'success',
  paused: 'warning',
  unauthorized: 'outline',
  banned: 'destructive',
  retired: 'secondary',
};

const COLUMNS = [
  ['Аккаунт', '30%'],
  ['Личность / менеджер', '28%'],
  ['Состояние', '17%'],
  ['Действия', '25%'],
];

// Карточный режим до 1100px: thead прячется, каждая строка становится
// сеткой-карточкой; раскрытые подробности пристыковываются к ней снизу.
// Классы написаны целиком — сканер Tailwind не собирает их из кусочков.
const CELL = 'p-3 align-top whitespace-normal [overflow-wrap:anywhere] max-[1100px]:block max-[1100px]:p-0';

// Кнопка действия в строке. Вынесена из рендера, чтобы опрос раз в 10 секунд
// не пересоздавал тип компонента и не сбрасывал фокус/hover.
function RowButton({ className, ...props }) {
  return <Button type="button" variant="outline" size="sm" className={className} {...props} />;
}

// ── Каркас строки ────────────────────────────────────────────────────────────
// Настоящая строка и строка-заглушка первой загрузки собираются ОДНИМ и тем же
// каркасом: те же <tr>/<td>, отступы, сетка карточного режима и те же строки
// текста с их line-height. Высота заглушки поэтому равна высоте строки по
// построению, а не по подобранному числу. Меняете разметку строки — меняйте
// её здесь, заглушка подтянется сама.
const ROW =
  'transition-colors hover:bg-muted/50 max-[1100px]:mb-3 max-[1100px]:grid max-[1100px]:grid-cols-[minmax(0,1fr)_minmax(120px,0.7fr)] max-[1100px]:gap-x-5 max-[1100px]:gap-y-3.5 max-[1100px]:rounded-lg max-[1100px]:border max-[1100px]:bg-card max-[1100px]:p-4 max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-2.5 max-sm:p-3.5';
const AVATAR_BOX = 'size-9 shrink-0 rounded-full';
// min-h держит строку текста и тогда, когда она пуста (нет ника и телефон уже в имени).
const TITLE_LINE = 'min-h-6 text-sm leading-6';
const SUB_LINE = 'flex min-h-5 flex-wrap text-xs leading-5 text-muted-foreground';
const ONLINE_LINE = 'inline-flex min-w-[72px] items-center gap-1.5 text-xs leading-5 text-muted-foreground tabular-nums';
const FLOOD_LINE = 'min-h-4 text-xs leading-4 text-destructive';

function Frame({ children, className, tableProps, ...props }) {
  return (
    <div className={cn('rounded-lg border bg-card max-[1100px]:border-0 max-[1100px]:bg-transparent', className)} {...props}>
      <Table className="table-fixed max-[1100px]:block" {...tableProps}>
        <TableHeader className="max-[1100px]:hidden">
          <tr className="border-b">
            {COLUMNS.map(([label, width]) => (
              <TableHead
                key={label}
                scope="col"
                style={{ width }}
                className="h-10 px-3 text-xs font-medium text-muted-foreground last:text-right"
              >
                {label}
              </TableHead>
            ))}
          </tr>
        </TableHeader>
        <tbody className="divide-y max-[1100px]:block">{children}</tbody>
      </Table>
    </div>
  );
}

function RowShell({ className, avatar, title, sub, personaTitle, personaSub, personaSubProps, badge, online, flood, actions, ...props }) {
  return (
    <tr className={cn(ROW, className)} {...props}>
      <TableCell className={cn(CELL, 'max-[1100px]:col-start-1 max-[1100px]:row-start-1')}>
        <div className="flex min-w-0 items-center gap-2.5">
          {avatar}
          <div className="min-w-0 flex-1">
            <div className={cn(TITLE_LINE, 'font-semibold text-foreground')}>{title}</div>
            <div className={cn(SUB_LINE, 'gap-x-2.5 gap-y-0.5')}>{sub}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, 'max-[1100px]:col-start-1 max-[1100px]:row-start-2 max-sm:col-span-full')}>
        <div className={cn(TITLE_LINE, 'font-medium')}>{personaTitle}</div>
        <div className={cn(SUB_LINE, 'items-baseline gap-x-2 gap-y-0.5')} {...personaSubProps}>{personaSub}</div>
      </TableCell>
      <TableCell className={cn(CELL, 'max-[1100px]:col-start-2 max-[1100px]:row-start-1 max-[1100px]:justify-self-end max-sm:max-w-[104px]')}>
        <div className="flex flex-col items-start gap-1 max-[1100px]:items-end">
          {badge}
          {online}
          {flood}
        </div>
      </TableCell>
      <TableCell className={cn(CELL, 'max-[1100px]:col-start-2 max-[1100px]:row-start-2 max-[1100px]:self-end max-sm:col-span-full max-sm:row-start-3')}>
        <div className="flex flex-wrap items-center justify-end gap-2 max-sm:justify-start">{actions}</div>
      </TableCell>
    </tr>
  );
}

// Полоска-заглушка внутри строки текста. Обёртка <span> наследует line-height
// строки, поэтому занимает ровно одну её высоту — и как инлайн, и как
// flex-элемент; сама полоска ниже строки и выровнена по середине.
function Bar({ className }) {
  return (
    <span>
      <Skeleton className={cn('inline-block h-3 align-middle', className)} />
    </span>
  );
}

// Заглушка кнопки строки: тот же Button outline/sm (та же высота, рамка и поля) с тем же
// текстом, только невидимым, — ширина и перенос кнопок совпадают с настоящими.
function GhostButton({ children }) {
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className="pointer-events-none animate-pulse border-transparent bg-accent text-transparent shadow-none select-none dark:border-transparent dark:bg-accent"
    >
      <span>{children}</span>
    </Button>
  );
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
          className="hover:bg-transparent"
          avatar={<Skeleton className={AVATAR_BOX} />}
          title={<Bar className="h-3.5 w-40 max-w-full" />}
          sub={<Bar className="w-24" />}
          personaTitle={<Bar className="h-3.5 w-28 max-w-full" />}
          personaSub={<Bar className="w-36 max-w-full" />}
          badge={<Badge variant="secondary" className="w-16 animate-pulse bg-accent">{' '}</Badge>}
          online={<span className={ONLINE_LINE}><Bar className="w-14" /></span>}
          flood={<span className={FLOOD_LINE} />}
          actions={<><GhostButton>Изменить</GhostButton><GhostButton>Пауза</GhostButton><GhostButton>Ещё<ChevronDown /></GhostButton></>}
        />
      ))}
    </Frame>
  );
}

export function AccountsTable({ rows, alive, onEdit, onLogin, onProxy, onStatus, onClearFlood, onDelete, helpers }) {
  const pending = ux.useActions().pending;
  const [expanded, setExpanded] = useState(null);
  const { Avatar, statusLabel, date } = helpers;

  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Аккаунтов нет. Добавьте номер, затем войдите — код придёт в Telegram.</p>;
  }

  return (
    <Frame tableProps={{ 'aria-label': 'Telegram-аккаунты' }}>
          {rows.map((row) => {
            const busy = pending.some(
              (key) => key.split(':').slice(1).join(':') === `/api/tg-accounts/${row.id}` || key.includes(`/api/tg-accounts/${row.id}/`),
            );
            const name = row.display_name || (row.username ? `@${row.username}` : row.phone_e164 || `Аккаунт #${row.id}`);
            const online = alive[row.id] ?? row.online;
            const open = expanded === row.id;
            const loginNeeded = row.status === 'unauthorized' || row.status === 'banned';
            const detailsId = `account-details-${row.id}`;
            const lost = row.status === 'unauthorized' && row.lost_at;
            const facts = [
              ['ID аккаунта', `#${row.id}`], ['Диалогов', row.chats ?? 0],
              ['Прокси', row.needs_proxy_setup ? 'Не задан' : row.proxy_label || row.proxy_geo || 'Задан'],
              ['Назначение', row.purpose === 'test' ? 'Тестовый' : row.purpose === 'prod' ? 'Рабочий' : row.purpose || '—'],
              ['Последний вход', date(row.last_login_at)], ['Пульс', date(row.last_heartbeat_at)],
              ['Лимит сообщений в день', row.daily_msg_quota ?? 'Без лимита'],
            ];
            return (
              <Fragment key={row.id}>
                <RowShell
                  data-account-id={row.id}
                  className={cn(open && 'bg-muted/50 max-[1100px]:mb-0 max-[1100px]:rounded-b-none')}
                  avatar={(
                    <Avatar
                      className={cn('flex items-center justify-center border bg-muted text-[11px] font-bold text-muted-foreground', AVATAR_BOX)}
                      src={row.avatar_url}
                      name={name}
                    />
                  )}
                  title={name}
                  sub={(
                    <>
                      {row.username && row.display_name && (
                        <a className="text-primary hover:underline" href={`https://t.me/${row.username}`} target="_blank" rel="noreferrer">
                          @{row.username}
                        </a>
                      )}
                      {row.username && !row.display_name && (
                        <a className="text-primary hover:underline" href={`https://t.me/${row.username}`} target="_blank" rel="noreferrer" aria-label={`Профиль ${row.username}`}>
                          Telegram
                        </a>
                      )}
                      {row.phone_e164 && row.phone_e164 !== name && <span className="font-mono tabular-nums">{row.phone_e164}</span>}
                    </>
                  )}
                  personaTitle={(
                    <>
                      {row.persona_name || row.persona_id || 'Без личности'}
                      {row.purpose === 'test' && <span className="ml-2 text-xs font-normal text-muted-foreground">Тест</span>}
                    </>
                  )}
                  personaSubProps={{ 'data-testid': 'account-owner' }}
                  personaSub={(
                    <>
                      <span className="text-foreground/80" title={row.manager_username ? `Менеджер: ${row.manager_username}` : undefined}>
                        {row.manager_username || 'Без менеджера'}
                      </span>
                      <span className="tabular-nums">{row.region_code ? `Регион ${row.region_code}` : 'Регион не задан'}</span>
                    </>
                  )}
                  badge={(
                    <Badge variant={lost ? 'destructive' : STATUS_VARIANT[row.status] || 'outline'} title={row.lost_reason || undefined}>
                      {statusLabel(row)}
                    </Badge>
                  )}
                  online={(
                    <span className={ONLINE_LINE}>
                      <i aria-hidden className={cn('size-1.5 shrink-0 rounded-full', online ? 'bg-success-foreground' : 'bg-muted-foreground/60')} />
                      {online ? 'В сети' : 'Не в сети'}
                    </span>
                  )}
                  flood={(
                    <span
                      className={FLOOD_LINE}
                      title={row.flood_until ? `Ограничение Telegram до ${date(row.flood_until)}` : undefined}
                    >
                      {row.flood_until ? 'Ограничен' : ''}
                    </span>
                  )}
                  actions={(
                    <>
                      <RowButton disabled={busy} onClick={() => onEdit(row)}>Изменить</RowButton>
                      {loginNeeded ? (
                        <RowButton disabled={busy} onClick={() => onLogin(row)}>Войти</RowButton>
                      ) : row.status === 'active' ? (
                        <RowButton disabled={busy} onClick={() => onStatus(row, 'paused')}>Пауза</RowButton>
                      ) : row.status === 'paused' ? (
                        <RowButton disabled={busy} onClick={() => onStatus(row, 'active')}>Включить</RowButton>
                      ) : null}
                      <RowButton
                        disabled={busy}
                        onClick={() => setExpanded(open ? null : row.id)}
                        aria-expanded={open}
                        aria-controls={detailsId}
                        aria-label={`Ещё: ${name}`}
                        className={cn(open && 'bg-accent text-accent-foreground')}
                      >
                        Ещё
                        <ChevronDown aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
                      </RowButton>
                    </>
                  )}
                />
                {open && (
                  <tr className="bg-muted/30 max-[1100px]:mb-3 max-[1100px]:block max-[1100px]:rounded-b-lg max-[1100px]:border max-[1100px]:border-t-0 max-[1100px]:bg-card">
                    <td colSpan={4} className="p-3 pt-0 whitespace-normal max-[1100px]:block max-[1100px]:p-4 max-[1100px]:pt-0 max-sm:p-3.5 max-sm:pt-0">
                      <div id={detailsId} role="region" aria-label={`Подробности: ${name}`} className="pt-3">
                        <dl className="m-0 grid grid-cols-4 gap-x-5 gap-y-3.5 tabular-nums max-[1100px]:grid-cols-3 max-sm:grid-cols-2">
                          {facts.map(([label, value]) => (
                            <div key={label} className="min-w-0">
                              <dt className="text-xs leading-5 text-muted-foreground">{label}</dt>
                              <dd className="m-0 mt-0.5 text-sm leading-5 [overflow-wrap:anywhere]">{value}</dd>
                            </div>
                          ))}
                        </dl>
                        {row.lost_at && (
                          <p className="mt-3 text-xs leading-5 text-destructive [overflow-wrap:anywhere]">
                            {`${row.lost_reason || 'Аккаунт потерян'} · ${date(row.lost_at)}`}
                          </p>
                        )}
                        {row.flood_until && (
                          <p className="mt-3 text-xs leading-5 text-destructive [overflow-wrap:anywhere]">
                            {`${row.flood_reason || 'Ограничение Telegram'} · до ${date(row.flood_until)}`}
                          </p>
                        )}
                        <div className="mt-3.5 flex flex-wrap gap-2 border-t pt-3.5">
                          <RowButton disabled={busy} onClick={() => onProxy(row)}>Прокси</RowButton>
                          {!loginNeeded && row.status !== 'retired' && <RowButton disabled={busy} onClick={() => onLogin(row)}>Перелогин</RowButton>}
                          {row.flood_until && (
                            <RowButton disabled={busy} onClick={() => onClearFlood(row)} title="Аккаунт снова будет брать новых лидов">Снять флуд</RowButton>
                          )}
                          {row.status !== 'retired' && row.status !== 'banned' && <RowButton disabled={busy} onClick={() => onStatus(row, 'retired')}>Вывести</RowButton>}
                          <Button type="button" variant="ghost" size="sm" disabled={busy} className="text-destructive hover:text-destructive" onClick={() => onDelete(row)}>
                            Удалить
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
