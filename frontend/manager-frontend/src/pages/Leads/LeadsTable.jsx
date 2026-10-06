import { Fragment, useEffect, useState } from 'react';
import { CircleAlert, ListPlus, ListX, MessageSquare, MoreHorizontal, RotateCcw, Shuffle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PanelUX as ux } from '../../ui/PanelUX';
import { Attribution } from '../../components/Attribution/Attribution';
import { IconAction } from '../../components/IconAction/IconAction';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const SKELETON_ROWS = 8;

/* От 1000px — таблица с фиксированными колонками (ширины не зависят от
   содержимого, поэтому опрос и листание ничего не двигают). Уже 1000px строка
   складывается в столбик: галочка | лид | действия, ниже статус, личность,
   менеджер. Блок остаётся одной рамкой с разделителями, без карточек. */
const stack = {
  table: 'table-fixed max-[1000px]:block',
  head: 'max-[1000px]:block',
  headRow: 'max-[1000px]:flex max-[1000px]:items-center',
  headCell: 'max-[1000px]:hidden',
  body: 'max-[1000px]:block',
  row: 'max-[1000px]:grid max-[1000px]:grid-cols-[auto_minmax(0,1fr)_auto] max-[1000px]:gap-x-3 max-[1000px]:gap-y-2 max-[1000px]:p-3',
  cell: 'max-[1000px]:block max-[1000px]:p-0',
  check: 'max-[1000px]:col-start-1 max-[1000px]:row-start-1 max-[1000px]:pt-0.5',
  lead: 'max-[1000px]:col-start-2 max-[1000px]:row-start-1',
  actions: 'max-[1000px]:col-start-3 max-[1000px]:row-start-1',
  status: 'max-[1000px]:col-span-2 max-[1000px]:col-start-2 max-[1000px]:row-start-2',
  persona: 'max-[1000px]:col-span-2 max-[1000px]:col-start-2 max-[1000px]:row-start-3',
  owner: 'max-[1000px]:col-span-2 max-[1000px]:col-start-2 max-[1000px]:row-start-4',
};

/* Ячейка — две строки фиксированной высоты (20 + 16). Скелет собран из тех же
   строк, поэтому высота строки до и после загрузки совпадает сама собой. */
const lines = 'flex min-w-0 flex-col gap-0.5';
const line1 = 'flex h-5 min-w-0 items-center';
const line2 = 'h-4 min-w-0 truncate text-xs leading-4 text-muted-foreground';
const headCell = 'h-9 text-xs font-medium text-muted-foreground';

const COLUMNS = [
  ['Лид', ''],
  ['Личность', 'w-[18%]'],
  ['Менеджер · аккаунт', 'w-[24%]'],
  ['Статус', 'w-[190px]'],
];

function TelegramLink({ username }) {
  return <a className="text-primary underline-offset-4 hover:underline" href={`https://t.me/${username}`} target="_blank" rel="noreferrer">@{username}</a>;
}

/* Radix-чекбокс рисует галочку и в состоянии indeterminate; здесь вместо неё
   показываем короткую черту. */
function SelectAllCheckbox(props) {
  return (
    <Checkbox
      className="data-[state=indeterminate]:flex data-[state=indeterminate]:items-center data-[state=indeterminate]:justify-center data-[state=indeterminate]:border-primary data-[state=indeterminate]:after:h-0.5 data-[state=indeterminate]:after:w-2 data-[state=indeterminate]:after:rounded-full data-[state=indeterminate]:after:bg-primary data-[state=indeterminate]:after:content-[''] data-[state=indeterminate]:[&_svg]:hidden"
      {...props}
    />
  );
}

/* Текст ошибки открывается поверх таблицы и не меняет высоту строки. */
function ErrorDetails({ name, text }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Подробнее об ошибке: ${name}`}
          title="Подробнее об ошибке"
          className="grid size-5 shrink-0 place-items-center rounded-sm text-destructive outline-none hover:bg-destructive/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <CircleAlert className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-60 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto text-xs leading-5">
        <p className="mb-1 font-medium">Ошибка</p>
        <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{text}</p>
      </PopoverContent>
    </Popover>
  );
}

function SkeletonRow() {
  const two = (first, second) => (
    <div className={lines}>
      <div className={line1}><Skeleton className={cn('h-3.5', first)} /></div>
      <div className="flex h-4 items-center"><Skeleton className={cn('h-3', second)} /></div>
    </div>
  );
  return (
    <TableRow className={cn(stack.row, 'hover:bg-transparent')} aria-hidden="true">
      <TableCell className={cn('pl-3', stack.cell, stack.check)}><Skeleton className="size-4" /></TableCell>
      <TableCell className={cn(stack.cell, stack.lead)}>{two('w-2/5', 'w-3/5')}</TableCell>
      <TableCell className={cn(stack.cell, stack.persona)}><div className="flex h-8 items-center"><Skeleton className="h-3.5 w-3/5" /></div></TableCell>
      <TableCell className={cn(stack.cell, stack.owner)}>{two('w-3/5', 'w-2/5')}</TableCell>
      <TableCell className={cn(stack.cell, stack.status)}>{two('w-20', 'w-28')}</TableCell>
      <TableCell className={cn('pr-3', stack.cell, stack.actions)}><div className="flex h-8 items-center justify-end"><Skeleton className="size-5" /></div></TableCell>
    </TableRow>
  );
}

export function LeadsTable({ rows, query, status, selected, onToggle, onSelectVisible, onChat, onQueue, onUnqueue, onReassign, onDelete, onPersonaChange, personas, helpers }) {
  const { PersonaSelect, statusLabels, statusBadges, date } = helpers;
  const busy = ux.useActions().pending.some(key => key.includes('/api/leads'));
  const loading = rows == null;
  const list = rows ?? [];
  const allSelected = list.length > 0 && list.every(row => selected.has(row.id));
  const someSelected = list.some(row => selected.has(row.id));
  // Оптимистичное значение личности держится до следующего ответа сервера.
  const [pendingPersona, setPendingPersona] = useState({});
  useEffect(() => { setPendingPersona({}); }, [rows]);
  const changePersona = (id, persona) => {
    setPendingPersona(previous => ({ ...previous, [id]: persona }));
    onPersonaChange(id, persona);
  };

  return (
    <div data-testid="leads-list" className="min-w-0 w-full rounded-lg border bg-card">
      <div role="status" className="sr-only">{loading ? 'Загружаем лидов…' : ''}</div>
      <Table className={stack.table} aria-label="Лиды" aria-busy={loading}>
        <TableHeader className={stack.head}>
          <TableRow className={cn(stack.headRow, 'hover:bg-transparent')}>
            <TableHead scope="col" className={cn(headCell, 'w-9 pl-3 max-[1000px]:w-auto')}>
              <label className="flex items-center gap-2">
                <SelectAllCheckbox
                  aria-label="Выбрать лидов на странице"
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  disabled={list.length === 0}
                  onCheckedChange={checked => onSelectVisible(checked === true)}
                />
                <span className="hidden font-normal max-[1000px]:inline" aria-hidden="true">Выбрать все на странице</span>
              </label>
            </TableHead>
            {COLUMNS.map(([title, width]) => (
              <TableHead key={title} scope="col" className={cn(headCell, width, stack.headCell)}>{title}</TableHead>
            ))}
            <TableHead scope="col" className={cn(headCell, 'w-[116px]', stack.headCell)}><span className="sr-only">Действия</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className={stack.body}>
          {loading && Array.from({ length: SKELETON_ROWS }, (_, i) => <SkeletonRow key={i} />)}
          {!loading && list.length === 0 && (
            <TableRow className="hover:bg-transparent max-[1000px]:block">
              <TableCell colSpan={6} className="h-32 px-4 text-center text-sm whitespace-normal text-muted-foreground max-[1000px]:flex max-[1000px]:items-center max-[1000px]:justify-center">
                {query || status ? 'По этим условиям лидов нет. Измените поиск или фильтр.' : 'Лидов пока нет. Добавьте контакт или импортируйте список.'}
              </TableCell>
            </TableRow>
          )}
          {list.map(row => {
            const name = row.first_name || row.phone_e164 || (row.username ? `@${row.username}` : `Лид #${row.id}`);
            const canChat = row.telegram_user_id && ['contacted', 'replied', 'assigned'].includes(row.status);
            const senderId = row.assigned_account_id || row.preferred_account_id;
            const senderUsername = row.assigned_account_id ? row.assigned_account_username : row.preferred_account_username;
            const canReassign = !row.first_contact_at && senderId && ['pending', 'queued', 'assigned', 'dead'].includes(row.status);
            const isSelected = selected.has(row.id);
            const badge = statusBadges[row.status] ?? { variant: 'outline' };
            // Первая строка — имя; без имени туда поднимается сам контакт.
            const phone = row.phone_e164 ? <span className="font-mono">{row.phone_e164}</span> : null;
            const link = row.username ? <TelegramLink username={row.username} /> : null;
            const heading = row.first_name || phone || link || name;
            const details = [
              row.age ? `${row.age} лет` : null,
              row.city,
              row.first_name ? phone : null,
              row.first_name || row.phone_e164 ? link : null,
              row.site,
            ].filter(Boolean);
            const telegram = row.telegram_username ? `@${row.telegram_username}` : row.telegram_user_id ? String(row.telegram_user_id) : null;
            const leadTitle = [
              name,
              row.age ? `${row.age} лет` : null,
              row.city,
              row.first_name ? row.phone_e164 : null,
              row.username && name !== `@${row.username}` ? `@${row.username}` : null,
              row.site ? `сайт: ${row.site}` : null,
              `лид #${row.id}`,
              telegram ? `Telegram: ${telegram}` : null,
            ].filter(Boolean).join(' · ');
            const personaText = row.persona_name || row.persona_id || 'Не указана';
            const sender = senderId ? `${senderUsername ? `@${senderUsername} ` : ''}#${senderId}` : 'автоматически';
            const senderLabel = row.preferred_account_id && !row.first_contact_at ? 'Выбран: ' : 'Аккаунт: ';
            return (
              <TableRow key={row.id} className={stack.row} data-state={isSelected ? 'selected' : undefined} data-lead-id={row.id} data-lead-status={row.status}>
                <TableCell className={cn('pl-3', stack.cell, stack.check)}>
                  <Checkbox className="block" checked={isSelected} aria-label={`Выбрать лид: ${name}`} onCheckedChange={() => onToggle(row.id)} />
                </TableCell>
                <TableCell className={cn(stack.cell, stack.lead)}>
                  <div className={lines} title={leadTitle}>
                    <div className={line1}><span className="truncate text-sm font-medium">{heading}</span></div>
                    <div className={line2}>
                      {details.map((part, i) => <Fragment key={i}>{i > 0 && ' · '}{part}</Fragment>)}
                    </div>
                  </div>
                </TableCell>
                <TableCell className={cn(stack.cell, stack.persona)}>
                  <div className="flex h-8 min-w-0 items-center">
                    {row.first_contact_at || row.preferred_account_id ? (
                      <span className="truncate text-sm" title={row.preferred_account_id ? `${personaText} — личность выбранного аккаунта` : personaText}>{personaText}</span>
                    ) : (
                      <label className="block min-w-0 flex-1">
                        <span className="sr-only">{`Личность лида: ${name}`}</span>
                        <PersonaSelect personas={personas} value={pendingPersona[row.id] ?? row.persona_id} className="h-8 text-xs text-ellipsis" disabled={busy} onChange={persona => changePersona(row.id, persona)} />
                      </label>
                    )}
                  </div>
                </TableCell>
                <TableCell className={cn(stack.cell, stack.owner)}>
                  <div className={lines} title={`Менеджер: ${row.manager_username || 'не назначен'} · Регион: ${row.region_code || 'не задан'} · ${senderLabel}${sender}`}>
                    <Attribution value={row} compact className="h-5 flex-row items-center gap-x-2 overflow-hidden leading-5 whitespace-nowrap [&>span]:min-w-0 [&>span]:truncate" />
                    <div className={line2}>
                      {senderLabel}
                      {senderId ? <span className="text-foreground">{senderUsername && <TelegramLink username={senderUsername} />}<span className="font-mono">{` #${senderId}`}</span></span> : 'автоматически'}
                    </div>
                  </div>
                </TableCell>
                <TableCell className={cn(stack.cell, stack.status)}>
                  <div className={lines}>
                    <div className={cn(line1, 'gap-1')}>
                      <Badge variant={badge.variant} className={cn('h-5', badge.className)}>{statusLabels[row.status] || row.status}</Badge>
                      {row.last_error && <ErrorDetails name={name} text={row.last_error} />}
                    </div>
                    <div className={cn(line2, 'tabular-nums')}>{row.first_contact_at ? `Написали: ${date(row.first_contact_at)}` : 'Ещё не писали'}</div>
                  </div>
                </TableCell>
                <TableCell className={cn('pr-3', stack.cell, stack.actions)}>
                  <div className="flex h-8 items-center justify-end gap-0.5">
                    {canChat && <IconAction icon={MessageSquare} label={`Открыть диалог: ${name}`} hint="Открыть диалог" disabled={busy} onClick={() => onChat(row.telegram_user_id)} />}
                    {row.status === 'pending' && <IconAction icon={ListPlus} label="В очередь" disabled={busy} onClick={() => onQueue([row.id])} />}
                    {row.status === 'dead' && <IconAction icon={RotateCcw} label="Ещё раз" hint="Ещё раз поставить в очередь" disabled={busy} onClick={() => onQueue([row.id])} />}
                    {row.status === 'queued' && <IconAction icon={ListX} label="Снять" hint="Снять с очереди" disabled={busy} onClick={() => onUnqueue([row.id])} />}
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <IconAction icon={MoreHorizontal} label="Ещё" disabled={busy} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        {canReassign && (
                          <>
                            <DropdownMenuItem className="items-start" onSelect={() => onReassign(row)}>
                              <Shuffle className="mt-0.5" aria-hidden="true" />
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span>Написать с другого</span>
                                <span className="text-xs text-muted-foreground">
                                  {`Отдать лид другому аккаунту — ${senderUsername ? `@${senderUsername}` : `#${senderId}`} его больше не возьмёт`}
                                </span>
                              </span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(row)}>
                          <Trash2 aria-hidden="true" />
                          Удалить
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
