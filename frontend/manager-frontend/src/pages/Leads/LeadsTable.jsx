import { Fragment, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PanelUX as ux } from '../../ui/PanelUX';
import { Attribution } from '../../components/Attribution/Attribution';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  denseTable,
  stickyLastCol,
} from '@/components/ui/table';

const COLUMNS = [
  ['Лид и контакт', '27%'],
  ['Менеджер / регион', '22%'],
  ['Личность', '18%'],
  ['Статус', '19%'],
  ['Действия', '14%'],
];
const SKELETON_ROWS = 6;

/* Карточный режим: до 1000px строка таблицы превращается в сетку 2×3,
   до 560px — в 2×4 (владелец и действия на всю ширину). */
const card = {
  table: 'max-[1000px]:block',
  head: 'max-[1000px]:hidden',
  body: 'max-[1000px]:grid max-[1000px]:gap-3 max-[1000px]:p-3',
  row: 'max-[1000px]:grid max-[1000px]:grid-cols-2 max-[1000px]:gap-4 max-[1000px]:rounded-lg max-[1000px]:border-0 max-[1000px]:bg-card max-[1000px]:p-4 max-[1000px]:ring-1 max-[1000px]:ring-border max-[1000px]:data-[state=selected]:ring-primary/60 max-[560px]:gap-x-3 max-[560px]:gap-y-3.5 max-[560px]:p-3.5',
  cell: 'max-[1000px]:block',
  person: 'max-[1000px]:col-span-full max-[1000px]:row-start-1',
  owner: 'max-[1000px]:col-start-1 max-[1000px]:row-start-2 max-[560px]:col-span-full',
  persona: 'max-[1000px]:col-start-2 max-[1000px]:row-start-2 max-[560px]:col-start-1 max-[560px]:col-span-1 max-[560px]:row-start-3',
  status: 'max-[1000px]:col-start-1 max-[1000px]:row-start-3 max-[560px]:col-start-2',
  actions: 'max-[1000px]:col-start-2 max-[1000px]:row-start-3 max-[560px]:col-span-full max-[560px]:col-start-1 max-[560px]:row-start-4',
  label: 'max-[1000px]:before:mb-1.5 max-[1000px]:before:block max-[1000px]:before:text-xs max-[1000px]:before:text-muted-foreground max-[1000px]:before:content-[attr(data-label)]',
};

const muted = 'text-xs text-muted-foreground';

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

function SkeletonRows() {
  return (
    <div role="status" className="divide-y" aria-label="Загружаем лидов…">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div key={i} className="flex min-h-[116px] items-start gap-3 p-2">
          <Skeleton className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-1/5" />
          </div>
          <Skeleton className="h-5 w-20 shrink-0" />
          <Skeleton className="h-8 w-24 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function LeadsTable({ rows, query, status, selected, onToggle, onSelectVisible, onClearSelection, onChat, onQueue, onUnqueue, onReassign, onDelete, onPersonaChange, personas, helpers }) {
  const { PersonaSelect, statusLabels, statusBadges, date } = helpers;
  const busy = ux.useActions().pending.some(key => key.includes('/api/leads'));
  const loading = rows == null;
  const list = rows ?? [];
  const allSelected = list.length > 0 && list.every(row => selected.has(row.id));
  const someSelected = list.some(row => selected.has(row.id));
  const ids = [...selected];
  // Оптимистичное значение личности держится до следующего ответа сервера.
  const [pendingPersona, setPendingPersona] = useState({});
  useEffect(() => { setPendingPersona({}); }, [rows]);
  const changePersona = (id, persona) => {
    setPendingPersona(previous => ({ ...previous, [id]: persona }));
    onPersonaChange(id, persona);
  };
  const rowAction = (text, onClick, props = {}) => (
    <Button type="button" size="sm" variant="outline" onClick={onClick} disabled={busy} {...props}>{text}</Button>
  );

  return (
    <div data-testid="leads-list" className="min-w-0 w-full">
      <div className="mb-3 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2">
        <label className={cn('flex cursor-pointer items-center gap-2', muted, list.length === 0 && 'cursor-default')}>
          <SelectAllCheckbox
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            disabled={list.length === 0}
            onCheckedChange={checked => onSelectVisible(checked === true)}
          />
          Выбрать показанные
        </label>
        <span className={cn(muted, 'min-w-[11ch] tabular-nums')} role="status">{selected.size ? `Выбрано: ${selected.size}` : `Показано: ${list.length}`}</span>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => onQueue(ids)}><span>В очередь (<span className="tabular-nums">{selected.size}</span>)</span></Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onUnqueue(ids)}><span>Снять (<span className="tabular-nums">{selected.size}</span>)</span></Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onClearSelection}>Снять выделение</Button>
          </div>
        )}
      </div>
      <div className="rounded-lg border bg-card">
        {loading ? <SkeletonRows /> : list.length === 0 ? (
          <div className="flex min-h-[116px] items-center justify-center px-4 py-7 text-center text-sm leading-relaxed text-muted-foreground">
            {query || status ? 'По этим условиям лидов нет. Измените поиск или фильтр.' : 'Лидов пока нет. Добавьте контакт или импортируйте список.'}
          </div>
        ) : (
          <Table className={cn(stickyLastCol, denseTable, card.table, 'max-[1000px]:[&_td:last-child]:static')} aria-label="Лиды">
            <TableHeader className={card.head}>
              <TableRow>
                {COLUMNS.map(([title, width]) => (
                  <TableHead key={title} scope="col" style={{ width }} className="text-xs font-medium text-muted-foreground">{title}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className={card.body}>
              {list.map(row => {
                const name = row.first_name || row.phone_e164 || (row.username ? `@${row.username}` : `Лид #${row.id}`);
                const canChat = row.telegram_user_id && ['contacted', 'replied', 'assigned'].includes(row.status);
                const senderId = row.assigned_account_id || row.preferred_account_id;
                const senderUsername = row.assigned_account_id ? row.assigned_account_username : row.preferred_account_username;
                const isSelected = selected.has(row.id);
                const badge = statusBadges[row.status] ?? { variant: 'outline' };
                const cell = 'align-top whitespace-normal [overflow-wrap:anywhere]';
                return (
                  <TableRow key={row.id} className={card.row} data-state={isSelected ? 'selected' : undefined} data-lead-id={row.id} data-lead-status={row.status}>
                    <TableCell className={cn(cell, card.cell, card.person, '[&:has([role=checkbox])]:pr-2')}>
                      <label className="mb-1 flex cursor-pointer items-start gap-2">
                        <Checkbox className="mt-0.5" checked={isSelected} aria-label={`Выбрать лид: ${name}`} onCheckedChange={() => onToggle(row.id)} />
                        <span className="text-sm leading-5 font-semibold">{name}</span>
                      </label>
                      <div className={muted}>{[row.age ? `${row.age} лет` : null, row.city].filter(Boolean).join(' · ') || 'Возраст и город не указаны'}</div>
                      <div className="flex flex-wrap gap-x-2 font-mono text-xs">{row.phone_e164 || null}{row.username && <TelegramLink username={row.username} />}</div>
                      <div className={cn(muted, 'font-mono')}>#{row.id}{row.site ? ` · Сайт: ${row.site}` : ''}</div>
                      {(row.telegram_username || row.telegram_user_id) && (
                        <div className="mt-2 text-xs"><span className="text-muted-foreground">Telegram: </span>{row.telegram_username ? <TelegramLink username={row.telegram_username} /> : <span className="font-mono">{String(row.telegram_user_id)}</span>}</div>
                      )}
                    </TableCell>
                    <TableCell className={cn(cell, card.cell, card.owner)}>
                      <Attribution value={row} />
                      <div className="mt-2 text-xs">
                        <span className="text-muted-foreground">{row.preferred_account_id && !row.first_contact_at ? 'Выбран: ' : 'Аккаунт: '}</span>
                        {senderId ? <Fragment>{senderUsername && <TelegramLink username={senderUsername} />}<span className="font-mono">{` #${senderId}`}</span></Fragment> : 'автоматически'}
                      </div>
                    </TableCell>
                    <TableCell className={cn(cell, card.cell, card.persona, card.label)} data-label="Личность">
                      {row.first_contact_at || row.preferred_account_id ? (
                        <span className="text-sm font-medium" title={row.preferred_account_id ? 'Личность выбранного аккаунта' : undefined}>{row.persona_name || row.persona_id || 'Не указана'}</span>
                      ) : (
                        <label className="block min-w-0 max-w-full">
                          <span className="sr-only">{`Личность лида: ${name}`}</span>
                          <PersonaSelect personas={personas} value={pendingPersona[row.id] ?? row.persona_id} className="h-8 text-xs text-ellipsis" disabled={busy} onChange={persona => changePersona(row.id, persona)} />
                        </label>
                      )}
                    </TableCell>
                    <TableCell className={cn(cell, card.cell, card.status, card.label)} data-label="Статус">
                      <Badge variant={badge.variant} className={cn('h-5 whitespace-normal', badge.className)}>{statusLabels[row.status] || row.status}</Badge>
                      <div className={cn(muted, 'mt-2 tabular-nums')}>{row.first_contact_at ? `Написали: ${date(row.first_contact_at)}` : 'Ещё не писали'}</div>
                      {row.last_error && (
                        <details className="mt-2 text-xs text-destructive">
                          <summary className="cursor-pointer leading-5">Подробнее об ошибке</summary>
                          <p className="mt-2 leading-5 whitespace-pre-wrap text-foreground/80 [overflow-wrap:anywhere]">{row.last_error}</p>
                        </details>
                      )}
                    </TableCell>
                    <TableCell className={cn(cell, card.cell, card.actions)}>
                      <div className="flex min-h-8 flex-col items-start gap-1.5 max-[1000px]:flex-row max-[1000px]:flex-wrap">
                        {canChat && (
                          <Button type="button" size="sm" variant="outline" aria-label={`Открыть диалог: ${name}`} disabled={busy} onClick={() => onChat(row.telegram_user_id)}>
                            Открыть<ChevronRight />
                          </Button>
                        )}
                        {['pending', 'dead'].includes(row.status) && rowAction(row.status === 'dead' ? 'Ещё раз' : 'В очередь', () => onQueue([row.id]))}
                        {row.status === 'queued' && rowAction('Снять', () => onUnqueue([row.id]))}
                        {!row.first_contact_at && senderId && ['pending', 'queued', 'assigned', 'dead'].includes(row.status) && rowAction('Написать с другого', () => onReassign(row), { title: `Отдать лид другому аккаунту — ${senderUsername ? `@${senderUsername}` : `#${senderId}`} его больше не возьмёт` })}
                        {rowAction('Удалить', () => onDelete(row), { variant: 'ghost', className: 'text-destructive hover:text-destructive' })}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
