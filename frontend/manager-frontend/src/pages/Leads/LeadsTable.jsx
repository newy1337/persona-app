import { useEffect, useState } from 'react';
import { CircleAlert, Info, ListPlus, ListX, MessageSquare, MoreHorizontal, RotateCcw, Shuffle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PanelUX as ux } from '../../ui/PanelUX';
import { useMe } from '../../components/AppLayout/me';
import { genderLabel } from '../../utils/chat';
import { httpHref } from '../../utils/safeUrl';
import { ColumnFilter } from '../../components/ColumnFilter/ColumnFilter';
import { ColumnPicker } from '../../components/ColumnPicker/ColumnPicker';
import { tableMinWidth, useColumnPrefs } from '../../components/ColumnPicker/columnPrefs';
import { IconAction } from '../../components/IconAction/IconAction';
import { dealStageLabel } from '../../data/dealStages';
import { NEXT_TONE, leadTypeLabel, leadsBy, nextStepState, nextStepWhen, shortDate } from './leadInfo';
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

/* Сетка лидов: одно значение в ячейке, ширины колонок (px) фиксированы (опрос
   и листание ничего не двигают), «Лид» забирает остаток. Какие колонки показывать, пользователь выбирает
   сам — «Настроить поля» в заголовке колонки действий; чекбокс, лида и действия
   скрыть нельзя. Значение скрытой колонки остаётся в подсказке лида, сайт ещё
   и дописывается под имя. Уже минимальной ширины таблица прокручивается
   внутри рамки. «Менеджер» (с регионом) видят админ, хед и тимлид: у менеджера
   там всегда он сам, колонка не рисуется и в настройке полей не предлагается.
   «Источник» — откуда пришёл лид (API LeadGet, холодка, перезабив, донор),
   подробности — в поповере. «Этап» — этап сделки диалога лида (deal_stage),
   его ставит менеджер в диалоге. «Тип», «Следующий шаг» и «Последнее» видны
   сразу; Telegram, сайт, «Написали», «Добавлен» и прочие дополнительные
   колонки включаются в «Настроить поля». Раньше Telegram и сайт сами
   появлялись с 1680px, но «широкие» колонки не входят в минимальную ширину
   таблицы, и на 1920px «Лид» сжимался до нуля. Щелчок по строке открывает
   карточку лида. */
// Меньше этого «Лид» не сжимается.
const FLEX_MIN_WIDTH = 180;
const COLUMNS = [
  { key: 'select', label: 'Выбор', width: 36, required: true, bars: [] },
  { key: 'lead', label: 'Лид', required: true, bars: ['w-28', 'w-24'] },
  { key: 'type', label: 'Тип', width: 104, bars: ['w-14'] },
  { key: 'contact', label: 'Контакт', width: 160, bars: ['w-24'] },
  { key: 'age', label: 'Возраст', width: 96, show: false, bars: ['w-8'] },
  { key: 'city', label: 'Город', width: 136, show: false, bars: ['w-20'] },
  { key: 'gender', label: 'Пол', width: 80, show: false, bars: ['w-8'] },
  { key: 'telegram', label: 'Telegram', width: 168, show: false, bars: ['w-20'] },
  { key: 'site', label: 'Сайт', width: 92, show: false, bars: ['w-12'] },
  { key: 'source', label: 'Источник', width: 150, bars: ['w-16', 'w-20'] },
  { key: 'donor', label: 'Донор', width: 140, show: false, bars: ['w-16', 'w-12'] },
  { key: 'region', label: 'Регион', width: 92, show: false, bars: ['w-8'] },
  { key: 'persona', label: 'Личность', width: 168, bars: ['w-24'] },
  { key: 'manager', label: 'Менеджер', width: 116, adminOnly: true, bars: ['w-16'] },
  { key: 'account', label: 'Аккаунт', width: 152, bars: ['w-20'] },
  { key: 'status', label: 'Статус', width: 164, bars: ['w-20'] },
  { key: 'stage', label: 'Этап', width: 112, bars: ['w-14'] },
  { key: 'next', label: 'Следующий шаг', width: 176, bars: ['w-28', 'w-16'] },
  { key: 'activity', label: 'Последнее', width: 120, bars: ['w-16'] },
  { key: 'unread', label: 'Непрочитанные', width: 136, show: false, bars: ['w-6'] },
  { key: 'leads', label: 'Ведёт', width: 104, show: false, bars: ['w-14'] },
  { key: 'contacted', label: 'Написали', width: 128, show: false, bars: ['w-16'] },
  { key: 'attempts', label: 'Попытки', width: 128, show: false, bars: ['w-8', 'w-16'] },
  { key: 'error', label: 'Ошибка', width: 180, show: false, bars: ['w-24'] },
  { key: 'added', label: 'Добавлен', width: 128, show: false, bars: ['w-16'] },
  { key: 'notes', label: 'Заметки', width: 180, show: false, bars: ['w-24'] },
  { key: 'actions', label: 'Действия', width: 96, required: true, bars: [] },
];
const PUBLIC_COLUMNS = COLUMNS.filter((col) => !col.adminOnly);

/* Высоту строки (52px) задаёт ячейка: в неё помещаются две короткие линии или
   селект личности. Скелет собран из тех же ячеек. */
const cell = 'h-[52px] px-3 py-0 align-middle';
const one = 'flex min-w-0 items-center gap-1.5 text-sm';
const line1 = 'flex h-5 min-w-0 items-center';
const line2 = 'h-4 min-w-0 truncate text-xs leading-4 text-muted-foreground';
const headCell = 'h-9 px-3 text-xs font-medium text-muted-foreground';
const Empty = () => <span className="text-muted-foreground">—</span>;

function TelegramLink({ username }) {
  return <a className="text-primary underline-offset-4 hover:underline" href={`https://t.me/${username}`} target="_blank" rel="noreferrer">@{username}</a>;
}

/* Radix-чекбокс рисует галочку и в состоянии indeterminate; здесь вместо неё
   показываем короткую черту. */
function SelectAllCheckbox({ className, ...props }) {
  return (
    <Checkbox
      className={cn(
        "data-[state=indeterminate]:flex data-[state=indeterminate]:items-center data-[state=indeterminate]:justify-center data-[state=indeterminate]:border-primary data-[state=indeterminate]:after:h-0.5 data-[state=indeterminate]:after:w-2 data-[state=indeterminate]:after:rounded-full data-[state=indeterminate]:after:bg-primary data-[state=indeterminate]:after:content-[''] data-[state=indeterminate]:[&_svg]:hidden",
        className,
      )}
      {...props}
    />
  );
}

/** Сводка входящего лида — как в рабочей панели: источник, регион, личность, метки, донор, аккаунт, ID. */
export function inboundSummary(row) {
  return [
    row.inbound_at ? `Источник: ${row.source_type}` : null,
    row.requested_region ? `Регион: ${row.requested_region}` : null,
    row.requested_persona ? `Личность: ${row.requested_persona}` : null,
    row.reassigned ? 'Перезабив' : null,
    row.cold ? 'Холодка' : null,
    row.donor ? `Донор: ${row.donor}` : null,
    row.account_label ? `Аккаунт: ${row.account_label}` : null,
    row.external_id ? `ID: ${row.external_id}` : null,
  ].filter(Boolean).join(' · ');
}

/* Подробности входящего лида (профиль, история от донора) открываются поверх
   таблицы и не меняют высоту строки. Небезопасная ссылка на профиль — текстом. */
function InboundDetails({ name, row }) {
  const summary = inboundSummary(row);
  const href = row.profile_url ? httpHref(row.profile_url) : null;
  if (!summary && !row.profile_url && !row.last_messages) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Подробнее о лиде: ${name}`}
          title="Откуда лид, профиль, история"
          className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto text-xs leading-5">
        {summary && <p className="text-muted-foreground [overflow-wrap:anywhere]" data-testid="lead-inbound">{summary}</p>}
        {row.profile_url && (
          <p className="mt-1 [overflow-wrap:anywhere]">
            <span className="text-muted-foreground">Профиль: </span>
            {href
              ? <a className="text-primary underline-offset-4 hover:underline" href={href} target="_blank" rel="noreferrer">{row.profile_url.replace(/^https?:\/\//i, '').slice(0, 60)}</a>
              : <span data-testid="profile-text">{String(row.profile_url).slice(0, 60)}</span>}
          </p>
        )}
        {row.last_messages && (
          <>
            <p className="mt-2 font-medium">История общения от донора</p>
            <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{row.last_messages}</p>
          </>
        )}
      </PopoverContent>
    </Popover>
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

function SkeletonRow({ columns }) {
  return (
    <TableRow className="hover:bg-transparent" aria-hidden="true">
      {columns.map((col) => {
        if (col.key === 'select') return <TableCell key={col.key} className={cn(cell, 'pr-0')}><Skeleton className="size-4" /></TableCell>;
        if (col.key === 'actions') return <TableCell key={col.key} className={cell}><div className="flex items-center justify-end"><Skeleton className="size-5" /></div></TableCell>;
        return (
          <TableCell key={col.key} className={cell}>
            <div className={line1}><Skeleton className={cn('h-3.5', col.bars[0])} /></div>
            {col.bars[1] && <div className="flex h-4 items-center"><Skeleton className={cn('h-3', col.bars[1])} /></div>}
          </TableCell>
        );
      })}
    </TableRow>
  );
}

/* filters — фильтры колонок: { defs: { ключ колонки: описание }, state, onChange(key, value) };
   список листается на сервере, поэтому сами строки здесь не отбираются. */
export function LeadsTable({ rows, query, filtered, filters, selected, onToggle, onSelectVisible, onOpen, onChat, onQueue, onUnqueue, onReassign, onDelete, onPersonaChange, personas, helpers }) {
  const { PersonaSelect, statusLabels, statusBadges, date } = helpers;
  const busy = ux.useActions().pending.some(key => key.includes('/api/leads'));
  const me = useMe();
  // Вне каркаса (тесты) — как у руководителя: колонка менеджера есть.
  const admin = !me || me.role !== 'manager';
  const prefs = useColumnPrefs('leads', admin ? COLUMNS : PUBLIC_COLUMNS);
  const { columns, has } = prefs;
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
      <Table className="table-fixed" style={{ minWidth: tableMinWidth(columns, FLEX_MIN_WIDTH) }} aria-label="Лиды" aria-busy={loading}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className={cn(headCell, col.key === 'select' && 'pr-0', col.key === 'actions' && 'px-2')}
              >
                {col.key === 'select' ? (
                  <SelectAllCheckbox
                    className="block"
                    aria-label="Выбрать лидов на странице"
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    disabled={list.length === 0}
                    onCheckedChange={checked => onSelectVisible(checked === true)}
                  />
                ) : col.key === 'actions' ? (
                  <div className="flex items-center justify-end">
                    <span className="sr-only">{col.label}</span>
                    <ColumnPicker prefs={prefs} />
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="truncate">{col.label}</span>
                    {filters?.defs[col.key] && (
                      <ColumnFilter
                        label={col.label}
                        def={filters.defs[col.key]}
                        value={filters.state[col.key]}
                        onChange={value => filters.onChange(col.key, value)}
                      />
                    )}
                  </div>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && Array.from({ length: SKELETON_ROWS }, (_, i) => <SkeletonRow key={i} columns={columns} />)}
          {!loading && list.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="h-32 px-4 text-center text-sm whitespace-normal text-muted-foreground">
                {query || filtered ? 'По этим условиям лидов нет. Измените поиск или фильтр.' : 'Лидов пока нет. Добавьте контакт или импортируйте список.'}
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
            const about = [row.age ? `${row.age} лет` : null, genderLabel(row.gender, true), row.city].filter(Boolean).join(' · ');
            const inbound = inboundSummary(row);
            const tags = [row.cold ? 'Холодка' : null, row.reassigned ? 'Перезабив' : null, row.donor ? `донор ${row.donor}` : null].filter(Boolean);
            const firstMessage = row.first_message ? `${row.first_contact_at ? 'Первое сообщение' : 'Напишем'}: ${row.first_message}` : null;
            const telegram = row.telegram_username ? `@${row.telegram_username}` : row.telegram_user_id ? String(row.telegram_user_id) : null;
            const personaText = row.persona_name || row.persona_id || 'Не указана';
            const sender = senderId ? `${senderUsername ? `@${senderUsername} ` : ''}#${senderId}` : 'автоматически';
            const senderLabel = row.preferred_account_id && !row.first_contact_at ? 'Выбран: ' : 'Аккаунт: ';
            const ownerTitle = `Менеджер: ${row.manager_username || 'не назначен'} · Регион: ${row.region_code || 'не задан'}`;
            const statusText = statusLabels[row.status] || row.status;
            const stageText = row.deal_stage ? dealStageLabel(row.deal_stage) : null;
            const stageTitle = stageText ? [stageText, row.deal_note].filter(Boolean).join(' — ') : 'Этап не указан';
            const next = nextStepState(row);
            const nextWhen = nextStepWhen(row);
            const nextTitle = next === 'none' ? 'Следующий шаг не задан' : [row.next_step || 'Шаг без описания', nextWhen].filter(Boolean).join(' · ');
            const by = leadsBy(row);
            const attemptsTitle = [`Попыток: ${row.attempts ?? 0}`, row.next_attempt_at ? `следующая: ${shortDate(row.next_attempt_at)}` : null].filter(Boolean).join(' · ');
            // Значения скрытых колонок не пропадают: они дописываются в подсказку лида.
            const leadTitle = [
              row.first_name || `Лид #${row.id}`,
              about,
              row.site ? `сайт: ${row.site}` : null,
              `лид #${row.id}`,
              telegram ? `Telegram: ${telegram}` : null,
              firstMessage,
              !has('source') && inbound,
              !has('contact') && [row.phone_e164, row.username ? `@${row.username}` : null].filter(Boolean).join(', '),
              !has('persona') && `Личность: ${personaText}`,
              admin && !has('manager') && ownerTitle,
              !has('account') && `${senderLabel}${sender}`,
              !has('status') && `Статус: ${[statusText, row.last_error].filter(Boolean).join(' — ')}`,
              !has('stage') && stageText && `Этап: ${stageTitle}`,
              !has('contacted') && (row.first_contact_at ? `Написали: ${date(row.first_contact_at)}` : 'Ещё не писали'),
              !has('type') && `Тип: ${leadTypeLabel(row)}`,
              !has('next') && next !== 'none' && `Шаг: ${nextTitle}`,
            ].filter(Boolean).join(' · ');
            return (
              <TableRow
                key={row.id}
                data-state={isSelected ? 'selected' : undefined}
                data-lead-id={row.id}
                data-lead-status={row.status}
                className={cn(onOpen && 'cursor-pointer')}
                onClick={(e) => {
                  // Щелчки по ссылкам, кнопкам и селектам — их собственные; из портала (меню) — не наши.
                  if (!onOpen || !e.currentTarget.contains(e.target)) return;
                  if (e.target.closest('a, button, select, input, label, [role="checkbox"], [role="menuitem"]')) return;
                  onOpen(row);
                }}
              >
                <TableCell className={cn(cell, 'pr-0')}>
                  <Checkbox className="block" checked={isSelected} aria-label={`Выбрать лид: ${name}`} onCheckedChange={() => onToggle(row.id)} />
                </TableCell>

                <TableCell className={cell} title={leadTitle}>
                  <div className={line1}>
                    <span className={cn('truncate text-sm', row.first_name ? 'font-medium' : 'text-muted-foreground')}>
                      {row.first_name || `Лид #${row.id}`}
                    </span>
                  </div>
                  <div className={line2}>
                    {about || (row.first_name ? `лид #${row.id}` : 'без имени')}
                    {row.site && !has('site') && ` · ${row.site}`}
                  </div>
                </TableCell>

                {has('type') && (
                  <TableCell className={cell}>
                    <div className={cn(one, 'gap-1')} title={[leadTypeLabel(row), row.reassigned ? 'перезабив' : null].filter(Boolean).join(' · ')}>
                      <Badge variant={row.cold ? 'secondary' : 'default'} className="h-5" data-testid="lead-type">{leadTypeLabel(row)}</Badge>
                      {row.reassigned && <span className="truncate text-xs text-muted-foreground" title="Перезабив">↻</span>}
                    </div>
                  </TableCell>
                )}

                {has('contact') && (
                  <TableCell className={cell}>
                    {row.phone_e164 && (
                      <div className={line1}><span className="truncate font-mono text-xs">{row.phone_e164}</span></div>
                    )}
                    {row.username && (
                      <div className={row.phone_e164 ? line2 : cn(line1, 'text-sm')}>
                        <span className="truncate"><TelegramLink username={row.username} /></span>
                      </div>
                    )}
                    {!row.phone_e164 && !row.username && <Empty />}
                  </TableCell>
                )}

                {has('age') && (
                  <TableCell className={cell}>
                    <div className={cn(one, 'tabular-nums')}>{row.age ? <span className="truncate">{row.age}</span> : <Empty />}</div>
                  </TableCell>
                )}

                {has('city') && (
                  <TableCell className={cell}>
                    <div className={one} title={row.city || undefined}>{row.city ? <span className="truncate">{row.city}</span> : <Empty />}</div>
                  </TableCell>
                )}

                {has('gender') && (
                  <TableCell className={cell}>
                    <div className={one}>{genderLabel(row.gender, true) ? <span className="truncate">{genderLabel(row.gender, true)}</span> : <Empty />}</div>
                  </TableCell>
                )}

                {has('telegram') && (
                  <TableCell className={cell}>
                    <div className={one} title={telegram ? `Профиль, найденный в Telegram: ${telegram}` : 'В Telegram ещё не найден'}>
                      {row.telegram_username ? (
                        <span className="truncate"><TelegramLink username={row.telegram_username} /></span>
                      ) : row.telegram_user_id ? (
                        <span className="truncate font-mono text-xs">{String(row.telegram_user_id)}</span>
                      ) : (
                        <Empty />
                      )}
                    </div>
                  </TableCell>
                )}

                {has('site') && (
                  <TableCell className={cell}>
                    <div className={one}>
                      {row.site ? <span className="truncate" title={row.site}>{row.site}</span> : <Empty />}
                    </div>
                  </TableCell>
                )}

                {has('source') && (
                  <TableCell className={cell}>
                    <div className={cn(line1, 'gap-1')} title={inbound || undefined}>
                      <span className={cn('truncate text-sm', !row.inbound_at && 'text-muted-foreground')}>{row.inbound_at ? row.source_type : 'вручную'}</span>
                      <InboundDetails name={name} row={row} />
                    </div>
                    {tags.length > 0 && <div className={line2}>{tags.join(' · ')}</div>}
                  </TableCell>
                )}

                {has('donor') && (
                  <TableCell className={cell} title={[row.donor, row.external_id ? `ID: ${row.external_id}` : null, row.account_label].filter(Boolean).join(' · ') || undefined}>
                    <div className={line1}>{row.donor ? <span className="truncate text-sm">{row.donor}</span> : <Empty />}</div>
                    {row.external_id && <div className={line2}>{`ID ${row.external_id}`}</div>}
                  </TableCell>
                )}

                {has('region') && (
                  <TableCell className={cell}>
                    <div className={cn(one, 'tabular-nums')}>{row.requested_region ? <span className="truncate">{row.requested_region}</span> : <Empty />}</div>
                  </TableCell>
                )}

                {has('persona') && (
                  <TableCell className={cell}>
                    <div className="flex h-8 min-w-0 items-center">
                      {row.first_contact_at || row.preferred_account_id ? (
                        <span className="truncate text-sm" title={row.preferred_account_id ? `${personaText} — личность выбранного аккаунта` : personaText}>{personaText}</span>
                      ) : (
                        <label className="-ml-2 block min-w-0 flex-1">
                          <span className="sr-only">{`Личность лида: ${name}`}</span>
                          <PersonaSelect personas={personas} variant="ghost" value={pendingPersona[row.id] ?? row.persona_id} className="h-8 text-ellipsis" disabled={busy} onChange={persona => changePersona(row.id, persona)} />
                        </label>
                      )}
                    </div>
                  </TableCell>
                )}

                {has('manager') && (
                  <TableCell className={cell}>
                    <div className={line1} title={ownerTitle} data-testid="manager-attribution">
                      <span className={cn('truncate text-sm', !row.manager_username && 'text-muted-foreground')}>{row.manager_username || 'не назначен'}</span>
                    </div>
                    <div className={line2}>{row.region_code ? `регион ${row.region_code}` : 'регион не задан'}</div>
                  </TableCell>
                )}

                {has('account') && (
                  <TableCell className={cell}>
                    <div className={one} title={`${senderLabel}${sender}`}>
                      {senderId ? (
                        <span className="truncate">
                          {senderUsername ? <TelegramLink username={senderUsername} /> : <span className="font-mono text-xs">{`#${senderId}`}</span>}
                        </span>
                      ) : (
                        <span className="truncate text-muted-foreground">автоматически</span>
                      )}
                    </div>
                  </TableCell>
                )}

                {has('status') && (
                  <TableCell className={cell}>
                    <div className={cn(one, 'gap-1')}>
                      <Badge variant={badge.variant} className={cn('h-5 min-w-0 shrink', badge.className)}>
                        <span className="truncate">{statusText}</span>
                      </Badge>
                      {row.last_error && <ErrorDetails name={name} text={row.last_error} />}
                    </div>
                  </TableCell>
                )}

                {has('stage') && (
                  <TableCell className={cell}>
                    <div className={one} title={stageTitle}>
                      {stageText ? <span className="truncate">{stageText}</span> : <Empty />}
                    </div>
                  </TableCell>
                )}

                {has('next') && (
                  <TableCell className={cell} title={nextTitle}>
                    {next === 'none' ? (
                      <div className={one}><Empty /></div>
                    ) : (
                      <>
                        <div className={line1}>
                          <span className={cn('truncate text-sm', !row.next_step && 'text-muted-foreground')}>{row.next_step || 'шаг без описания'}</span>
                        </div>
                        <div className={cn(line2, NEXT_TONE[next], next === 'overdue' && 'font-medium')} data-testid="next-when" data-state={next}>
                          {nextWhen}
                        </div>
                      </>
                    )}
                  </TableCell>
                )}

                {has('activity') && (
                  <TableCell className={cell}>
                    <div
                      className={cn(one, 'tabular-nums')}
                      title={row.last_message_ts ? `Последнее сообщение: ${shortDate(row.last_message_ts)}${row.last_client_ts ? ` · клиент писал: ${shortDate(row.last_client_ts)}` : ''}` : 'Переписки ещё нет'}
                    >
                      {row.last_message_ts ? <span className="truncate">{shortDate(row.last_message_ts)}</span> : <Empty />}
                      {!has('unread') && row.unread_count > 0 && (
                        <Badge variant="default" className="h-5 px-1.5 tabular-nums">{row.unread_count}</Badge>
                      )}
                    </div>
                  </TableCell>
                )}

                {has('unread') && (
                  <TableCell className={cell}>
                    <div className={one}>
                      {row.unread_count > 0 ? <Badge variant="default" className="h-5 px-1.5 tabular-nums" data-testid="lead-unread">{row.unread_count}</Badge> : <Empty />}
                    </div>
                  </TableCell>
                )}

                {has('leads') && (
                  <TableCell className={cell}>
                    <div className={one}>
                      {by === 'none' ? <Empty /> : <span className="truncate">{by === 'manager' ? 'Менеджер' : 'Бот'}</span>}
                    </div>
                  </TableCell>
                )}

                {has('contacted') && (
                  <TableCell className={cell}>
                    <div className={cn(one, 'tabular-nums')} title={row.first_contact_at ? `Написали: ${date(row.first_contact_at)}` : 'Ещё не писали'}>
                      {row.first_contact_at ? <span className="truncate">{date(row.first_contact_at)}</span> : <Empty />}
                    </div>
                  </TableCell>
                )}

                {has('attempts') && (
                  <TableCell className={cell} title={attemptsTitle}>
                    <div className={cn(line1, 'tabular-nums')}><span className="truncate text-sm">{row.attempts ?? 0}</span></div>
                    {row.next_attempt_at && <div className={cn(line2, 'tabular-nums')}>{`след. ${shortDate(row.next_attempt_at)}`}</div>}
                  </TableCell>
                )}

                {has('error') && (
                  <TableCell className={cell}>
                    <div className={one} title={row.last_error || undefined}>
                      {row.last_error ? <span className="truncate text-destructive">{row.last_error}</span> : <Empty />}
                    </div>
                  </TableCell>
                )}

                {has('added') && (
                  <TableCell className={cell}>
                    <div className={cn(one, 'tabular-nums')} title={`Добавлен: ${date(row.inserted_at)}`}>
                      {row.inserted_at ? <span className="truncate">{shortDate(row.inserted_at)}</span> : <Empty />}
                    </div>
                  </TableCell>
                )}

                {has('notes') && (
                  <TableCell className={cell}>
                    <div className={one} title={row.notes || undefined}>
                      {row.notes ? <span className="truncate">{row.notes}</span> : <Empty />}
                    </div>
                  </TableCell>
                )}

                <TableCell className={cn(cell, 'px-2')}>
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
                          <DropdownMenuItem className="items-start" onSelect={() => onReassign(row)}>
                            <Shuffle className="mt-0.5" aria-hidden="true" />
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span>Написать с другого</span>
                              <span className="text-xs text-muted-foreground">
                                {`Отдать лид другому аккаунту — ${senderUsername ? `@${senderUsername}` : `#${senderId}`} его больше не возьмёт`}
                              </span>
                            </span>
                          </DropdownMenuItem>
                        )}
                        {canReassign && <DropdownMenuSeparator />}
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
