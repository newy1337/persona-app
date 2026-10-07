import { useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, RotateCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { IconAction } from '@/components/IconAction/IconAction';
import { Attribution } from '../../components/Attribution/Attribution';
import ChatNote from './ChatNote';
import { AVATAR_BG } from '../../utils/avatar';
import ClientAvatar from '../../components/ClientAvatar/ClientAvatar';
import { presenceLabel, whenLabel } from '../../utils/telegramStatus';
import EditableValue from '../../components/EditableValue/EditableValue';
import {
  groupByDay,
  familyLabel,
  deliveredBy,
  beatComment,
  isMediaEvidence,
  findMessageIndex,
  phoneLabel,
  shortTitle,
} from '../../utils/scenario';
import { mediaUrl } from '../../utils/chat';
import { setChatNote, pinFact, setDealStage, setSlot } from '../../api/conversations';
import { DEAL_STAGES } from '../../data/dealStages';

/* Колонка — одна поверхность: сверху строка «К дашборду» (44px, вровень со
   строкой действий чата; только на широком экране), под ней прокручиваемое
   тело. Секции идут подряд и разделены линиями (divide-y у тела), своих рамок
   и фонов у них нет. Эти же классы собирают скелетон первой загрузки. */
export const SIDEBAR =
  'min-h-0 w-[clamp(300px,24vw,380px)] shrink-0 flex-col border-x bg-background';
export const SIDEBAR_TOP = 'hidden h-11 shrink-0 items-center border-b px-1.5 lg:flex';
export const SIDEBAR_BODY =
  'sidebarBody flex min-h-0 flex-1 flex-col divide-y overflow-y-auto [scrollbar-gutter:stable]';
export const SECTION = 'flex shrink-0 flex-col gap-2.5 p-3';
const section = cn('summarySection', SECTION);
const sectionHeader = 'flex min-h-5 items-center justify-between gap-2';
const sectionTitle = 'min-w-0 truncate text-sm font-medium';
const sectionCount = 'min-w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums';

/* Сценарий свёрнут, пока человек сам его не раскрыл; выбор помнит браузер. */
const SCENARIO_OPEN_KEY = 'panel_chat_scenario_open';

function readScenarioOpen() {
  try {
    return window.localStorage.getItem(SCENARIO_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function useScenarioOpen() {
  const [open, setOpen] = useState(readScenarioOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(SCENARIO_OPEN_KEY, next ? '1' : '0');
    } catch {
      // хранилище недоступно — выбор живёт до перезагрузки страницы
    }
  };
  return [open, toggle];
}

/** Шапка «Сценарий» — кнопка-переключатель: стрелка, название, счётчик справа. */
function ScenarioToggle({ open, onToggle, children }) {
  return (
    <h3 className="m-0 flex">
      <button
        type="button"
        className="scenarioToggle -mx-1.5 flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <span className={cn(sectionTitle, 'flex-1')}>Сценарий</span>
        {children}
      </button>
    </h3>
  );
}

/* Строка «подпись — значение»: высота 28px и для текста, и для поля правки.
   Править можно только то, что отмечено карандашом и пунктиром (EditableValue)
   или стоит видимым полем («Этап»); остальные строки — обычный текст. */
export const META_ROW = 'grid min-h-7 grid-cols-[68px_minmax(0,1fr)] items-center gap-2 text-sm';
const metaRow = META_ROW;
const metaLabel = 'text-xs text-muted-foreground';
const metaValue = 'min-w-0';
const metaText = 'block truncate';
const metaLink = 'rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50';

const caption = 'text-xs leading-4 text-muted-foreground';
const dot = 'size-1.5 shrink-0 rounded-full';

/* Состояние показывает только точка / значок; текст остаётся нейтральным. */
const NOW_DOT = {
  ask: 'bg-warning-foreground',
  ok: 'bg-success-foreground',
  skip: 'bg-muted-foreground/50',
  fail: 'bg-destructive',
};

const CHECK_MARK = {
  ok: 'text-success-foreground',
  ask: 'text-warning-foreground',
  fail: 'text-destructive',
  skip: 'text-muted-foreground',
};

const SIGNAL_VARIANT = { warn: 'warning' };

/* Заглушка первой загрузки сценария: те же строки и отступы, что у готового
   списка (шапка дня h-4 + строки по 24px), чтобы высоты совпадали. */
const SKELETON_BEATS = ['w-2/3', 'w-1/2', 'w-3/5', 'w-2/5'];

function ScenarioSkeleton({ open, onToggle }) {
  return (
    <section className={section} aria-busy="true">
      <ScenarioToggle open={open} onToggle={onToggle}>
        <Skeleton className="h-3 w-10" />
      </ScenarioToggle>
      {open && (
        <div className="flex flex-col gap-1">
          <div className="flex h-4 items-center gap-2">
            <Skeleton className="h-2.5 w-11" />
            <Skeleton className="h-1 flex-1 rounded-full" />
            <Skeleton className="h-2.5 w-[34px]" />
          </div>
          <div className="-mx-1.5 flex flex-col">
            {SKELETON_BEATS.map((w) => (
              <div key={w} className="flex h-6 items-center gap-2 px-1.5">
                <Skeleton className="h-2.5 w-2.5" />
                <Skeleton className="h-2.5 w-6" />
                <Skeleton className={cn('h-3', w)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

const Spinning = (props) => <RotateCw {...props} className="animate-spin" />;

/** Сценарий так и не загрузился: одна тихая строка с повтором вместо вечного
    скелетона. Раскрывать здесь нечего, поэтому переключателя нет. */
function ScenarioFailed({ onRetry }) {
  const [retrying, setRetrying] = useState(false);
  return (
    <section className={section} data-testid="scenario-failed">
      <div className="flex h-7 items-center gap-2">
        <h3 className={cn(sectionTitle, 'm-0')}>Сценарий</h3>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">Не удалось загрузить</span>
        <IconAction
          icon={retrying ? Spinning : RotateCw}
          label="Повторить"
          size="icon-xs"
          className="-mr-1.5"
          disabled={retrying}
          data-testid="scenario-retry"
          onClick={() => {
            setRetrying(true);
            Promise.resolve(onRetry?.()).finally(() => setRetrying(false));
          }}
        />
      </div>
    </section>
  );
}

function Sidebar({
  id,
  data,
  name,
  cfg,
  pins,
  dbPhone,
  dbCity,
  signals,
  goals,
  handoff,
  now,
  beats,
  scenarioBeats,
  telemetryRows,
  scenarioFailed = false,
  onRetryScenario,
  busy,
  setBusy,
  load,
  scrollToMessage,
  sidebarOpen,
  onClose,
  onBack,
}) {
  const [scenarioOpen, toggleScenario] = useScenarioOpen();
  // Опрос сценария иногда падает, и родитель сбрасывает beats в null. Список
  // при этом не убираем: показываем последний удачный ответ этого же чата.
  const lastScenario = useRef(null);
  if (beats) lastScenario.current = { id, beats, scenarioBeats, telemetryRows };
  const scenario = beats
    ? { beats, scenarioBeats, telemetryRows }
    : lastScenario.current?.id === id
      ? lastScenario.current
      : null;

  const presence = presenceLabel(data.client_presence);

  return (
    <aside
      className={cn(
        'sidebar',
        'flex',
        SIDEBAR,
        // Узкий экран: колонка выезжает поверх затемнения (оно z-40, колонка z-50).
        // Закрытая — invisible: с клавиатуры в спрятанную колонку не попасть.
        'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:w-[min(380px,92vw)] max-lg:transition-[translate,visibility] max-lg:duration-200',
        sidebarOpen ? 'max-lg:translate-x-0' : 'max-lg:invisible max-lg:-translate-x-full',
      )}
    >
      {/* Только на широком экране (ниже lg — display:none): на узком такая же
          кнопка стоит первой в строке действий чата. */}
      <div className={SIDEBAR_TOP}>
        <Button variant="ghost" size="sm" className="backBtn" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          К дашборду
        </Button>
      </div>
      <div className={SIDEBAR_BODY}>
      <section className={cn('agentCard', SECTION)}>
        <div className="flex items-center gap-2.5">
          <ClientAvatar
            className="size-10 shrink-0 rounded-full border text-sm"
            style={{ '--av-bg': AVATAR_BG.blue }}
            src={data.client_avatar}
            name={name}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm leading-5 font-semibold [overflow-wrap:anywhere]">{name}</span>
            <span className="flex min-h-4 items-center text-xs leading-4">
              {data.blocked_by_client_at ? (
                <span className="font-medium text-destructive" data-testid="client-blocked">заблокировал(а) нас</span>
              ) : data.cleared_by_client_at ? (
                <span className="font-medium text-destructive" data-testid="client-cleared">почистил(а) диалог · {whenLabel(data.cleared_by_client_at)}</span>
              ) : (
                presence && (
                  <span className="flex items-center gap-1.5 text-muted-foreground" data-testid="client-presence">
                    {presence.tone === 'online' && <span className={cn(dot, 'bg-success-foreground')} aria-hidden="true" />}
                    {presence.text}
                  </span>
                )
              )}
            </span>
          </div>
          <IconAction
            icon={X}
            label="Закрыть карточку"
            className="self-start lg:hidden"
            onClick={onClose}
          />
        </div>

        <Attribution value={data} compact />

        <div className="flex min-w-0 flex-col">
          <div className={metaRow}>
            <span className={metaLabel}>Стадия</span>
            <span className={cn(metaValue, 'flex')}>
              {cfg.label ? (
                <Badge variant="outline" className="max-w-full gap-1.5">
                  <span className={dot} style={{ background: cfg.color }} aria-hidden="true" />
                  <span className="truncate">{cfg.label}</span>
                </Badge>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </span>
          </div>
          <div className={metaRow} data-testid="deal-stage">
            <span className={metaLabel}>Этап</span>
            {/* Здесь это поле формы, а не ячейка таблицы: обычный select с рамкой, 32px. */}
            <NativeSelect
              className="my-0.5 min-w-0"
              aria-label="Этап сделки"
              value={pins.deal_stage || ''}
              disabled={busy}
              onChange={async (e) => {
                const stage = e.target.value;
                if (!stage) return;
                let note = '';
                if (stage === 'archive') {
                  note = window.prompt('Почему в архив?', pins.deal_note || '');
                  if (note == null || !note.trim()) return;
                }
                setBusy(true);
                try {
                  await setDealStage(id, stage, note);
                  load();
                } catch {
                  // всплывашка action-store уже показала причину
                } finally {
                  setBusy(false);
                }
              }}
            >
              <option value="">— не задан</option>
              {DEAL_STAGES.map((st) => (
                <option key={st.id} value={st.id}>{st.label}</option>
              ))}
            </NativeSelect>
          </div>
          {pins.deal_stage === 'archive' && pins.deal_note && (
            <div className={cn(metaRow, 'items-start py-1')}>
              <span className={cn(metaLabel, 'leading-5')}>Причина</span>
              <span className="min-w-0 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]" title="Причина архива">{pins.deal_note}</span>
            </div>
          )}
          <div className={metaRow}>
            <span className={metaLabel}>Возраст</span>
            <span className={metaValue}>
              <EditableValue
                label="Возраст"
                value={pins.age ? String(pins.age) : ''}
                onSave={async (v) => { await pinFact(id, 'age', v); load(); }}
              />
            </span>
          </div>
          <div className={metaRow}>
            <span className={metaLabel}>Город</span>
            <span className={metaValue}>
              <EditableValue
                label="Город"
                value={pins.city || ''}
                display={pins.city || dbCity}
                onSave={async (v) => { await pinFact(id, 'city', v); load(); }}
              />
            </span>
          </div>
          <div className={metaRow}>
            <span className={metaLabel}>Сайт</span>
            <span className={metaValue}>
              <EditableValue
                label="Сайт"
                value={pins.site || ''}
                title="Сайт знакомств лида — подставляется в {site} этого диалога"
                onSave={async (v) => { await pinFact(id, 'site', v); load(); }}
              />
            </span>
          </div>
          <div className={metaRow}>
            <span className={metaLabel}>Контакт</span>
            <span className={cn(metaValue, metaText)}>
              {phoneLabel(pins, dbPhone) || (data.client_username ? (
                <a className={metaLink} href={`https://t.me/${data.client_username}`} target="_blank" rel="noreferrer" title="Номер скрыт в Telegram — ник собеседника">
                  @{data.client_username}
                </a>
              ) : '—')}
            </span>
          </div>
          <div className={metaRow} data-testid="writing-account">
            <span className={metaLabel}>Аккаунт</span>
            <span className={cn(metaValue, metaText)}>
              {data.account ? (
                <span title={`Аккаунт Telegram, с которого ${data.persona_name || data.account.persona_id || 'личность'} ведёт этот чат`}>
                  {data.account.display_name || data.persona_name || data.account.persona_id}
                  {data.account.username ? (
                    <> · <a className={metaLink} href={`https://t.me/${data.account.username}`} target="_blank" rel="noreferrer">@{data.account.username}</a></>
                  ) : data.account.phone ? ` · ${data.account.phone}` : ''}
                </span>
              ) : '—'}
            </span>
          </div>
          <div className={metaRow}>
            <span className={metaLabel}>Семья</span>
            <span className={metaValue}>
              <EditableValue
                label="Семья"
                value={pins.family || ''}
                display={familyLabel(pins)}
                onSave={async (v) => { await pinFact(id, 'family', v); load(); }}
              />
            </span>
          </div>
        </div>

        {/* Строка под сигналы занята всегда: их появление не двигает секции ниже. */}
        <div className={cn('signals', 'flex min-h-5 w-full flex-wrap gap-1.5')}>
          {signals.map((s) => (
            <Badge key={s.key} variant={SIGNAL_VARIANT[s.tone] || 'outline'} className="h-5">
              {s.text}
            </Badge>
          ))}
        </div>
      </section>

      <ChatNote
        note={data.note}
        noteBy={data.note_by}
        noteAt={data.note_at}
        onSave={async (text) => { await setChatNote(id, text); load(); }}
      />

      <section className={section}>
        <div className={sectionHeader}>
          <h3 className={sectionTitle}>Цели знакомства{goals?.stage?.title ? ` · ${goals.stage.title}` : ''}</h3>
          <span className={sectionCount}>{goals ? `${goals.known} / ${goals.total}` : '—'}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-md bg-muted/40 px-2.5 py-2">
          <span className={cn(caption, 'flex items-center gap-1.5')}>
            <span className={cn(dot, NOW_DOT[now.tone] || NOW_DOT.ask)} aria-hidden="true" />
            сейчас
          </span>
          <p className={cn('nextText', 'm-0 text-sm leading-5')}>{now.text}</p>
          <span className={cn(caption, 'min-h-4')}>{now.hint}</span>
        </div>
        {handoff.length > 0 && (
          <div className="flex flex-col">
            {handoff.map((h) => (
              <span
                key={h.key}
                className={cn(
                  'checkRow',
                  'grid h-7 grid-cols-[14px_76px_minmax(0,1fr)] items-center gap-2 text-xs leading-4',
                )}
                title={h.title}
              >
                <span className={cn('text-center font-medium', CHECK_MARK[h.state] || CHECK_MARK.ask)}>
                  {h.state === 'ok' ? '✓' : h.state === 'fail' ? '!' : h.state === 'skip' ? '–' : '?'}
                </span>
                <span className="min-w-0 truncate text-muted-foreground">{h.label}</span>
                <span
                  className={cn(
                    'min-w-0',
                    h.state === 'ok' ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <EditableValue
                    label={h.label}
                    value={h.value || ''}
                    display={h.note}
                    title={`${h.title} — нажмите, чтобы отметить вручную`}
                    onSave={async (v) => { await setSlot(id, h.key, v); load(); }}
                  />
                </span>
              </span>
            ))}
          </div>
        )}
      </section>

      {!scenario &&
        (scenarioFailed ? (
          <ScenarioFailed onRetry={onRetryScenario} />
        ) : (
          <ScenarioSkeleton open={scenarioOpen} onToggle={toggleScenario} />
        ))}

      {scenario && (
        <section className={section}>
          <ScenarioToggle open={scenarioOpen} onToggle={toggleScenario}>
            <span className={sectionCount}>
              {scenario.beats.delivered} / {scenario.beats.total}
            </span>
          </ScenarioToggle>

          {scenarioOpen && groupByDay(scenario.scenarioBeats).map((g) => {
            const done = g.items.filter((b) => b.status === 'delivered').length;
            return (
              <div key={g.day} className="flex flex-col gap-1">
                <div className="flex min-h-4 items-center gap-2">
                  <span className={cn('dayProgressLabel', caption, 'min-w-[44px]')}>
                    {g.day ? `день ${g.day}` : 'без дня'}
                  </span>
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn('progressFill', 'block h-full rounded-full bg-foreground/70 transition-[width] duration-300')}
                      style={{ width: `${g.items.length ? (done / g.items.length) * 100 : 0}%` }}
                    />
                  </span>
                  <span className={cn('dayFraction', caption, 'min-w-[34px] text-right tabular-nums')}>
                    {done} / {g.items.length}
                  </span>
                </div>
                <div className={cn('beatRows', '-mx-1.5 flex flex-col')}>
                  {g.items.map((b) => {
                    const isDone = b.status === 'delivered';
                    const jumpTo = findMessageIndex(data?.messages, b);
                    const jumpable = jumpTo !== -1;
                    const comment = beatComment(b);
                    const jump = () => scrollToMessage(jumpTo);
                    return (
                      <div key={b.id}>
                        <div
                          className={cn(
                            'beatRow',
                            'flex min-h-6 items-baseline gap-2 rounded-md px-1.5 py-1',
                            jumpable &&
                              'cursor-pointer outline-none select-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
                          )}
                          title={jumpable ? 'Показать в переписке' : undefined}
                          role={jumpable ? 'button' : undefined}
                          tabIndex={jumpable ? 0 : undefined}
                          onClick={jumpable ? jump : undefined}
                          onKeyDown={
                            jumpable
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    jump();
                                  }
                                }
                              : undefined
                          }
                        >
                          <span className={cn('beatCheck', 'min-w-[10px] shrink-0 text-xs leading-4 font-medium text-success-foreground')}>{isDone ? '✓' : ''}</span>
                          <span
                            className={cn(
                              'beatId',
                              'min-w-6 shrink-0 text-xs leading-4 tabular-nums',
                              isDone ? 'beatIdDone text-foreground' : 'text-muted-foreground',
                            )}
                          >
                            {b.id}
                          </span>
                          <span
                            className={cn(
                              'min-w-0 flex-1 text-xs leading-4',
                              isDone ? 'text-foreground' : 'text-muted-foreground',
                            )}
                          >
                            {shortTitle(b.title)}
                          </span>
                        </div>
                        {b.evidence && isMediaEvidence(b.evidence) && (
                          <p className={cn('beatEvidence', 'm-0 mb-1 ml-14 text-xs leading-4 text-muted-foreground')}>
                            <img
                              className={cn('beatEvidenceThumb', 'mb-1 block size-[84px] rounded-md bg-muted object-cover')}
                              src={mediaUrl(id, b.ts)}
                              alt="Отправленный кадр"
                              onError={(e) => {
                                // Кадр не загрузился: прячем картинку, но её место остаётся.
                                e.currentTarget.style.visibility = 'hidden';
                              }}
                            />
                            {deliveredBy(b)}: кадр отправлен
                          </p>
                        )}
                        {b.evidence && !isMediaEvidence(b.evidence) && comment && (
                          <p className={cn('beatEvidence', 'm-0 mb-1 ml-14 line-clamp-2 text-xs leading-4 text-muted-foreground')}>
                            {comment.kind === 'reason' ? (
                              <>
                                {deliveredBy(b)}: {comment.text}
                                {comment.evidence && (
                                  <>
                                    <br />
                                    <span className={cn('beatEvidenceMeta', 'opacity-75')}>
                                      улика: «{comment.evidence}»
                                    </span>
                                  </>
                                )}
                              </>
                            ) : comment.kind === 'pair' ? (
                              <>
                                {deliveredBy(b)}: зачтено по обмену
                                <br />
                                <span className={cn('beatEvidenceMeta', 'opacity-75')}>клиент:</span>{' '}
                                «{comment.client || '—'}»{' '}
                                <span className={cn('beatEvidenceMeta', 'opacity-75')}>Ира:</span> «
                                {comment.ira || '—'}»
                              </>
                            ) : comment.kind === 'pin' ? (
                              <>
                                {deliveredBy(b)}:{' '}
                                {comment.phrase || (
                                  <span className={cn('beatEvidenceMeta', 'opacity-75')}>
                                    ключ леджера
                                  </span>
                                )}
                                {comment.key && (
                                  <>
                                    <br />
                                    <span className={cn('beatEvidenceMeta', 'opacity-75')}>
                                      {comment.key}
                                      {comment.value ? `: ${comment.value}` : ''}
                                    </span>
                                  </>
                                )}
                              </>
                            ) : (
                              <>{deliveredBy(b)}: «{comment.text}»</>
                            )}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {scenarioOpen && scenario.telemetryRows.length > 0 && (
            <div className="flex flex-col gap-1 border-t pt-2.5">
              <span className={caption}>вне счёта</span>
              <div className="-mx-1.5 flex flex-col">
                {scenario.telemetryRows.map(({ beat: b, note }) => (
                  <div key={b.id} className={cn('telemetryRow', 'flex min-h-6 items-baseline gap-2 px-1.5 py-1 text-xs leading-4 text-muted-foreground')}>
                    <span className="min-w-6 shrink-0 tabular-nums">{b.id}</span>
                    <span className="min-w-0 flex-1">{shortTitle(b.title)}</span>
                    <span className="shrink-0">{note}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
      </div>
    </aside>
  );
}

export default Sidebar;
