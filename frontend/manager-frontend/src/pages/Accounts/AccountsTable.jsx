import { Fragment, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { PanelUX as ux } from '../../ui/PanelUX';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

export function AccountsTable({ rows, alive, onEdit, onLogin, onProxy, onStatus, onClearFlood, onDelete, helpers }) {
  const pending = ux.useActions().pending;
  const [expanded, setExpanded] = useState(null);
  const { Avatar, statusLabel, date } = helpers;

  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Аккаунтов нет. Добавьте номер, затем войдите — код придёт в Telegram.</p>;
  }

  return (
    <div className="rounded-lg border bg-card max-[1100px]:border-0 max-[1100px]:bg-transparent">
      <Table aria-label="Telegram-аккаунты" className="table-fixed max-[1100px]:block">
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
        <tbody className="divide-y max-[1100px]:block">
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
                <tr
                  data-account-id={row.id}
                  className={cn(
                    'transition-colors hover:bg-muted/50',
                    open && 'bg-muted/50',
                    'max-[1100px]:mb-3 max-[1100px]:grid max-[1100px]:grid-cols-[minmax(0,1fr)_minmax(120px,0.7fr)] max-[1100px]:gap-x-5 max-[1100px]:gap-y-3.5 max-[1100px]:rounded-lg max-[1100px]:border max-[1100px]:bg-card max-[1100px]:p-4',
                    'max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-2.5 max-sm:p-3.5',
                    open && 'max-[1100px]:mb-0 max-[1100px]:rounded-b-none',
                  )}
                >
                  <TableCell className={cn(CELL, 'max-[1100px]:col-start-1 max-[1100px]:row-start-1')}>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar
                        className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted text-[11px] font-bold text-muted-foreground"
                        src={row.avatar_url}
                        name={name}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold leading-6 text-foreground">{name}</div>
                        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs leading-5 text-muted-foreground">
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
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={cn(CELL, 'max-[1100px]:col-start-1 max-[1100px]:row-start-2 max-sm:col-span-full')}>
                    <div className="text-sm font-medium leading-6">
                      {row.persona_name || row.persona_id || 'Без личности'}
                      {row.purpose === 'test' && <span className="ml-2 text-xs font-normal text-muted-foreground">Тест</span>}
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs leading-5 text-muted-foreground" data-testid="account-owner">
                      <span className="text-foreground/80" title={row.manager_username ? `Менеджер: ${row.manager_username}` : undefined}>
                        {row.manager_username || 'Без менеджера'}
                      </span>
                      <span className="tabular-nums">{row.region_code ? `Регион ${row.region_code}` : 'Регион не задан'}</span>
                    </div>
                  </TableCell>
                  <TableCell className={cn(CELL, 'max-[1100px]:col-start-2 max-[1100px]:row-start-1 max-[1100px]:justify-self-end max-sm:max-w-[104px]')}>
                    <div className="flex flex-col items-start gap-1 max-[1100px]:items-end">
                      <Badge variant={lost ? 'destructive' : STATUS_VARIANT[row.status] || 'outline'} title={row.lost_reason || undefined}>
                        {statusLabel(row)}
                      </Badge>
                      <span className="inline-flex min-w-[72px] items-center gap-1.5 text-xs leading-5 text-muted-foreground tabular-nums">
                        <i aria-hidden className={cn('size-1.5 shrink-0 rounded-full', online ? 'bg-success-foreground' : 'bg-muted-foreground/60')} />
                        {online ? 'В сети' : 'Не в сети'}
                      </span>
                      <span
                        className="min-h-4 text-xs leading-4 text-destructive"
                        title={row.flood_until ? `Ограничение Telegram до ${date(row.flood_until)}` : undefined}
                      >
                        {row.flood_until ? 'Ограничен' : ''}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={cn(CELL, 'max-[1100px]:col-start-2 max-[1100px]:row-start-2 max-[1100px]:self-end max-sm:col-span-full max-sm:row-start-3')}>
                    <div className="flex flex-wrap items-center justify-end gap-2 max-sm:justify-start">
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
                    </div>
                  </TableCell>
                </tr>
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
        </tbody>
      </Table>
    </div>
  );
}
