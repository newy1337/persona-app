import { Archive, ArchiveRestore, ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, Bot, Eye, EyeOff, TriangleAlert, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DEAL_STAGES, dealStageLabel } from '../../data/dealStages';
import { ColumnFilter } from '../ColumnFilter/ColumnFilter';
import { ColumnPicker } from '../ColumnPicker/ColumnPicker';
import { IconAction } from '../IconAction/IconAction';
import { useChatWatch } from '../ChatWatch/chatWatch';
import { Peek } from './CellPeek';
import { CELL, HEAD_CELL, LINE_1, LINE_2, WAITS_TEXT, accountLabel, leadTypeLabel, presenceText, useDialogColumns } from './rowLayout';
import { accountContact, channelBadge, clientContact } from '../../utils/channel';

/** Профиль ссылкой: адрес и подпись отдаёт бэк (t.me или vk.com), см. utils/channel. */
function ContactLink({ contact }) {
  return (
    <a
      className="truncate text-primary hover:underline"
      href={contact.url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {contact.display}
    </a>
  );
}

function SortIcon({ sort, col }) {
  if (sort.col !== col) return <ArrowUpDown aria-hidden="true" className="opacity-50" />;
  return sort.dir === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />;
}

const Empty = () => <span className="text-muted-foreground">—</span>;

/** Ячейка в одну линию: текст обрезается, полное значение — в title. */
function Cell({ title, className, children, ...props }) {
  return (
    <TableCell className={cn(CELL, className)} {...props}>
      <Peek className="flex min-w-0 items-center gap-1.5 text-sm" title={title}>
        {children}
      </Peek>
    </TableCell>
  );
}

const MSK = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Время последнего сообщения по Москве: «06.10, 22:15», в подсказке — с годом. */
export function lastSeen(ts) {
  if (!ts) return { text: '—' };
  const p = Object.fromEntries(MSK.formatToParts(new Date(ts * 1000)).map((part) => [part.type, part.value]));
  return {
    text: `${p.day}.${p.month}, ${p.hour}:${p.minute}`,
    full: `${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute}`,
  };
}

/**
 * Таблица диалогов — сетка: каждое значение в своей колонке и в одну линию
 * (у собеседника под именем возраст и город). Вся строка открывает диалог, с
 * клавиатуры — кнопка «Открыть». Колонки выбирает пользователь — «Настроить поля»
 * в заголовке действий; значение скрытой колонки остаётся в подсказке собеседника.
 * Рядом с названием колонки — воронка её фильтра: filters = { defs, state, onChange }.
 */
export function DialogTable({ rows, totalRows, archived, sort, onSort, onOpen, onHide, onDealStage = null, urgent = null, cursorId = null, filters = null, helpers }) {
  const { Avatar, Stage, isNew, unreadLabel, presence, nextAction, accountLost, typingLabels } = helpers;
  const prefs = useDialogColumns();
  const watch = useChatWatch();
  const { columns, has, admin } = prefs;

  return (
    <div data-testid="dialogs-list" className="w-full min-w-0 rounded-lg border bg-card">
      <Table aria-label={archived ? 'Архив диалогов' : 'Мои диалоги'} className="table-fixed" style={{ minWidth: prefs.minWidth }}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((col, index) => {
              const def = filters?.defs[col.key];
              return (
                <TableHead
                  key={col.key}
                  scope="col"
                  style={{ width: col.width }}
                  {...(col.sort
                    ? { 'aria-sort': sort.col === col.sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' }
                    : {})}
                  className={HEAD_CELL}
                >
                  {col.key === 'actions' ? (
                    <div className="flex items-center justify-end">
                      <span className="sr-only">{col.label}</span>
                      <ColumnPicker prefs={prefs} />
                    </div>
                  ) : (
                    // Название сжимается первым: воронка не выезжает за колонку.
                    <div className="flex min-w-0 items-center gap-1">
                      {col.sort ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="-ml-2 min-w-0 shrink font-medium text-muted-foreground hover:text-foreground"
                          onClick={() => onSort(col.sort)}
                        >
                          <span className="truncate">{col.label}</span>
                          <SortIcon sort={sort} col={col.sort} />
                        </Button>
                      ) : (
                        <span className="truncate">{col.label}</span>
                      )}
                      {def && (
                        <span className="-mr-1.5 flex shrink-0">
                          <ColumnFilter
                            label={col.label}
                            def={def}
                            value={filters.state[col.key]}
                            onChange={(value) => filters.onChange(col.key, value)}
                            align={index * 2 > columns.length ? 'end' : 'start'}
                          />
                        </span>
                      )}
                    </div>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => {
            const fresh = isNew(row);
            const online = presence(row.client_presence, undefined, { short: true });
            const next = nextAction(row.next_bot_action, undefined, { short: true });
            const nextFull = nextAction(row.next_bot_action)?.text;
            // Как в рабочей панели: точный ЧС, почищенный диалог и вероятный ЧС подписаны по-разному.
            const warning = row.blocked_by_client_at
              ? 'ЧС: заблокировал(а) нас'
              : row.cleared_by_client_at
                ? 'Почистил(а) диалог'
                : row.likely_blocked_at
                  ? 'Вероятно, ЧС'
                  : null;
            const warningTitle = row.likely_blocked_at && !row.blocked_by_client_at && !row.cleared_by_client_at
              ? 'Статус собеседника вдруг скрылся — так бывает, когда кидают в ЧС (или скрыли статус приватностью)'
              : undefined;
            const who = row.name || `Чат ${row.chat_id}`;
            // Красный — срочно нужен менеджер (очередь «Ждут менеджера»), жёлтый —
            // не указан этап (те же диалоги, что в напоминании над таблицей).
            const urgentReason = urgent?.get(String(row.chat_id)) ?? null;
            const noStage = !urgentReason && !archived && !row.hidden && !row.deal_stage;
            const age = row.age ? `${row.age} лет` : null;
            const idLabel = `ID ${row.chat_id}`;
            const about = [age, row.city].filter(Boolean).join(' · ');
            const client = clientContact(row);
            const accountLink = row.account_username ? accountContact(row) : null;
            const channel = channelBadge(row.channel);
            const contactTitle = [client?.display, row.phone, idLabel, channel.other ? channel.title : null]
              .filter(Boolean)
              .join(' · ');
            const LeadIcon = row.is_paused ? User : Bot;
            const lost = row.account_lost ? accountLost(row.account_lost, { short: true }) : null;
            const account = accountLabel(row);
            const accountTitle = [account, row.account_lost ? accountLost(row.account_lost) : null].filter(Boolean).join(' · ');
            const ownerTitle = `Менеджер: ${row.manager_username || 'не назначен'} · Регион: ${row.region_code || 'не задан'}`;
            const last = lastSeen(row.last_message_ts);
            // Значения скрытых колонок не пропадают: они дописываются в подсказку собеседника.
            const whoTitle = [
              who,
              urgentReason && `Ждёт менеджера: ${urgentReason}`,
              warning,
              about,
              online?.text,
              !has('contact') && contactTitle,
              !has('channel') && channel.other && `Соцсеть: ${channel.title}`,
              !has('type') && row.lead_type && `Тип: ${leadTypeLabel(row.lead_type)}`,
              !has('persona') && row.persona_name && `Личность: ${row.persona_name}`,
              !has('stage') && row.stage?.title && `Стадия: ${row.stage.title}`,
              !has('deal') && row.deal_stage && `Этап: ${dealStageLabel(row.deal_stage)}`,
              !has('lead') && `Ведёт: ${row.is_paused ? 'менеджер' : 'бот'}`,
              !has('next') && (fresh ? WAITS_TEXT : nextFull),
              // «Менеджер» и «Регион» — только админу: остальным их нет и в подсказке.
              admin && !has('manager') && ownerTitle,
              !has('account') && `Аккаунт: ${accountTitle}`,
              !has('last') && last.full && `Последнее: ${last.full}`,
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <TableRow
                key={row.chat_id}
                data-chat-id={row.chat_id}
                onClick={() => onOpen(row.chat_id)}
                data-urgent={urgentReason ? 'true' : undefined}
                data-cursor={cursorId === row.chat_id ? 'true' : undefined}
                data-no-stage={noStage || undefined}
                className={cn(
                  'cursor-pointer focus-within:bg-muted/50',
                  // Строка под курсором горячих клавиш (J/K) — рамка поверх любой заливки.
                  cursorId === row.chat_id && 'outline-2 -outline-offset-2 outline-primary',
                  // Срочное заметно сразу: заливка плюс красная полоска у края строки.
                  urgentReason &&
                    'bg-destructive/15 hover:bg-destructive/20 focus-within:bg-destructive/20 [&>td:first-child]:shadow-[inset_3px_0_0_var(--destructive)]',
                  noStage && 'bg-warning hover:bg-warning focus-within:bg-warning',
                )}
              >
                <TableCell className={CELL}>
                  <Peek className="flex min-w-0 items-center gap-2.5" title={whoTitle}>
                    <span className="relative shrink-0">
                      <Avatar
                        className="size-8 rounded-full bg-muted text-xs font-medium text-muted-foreground"
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
                        <span className="truncate font-medium">{who}</span>
                        {fresh && (
                          <Badge
                            variant="default"
                            data-testid="new-badge"
                            title="Клиент написал — ждёт ответа менеджера"
                            className="h-[18px] px-1.5 tabular-nums"
                          >
                            {unreadLabel(row.unread_count)}
                          </Badge>
                        )}
                      </div>
                      <div className={LINE_2}>
                        <span
                          className={cn('truncate', warning && !row.typing && 'text-destructive')}
                          data-testid={warning && !row.typing ? 'blocked-mark' : undefined}
                          title={row.typing ? undefined : warningTitle}
                        >
                          {row.typing ? `${typingLabels[row.typing] || 'печатает'}…` : warning || about || '—'}
                        </span>
                      </div>
                    </div>
                  </Peek>
                </TableCell>

                {has('contact') && (
                  <Cell title={contactTitle}>
                    {/* Отдельная колонка «Соцсеть» скрыта — метка канала остаётся у контакта. */}
                    {channel.other && !has('channel') && (
                      <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px] font-normal" data-channel={channel.key} data-testid="channel-badge" title={channel.title}>
                        {channel.label}
                      </Badge>
                    )}
                    {client ? (
                      <ContactLink contact={client} />
                    ) : (
                      <span className="truncate font-mono text-xs tabular-nums">{row.phone || idLabel}</span>
                    )}
                  </Cell>
                )}

                {has('channel') && (
                  <Cell title={channel.title}>
                    <Badge
                      variant={channel.other ? 'secondary' : 'outline'}
                      className="h-5 shrink-0 px-1.5 text-[11px] font-medium"
                      data-channel={channel.key}
                      data-testid="channel-cell"
                    >
                      {channel.label}
                    </Badge>
                  </Cell>
                )}

                {has('type') && (
                  <Cell>
                    {row.lead_type ? (
                      <Badge
                        variant={row.lead_type === 'cold' ? 'secondary' : row.lead_type === 'hot' ? 'default' : 'outline'}
                        className="h-5 shrink-0 px-1.5 text-[11px] font-medium"
                        data-type={row.lead_type}
                        data-testid="lead-type"
                      >
                        {leadTypeLabel(row.lead_type)}
                      </Badge>
                    ) : (
                      <Empty />
                    )}
                  </Cell>
                )}

                {has('stage') && (
                  <Cell>
                    <Stage stage={row.stage} />
                  </Cell>
                )}

                {has('deal') && (
                  <Cell>
                    {onDealStage ? (
                      <div
                        data-testid="deal-stage"
                        className="min-w-0 flex-1"
                        title={row.deal_note || undefined}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <NativeSelect
                          aria-label={`Этап сделки: ${row.name || row.chat_id}`}
                          variant="ghost"
                          className={cn('-ml-2 h-7 text-ellipsis', !row.deal_stage && 'text-muted-foreground')}
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
                    ) : row.deal_stage ? (
                      <span
                        data-testid="deal-stage"
                        className="min-w-0 truncate"
                        title={[dealStageLabel(row.deal_stage), row.deal_note].filter(Boolean).join(' · ')}
                      >
                        <span className="sr-only">Этап: </span>
                        {dealStageLabel(row.deal_stage)}
                        {row.deal_note ? <span className="text-muted-foreground">{` · ${row.deal_note}`}</span> : null}
                      </span>
                    ) : (
                      <Empty />
                    )}
                  </Cell>
                )}

                {has('lead') && (
                  <Cell>
                    <LeadIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{row.is_paused ? 'Менеджер' : 'Бот'}</span>
                  </Cell>
                )}

                {has('next') && (
                  <Cell
                    title={
                      urgentReason
                        ? `Ждёт менеджера: ${urgentReason}`
                        : fresh
                          ? 'Клиент написал — ждёт ответа менеджера'
                          : nextFull
                    }
                  >
                    {/* Почему строка красная: причина из очереди «Ждут менеджера». */}
                    {urgentReason ? (
                      <span className="flex min-w-0 items-center gap-1.5 font-medium text-destructive" data-testid="urgent-reason">
                        <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                        <span className="truncate">{urgentReason}</span>
                      </span>
                    ) : fresh ? (
                      <>
                        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning-foreground" />
                        <span className="truncate">{WAITS_TEXT}</span>
                      </>
                    ) : next?.text ? (
                      <span className="truncate text-muted-foreground">{next.text}</span>
                    ) : (
                      <Empty />
                    )}
                  </Cell>
                )}

                {has('unread') && (
                  <Cell>
                    {(row.unread_count ?? 0) > 0 ? (
                      <Badge variant="default" className="h-5 px-1.5 tabular-nums" data-testid="unread-cell">
                        {row.unread_count}
                      </Badge>
                    ) : (
                      <Empty />
                    )}
                  </Cell>
                )}

                {has('online') && (
                  <Cell title={presenceText(row) || undefined}>
                    {presenceText(row) ? (
                      <span className={cn('truncate', row.client_presence?.kind === 'online' ? 'text-success-foreground' : 'text-muted-foreground')}>
                        {presenceText(row)}
                      </span>
                    ) : (
                      <Empty />
                    )}
                  </Cell>
                )}

                {has('age') && (
                  <Cell>{row.age ? <span className="tabular-nums">{row.age}</span> : <Empty />}</Cell>
                )}

                {has('city') && (
                  <Cell title={row.city || undefined}>{row.city ? <span className="truncate">{row.city}</span> : <Empty />}</Cell>
                )}

                {has('persona') && (
                  <Cell>{row.persona_name ? <span className="truncate">{row.persona_name}</span> : <Empty />}</Cell>
                )}

                {has('manager') && (
                  <Cell title={ownerTitle}>
                    <span className={cn('truncate', !row.manager_username && 'text-muted-foreground')}>
                      {row.manager_username || 'не назначен'}
                    </span>
                  </Cell>
                )}

                {has('region') && (
                  <Cell>
                    {row.region_code ? <span className="truncate tabular-nums">{row.region_code}</span> : <Empty />}
                  </Cell>
                )}

                {has('account') && (
                  <Cell title={accountTitle}>
                    {lost ? (
                      <span className="truncate text-destructive">{lost}</span>
                    ) : accountLink ? (
                      <ContactLink contact={accountLink} />
                    ) : (
                      <span className="truncate text-muted-foreground">{account}</span>
                    )}
                  </Cell>
                )}

                {has('last') && (
                  <Cell title={last.full}>
                    <span className="truncate tabular-nums">{last.text}</span>
                  </Cell>
                )}

                <TableCell className={CELL} onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end">
                    {watch &&
                      (watch.isOpen(row.chat_id) ? (
                        <IconAction
                          icon={EyeOff}
                          label="Не следить"
                          hint="Закрыть окно наблюдения"
                          className="text-foreground"
                          onClick={() => watch.close(row.chat_id)}
                        />
                      ) : (
                        <IconAction
                          icon={Eye}
                          label="Следить"
                          hint="Открыть диалог в окне поверх панели: можно держать несколько, двигать и сворачивать"
                          onClick={() =>
                            watch.open({ chatId: row.chat_id, name: who, avatar: row.avatar_url || null, account: accountLink?.display || account })
                          }
                        />
                      ))}
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
              <TableCell colSpan={columns.length} className="h-24 p-4 text-center text-sm whitespace-normal text-muted-foreground">
                {totalRows === 0 ? (archived ? 'В архиве пусто' : 'Диалогов нет') : 'Ничего не найдено — сбросьте фильтры'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
