import { Children } from 'react';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, Bot, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DEAL_STAGES, dealStageLabel } from '../../data/dealStages';
import { Attribution } from '../Attribution/Attribution';
import { IconAction } from '../IconAction/IconAction';
import { CELL, COLUMNS, HEAD_CELL, LINE_1, LINE_2, TABLE_MIN_WIDTH } from './rowLayout';

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
  if (sort.col !== col) return <ArrowUpDown aria-hidden="true" className="opacity-50" />;
  return sort.dir === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />;
}

/** Дети через « · »: пустые пропускаются, узлы остаются узлами. */
function Dotted({ children }) {
  return Children.toArray(children)
    .filter((part) => part !== '')
    .map((part, i) => (
      <span key={part.key ?? i} className="contents">
        {i > 0 && ' · '}
        {part}
      </span>
    ));
}

/**
 * Таблица диалогов: строка в две линии (главное сверху, второстепенное снизу
 * приглушённо), вся строка открывает диалог, с клавиатуры — кнопка «Открыть».
 * Всё, что не поместилось в две линии, лежит в title соответствующей ячейки.
 */
export function DialogTable({ rows, totalRows, archived, sort, onSort, onOpen, onHide, onDealStage = null, helpers }) {
  const { Avatar, Stage, isNew, unreadLabel, presence, nextAction, time, date, accountLost, typingLabels } = helpers;

  return (
    <div data-testid="dialogs-list" className="w-full min-w-0 rounded-lg border bg-card">
      <Table aria-label={archived ? 'Архив диалогов' : 'Мои диалоги'} className={cn('table-fixed', TABLE_MIN_WIDTH)}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((col) => (
              <TableHead
                key={col.label}
                scope="col"
                style={{ width: col.width }}
                {...(col.sort
                  ? { 'aria-sort': sort.col === col.sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' }
                  : {})}
                className={HEAD_CELL}
              >
                {col.sort ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="-ml-2 font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => onSort(col.sort)}
                  >
                    {col.label}
                    <SortIcon sort={sort} col={col.sort} />
                  </Button>
                ) : (
                  <span className={cn(col.quiet && 'sr-only')}>{col.label}</span>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => {
            const fresh = isNew(row);
            const online = presence(row.client_presence, undefined, { short: true });
            const next = nextAction(row.next_bot_action, undefined, { short: true });
            const nextFull = nextAction(row.next_bot_action)?.text;
            const warning = row.blocked_by_client_at
              ? 'Заблокировал(а) нас'
              : row.cleared_by_client_at
                ? 'Почистил(а) диалог'
                : null;
            const who = row.name || `Чат ${row.chat_id}`;
            const age = row.age ? `${row.age} лет` : null;
            const idLabel = `ID ${row.chat_id}`;
            const whoTitle = [
              warning,
              age,
              row.city,
              row.phone,
              row.client_username ? `@${row.client_username}` : null,
              idLabel,
              online?.text,
            ]
              .filter(Boolean)
              .join(' · ');
            const lead = row.is_paused ? (fresh ? 'Менеджер · ждёт ответа' : 'Менеджер') : 'Бот';
            const LeadIcon = row.is_paused ? User : Bot;
            const leadText = [lead, next?.text].filter(Boolean).join(' · ');
            const lost = row.account_lost ? accountLost(row.account_lost, { short: true }) : null;
            const manager = `Менеджер: ${row.manager_username || 'не назначен'} · Регион: ${row.region_code || 'не задан'}`;

            return (
              <TableRow
                key={row.chat_id}
                data-chat-id={row.chat_id}
                onClick={() => onOpen(row.chat_id)}
                className="cursor-pointer focus-within:bg-muted/50"
              >
                <TableCell className={CELL}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="relative shrink-0" title={online?.text}>
                      <Avatar
                        className="size-9 rounded-full bg-muted font-medium text-muted-foreground"
                        style={{ '--av-bg': 'var(--muted)' }}
                        src={row.avatar_url}
                        name={row.name || '—'}
                      />
                      {online?.tone === 'online' && (
                        <span
                          aria-hidden="true"
                          className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-success-foreground"
                        />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={LINE_1}>
                        <span className="truncate font-medium" title={who}>{who}</span>
                        {fresh && (
                          <Badge
                            variant="default"
                            data-testid="new-badge"
                            title="Клиент написал — ждёт ответа менеджера"
                            className="h-5 px-1.5 tabular-nums"
                          >
                            {unreadLabel(row.unread_count)}
                          </Badge>
                        )}
                      </div>
                      <div className={LINE_2} title={whoTitle}>
                        <span className="truncate">
                          {row.typing ? (
                            `${typingLabels[row.typing] || 'печатает'}…`
                          ) : (
                            <Dotted>
                              {warning && <span className="text-destructive">{warning}</span>}
                              {age}
                              {row.city}
                              {row.client_username ? (
                                <TgLink username={row.client_username} />
                              ) : (
                                <span className="font-mono tabular-nums">{row.phone || idLabel}</span>
                              )}
                            </Dotted>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </TableCell>

                <TableCell className={CELL}>
                  <div className={LINE_1}>
                    <Stage stage={row.stage} />
                    {onDealStage ? (
                      <div
                        data-testid="deal-stage"
                        className="min-w-0 shrink-0"
                        title={row.deal_note || undefined}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <NativeSelect
                          aria-label={`Этап сделки: ${row.name || row.chat_id}`}
                          className={cn('h-7 w-auto max-w-36 px-1.5 text-xs', !row.deal_stage && 'text-muted-foreground')}
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
                      </div>
                    ) : (
                      row.deal_stage && (
                        <span
                          data-testid="deal-stage"
                          className="min-w-0 truncate text-xs"
                          title={row.deal_note || undefined}
                        >
                          <span className="text-muted-foreground">Этап: </span>
                          {dealStageLabel(row.deal_stage)}
                          {row.deal_note ? ` · ${row.deal_note}` : ''}
                        </span>
                      )
                    )}
                  </div>
                  <div className={LINE_2} title={[lead, nextFull].filter(Boolean).join(' · ')}>
                    <LeadIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">{leadText}</span>
                  </div>
                </TableCell>

                <TableCell className={CELL}>
                  <div className={LINE_1} title={manager}>
                    <Attribution value={row} compact className="flex-row gap-2 [&>span]:truncate" />
                  </div>
                  <div className={LINE_2}>
                    <span className="truncate">
                      <Dotted>
                        {row.account_username ? (
                          <TgLink username={row.account_username} />
                        ) : row.account_id ? (
                          `Аккаунт #${row.account_id}`
                        ) : (
                          'Аккаунт удалён'
                        )}
                        {lost && <span className="text-destructive">{lost}</span>}
                      </Dotted>
                    </span>
                  </div>
                </TableCell>

                <TableCell className={CELL}>
                  <div className={cn(LINE_1, 'tabular-nums')}>{time(row.last_message_ts)}</div>
                  <div className={cn(LINE_2, 'tabular-nums')}>{date(row.last_message_ts)}</div>
                </TableCell>

                <TableCell className={cn(CELL, 'px-2')} onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end">
                    {onHide && (
                      <IconAction
                        icon={row.hidden ? ArchiveRestore : Archive}
                        label={row.hidden ? 'Вернуть из архива' : 'В архив'}
                        hint={
                          row.hidden
                            ? 'Вернуть диалог из архива'
                            : 'Убрать диалог с дашборда. Бот перестанет писать до нового сообщения клиента.'
                        }
                        onClick={() => onHide(row.chat_id, !row.hidden)}
                      />
                    )}
                    <IconAction icon={ArrowUpRight} label="Открыть" hint={`Открыть диалог: ${who}`} onClick={() => onOpen(row.chat_id)} />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={COLUMNS.length} className="h-24 p-4 text-center text-sm whitespace-normal text-muted-foreground">
                {totalRows === 0 ? (archived ? 'В архиве пусто' : 'Диалогов нет') : 'Ничего не найдено — сбросьте поиск и фильтры'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
