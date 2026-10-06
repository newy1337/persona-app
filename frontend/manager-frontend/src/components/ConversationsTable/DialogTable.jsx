import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DEAL_STAGES, dealStageLabel } from '../../data/dealStages';
import { Attribution } from '../Attribution/Attribution';

const SORT_OPTIONS = [
  ['', 'По умолчанию'],
  ['name:asc', 'Имя: А → Я'],
  ['name:desc', 'Имя: Я → А'],
  ['status:asc', 'Стадия: с начала'],
  ['status:desc', 'Стадия: с конца'],
  ['time:desc', 'Сначала новые'],
  ['time:asc', 'Сначала старые'],
];

const COLUMNS = [
  ['Собеседник', 'name', '27%'],
  ['Менеджер / регион', null, '22%'],
  ['Стадия и режим', 'status', '22%'],
  ['Последнее', 'time', '15%'],
  ['Действия', null, '14%'],
];

// До 1000px таблица раскладывается карточками: thead прячется, строка —
// сетка 2×3, подписи колонок рисуются через data-label.
const cell = cn(
  'p-3 align-top text-xs leading-normal whitespace-normal [overflow-wrap:anywhere]',
  `max-[1000px]:block max-[1000px]:p-0`,
);
const captioned = `max-[1000px]:before:mb-1.5 max-[1000px]:before:block max-[1000px]:before:text-[11px] max-[1000px]:before:text-muted-foreground max-[1000px]:before:content-[attr(data-label)]`;
const muted = 'text-[11px] text-muted-foreground';

function TgLink({ username, label }) {
  return (
    <a
      className="text-primary hover:underline"
      href={`https://t.me/${username}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {label || `@${username}`}
    </a>
  );
}

function SortIcon({ sort, col }) {
  if (sort.col !== col) return <ArrowUpDown className="opacity-60" />;
  return sort.dir === 'asc' ? <ArrowUp /> : <ArrowDown />;
}

export function DialogTable({ rows, totalRows, archived, sort, onSort, setSort, onOpen, onHide, onDealStage = null, helpers }) {
  const { Avatar, Stage, isNew, unreadLabel, presence, nextAction, time, date, accountLost, typingLabels } = helpers;

  return (
    <div data-testid="dialogs-list" className="w-full min-w-0">
      <Label className={`hidden max-[1000px]:flex mb-3 items-center justify-between gap-3 text-xs font-normal text-muted-foreground`}>
        Сортировка
        <NativeSelect
          aria-label="Сортировка диалогов"
          className="h-8 w-auto max-w-[70%]"
          value={sort.col ? `${sort.col}:${sort.dir}` : ''}
          onChange={(e) => {
            const [col, dir] = e.target.value.split(':');
            setSort({ col: col || null, dir: dir || 'asc' });
          }}
        >
          {SORT_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </NativeSelect>
      </Label>

      <div className={`rounded-lg border bg-card max-[1000px]:border-0 max-[1000px]:bg-transparent`}>
        <Table
          aria-label={archived ? 'Архив диалогов' : 'Мои диалоги'}
          className={`table-fixed text-xs max-[1000px]:block`}
        >
          <TableHeader className={`max-[1000px]:hidden`}>
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map(([label, col, width]) => (
                <TableHead
                  key={label}
                  scope="col"
                  style={{ width }}
                  {...(col
                    ? { 'aria-sort': sort.col === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' }
                    : {})}
                  className="h-10 px-3 text-xs font-medium whitespace-normal text-muted-foreground"
                >
                  {col ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="-ml-2 font-medium text-muted-foreground hover:text-foreground"
                      onClick={() => onSort(col)}
                    >
                      {label}
                      <SortIcon sort={sort} col={col} />
                    </Button>
                  ) : (
                    label
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody className={`max-[1000px]:block`}>
            {rows.map((row) => {
              const fresh = isNew(row);
              const online = presence(row.client_presence, undefined, { short: true });
              const next = nextAction(row.next_bot_action, undefined, { short: true });
              const warning = row.blocked_by_client_at
                ? 'Заблокировал(а) нас'
                : row.cleared_by_client_at
                  ? 'Почистил(а) диалог'
                  : null;
              return (
                <TableRow
                  key={row.chat_id}
                  data-chat-id={row.chat_id}
                  onClick={() => onOpen(row.chat_id)}
                  className={cn(
                    'cursor-pointer focus-within:bg-muted/50',
                    fresh && 'bg-primary/5 hover:bg-primary/10',
                    `max-[1000px]:mb-3 max-[1000px]:grid max-[1000px]:grid-cols-2 max-[1000px]:gap-4 max-[1000px]:rounded-lg max-[1000px]:border max-[1000px]:bg-card max-[1000px]:p-4`,
                    fresh && `max-[1000px]:border-primary/40`,
                  )}
                >
                  <TableCell className={cn(cell, `max-[1000px]:col-span-2`)}>
                    <div className="flex min-w-0 items-start gap-2.5">
                      <Avatar
                        className="size-9 shrink-0 rounded-lg"
                        style={{ '--av-bg': 'var(--primary)' }}
                        src={row.avatar_url}
                        name={row.name || '—'}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <button
                            type="button"
                            className="truncate text-left text-[13px] font-semibold text-foreground hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpen(row.chat_id);
                            }}
                          >
                            {row.name || `Чат ${row.chat_id}`}
                          </button>
                          {fresh && (
                            <Badge
                              variant="default"
                              data-testid="new-badge"
                              title="Клиент написал — ждёт ответа менеджера"
                              className="h-5 px-1.5 text-[10px] tabular-nums"
                            >
                              {unreadLabel(row.unread_count)}
                            </Badge>
                          )}
                        </div>
                        <div className={cn(muted, 'truncate')}>
                          {row.typing
                            ? `${typingLabels[row.typing] || 'печатает'}…`
                            : [row.age ? `${row.age} лет` : null, row.city].filter(Boolean).join(' · ') || 'Возраст и город не указаны'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
                      {row.phone || null}
                      {row.client_username && <TgLink username={row.client_username} />}
                      {!row.phone && !row.client_username && <span className={muted}>Контакт не указан</span>}
                    </div>
                    <div className={cn(muted, 'mt-0.5 font-mono tabular-nums')}>{`ID ${row.chat_id}`}</div>
                    <div className={cn('mt-1 min-h-4', warning ? 'text-[11px] text-destructive' : cn(muted, online?.tone === 'online' && 'text-success-foreground'))}>
                      {warning ?? online?.text}
                    </div>
                  </TableCell>

                  <TableCell className={cn(cell, `max-[1000px]:col-start-1 max-[1000px]:row-start-2`)}>
                    <Attribution value={row} />
                    <div className="mt-2 text-[11px]">
                      <span className="text-muted-foreground">Аккаунт: </span>
                      {row.account_username ? <TgLink username={row.account_username} /> : row.account_id ? `#${row.account_id}` : 'удалён'}
                    </div>
                    {row.account_lost && (
                      <div className="mt-1 text-[11px] text-destructive">{accountLost(row.account_lost, { short: true })}</div>
                    )}
                  </TableCell>

                  <TableCell
                    data-label="Стадия и режим"
                    className={cn(cell, captioned, `max-[1000px]:col-start-2 max-[1000px]:row-start-2`)}
                  >
                    <Stage stage={row.stage} />
                    {onDealStage ? (
                      <div
                        data-testid="deal-stage"
                        className="mt-1.5 max-w-full"
                        title={row.deal_note || undefined}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <NativeSelect
                          aria-label={`Этап сделки: ${row.name || row.chat_id}`}
                          className={cn(
                            'h-8 w-auto max-w-full text-xs',
                            !row.deal_stage && 'border-warning-foreground/40 bg-warning/40 text-warning-foreground dark:bg-warning/40',
                          )}
                          value={row.deal_stage || ''}
                          onChange={(e) => {
                            const stage = e.target.value;
                            if (stage) onDealStage(row.chat_id, stage, row);
                          }}
                        >
                          <option value="">{row.deal_stage ? '— не задан' : 'Нужно указать этап'}</option>
                          {DEAL_STAGES.map((st) => (
                            <option key={st.id} value={st.id}>{st.label}</option>
                          ))}
                        </NativeSelect>
                        {row.deal_stage === 'archive' && row.deal_note ? (
                          <span className={cn(muted, 'mt-0.5 block')}>{row.deal_note}</span>
                        ) : null}
                      </div>
                    ) : (
                      row.deal_stage && (
                        <div data-testid="deal-stage" className="mt-1.5 truncate text-[11px]" title={row.deal_note || undefined}>
                          <span className="text-muted-foreground">Этап: </span>
                          {dealStageLabel(row.deal_stage)}
                          {row.deal_note ? ` · ${row.deal_note}` : ''}
                        </div>
                      )
                    )}
                    <div className={cn('mt-2 mb-0.5 text-[11px]', row.is_paused ? 'text-primary' : 'text-success-foreground')}>
                      {row.is_paused ? (fresh ? 'Менеджер · ждёт ответа' : 'Ведёт менеджер') : 'Ведёт бот'}
                    </div>
                    <div className={cn(muted, 'min-h-4')} title={nextAction(row.next_bot_action)?.text}>
                      {next?.text}
                    </div>
                  </TableCell>

                  <TableCell
                    data-label="Последнее сообщение"
                    className={cn(cell, captioned, `max-[1000px]:col-start-1 max-[1000px]:row-start-3 max-[1000px]:self-center`)}
                  >
                    <span className="block font-mono text-[13px] font-semibold tabular-nums">{time(row.last_message_ts)}</span>
                    <span className={cn(muted, 'block')}>{date(row.last_message_ts)}</span>
                  </TableCell>

                  <TableCell
                    className={cn(cell, `max-[1000px]:col-start-2 max-[1000px]:row-start-3 max-[1000px]:self-end`)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className={`flex flex-col items-end gap-1.5 max-[1000px]:flex-row max-[1000px]:justify-end`}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOpen(row.chat_id)}
                        aria-label={`Открыть диалог: ${row.name || row.chat_id}`}
                      >
                        Открыть
                        <ChevronRight />
                      </Button>
                      {onHide && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          title={row.hidden ? 'Вернуть диалог из архива' : 'Убрать диалог с дашборда. Бот перестанет писать до нового сообщения клиента.'}
                          onClick={() => onHide(row.chat_id, !row.hidden)}
                        >
                          {row.hidden ? 'Из архива' : 'В архив'}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow className={`hover:bg-transparent max-[1000px]:block max-[1000px]:rounded-lg max-[1000px]:border max-[1000px]:bg-card`}>
                <TableCell colSpan={5} className={`h-24 p-4 text-center text-sm whitespace-normal text-muted-foreground max-[1000px]:block`}>
                  {totalRows === 0 ? (archived ? 'В архиве пусто' : 'Диалогов нет') : 'Ничего не найдено — сбросьте поиск и фильтры'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
