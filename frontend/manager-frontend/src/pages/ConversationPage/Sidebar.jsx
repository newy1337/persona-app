import { useRef, useState } from 'react';
import { RotateCw, X } from 'lucide-react';
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

/* Колонка — одна поверхность: секции идут подряд и разделены линиями
   (divide-y у <aside>), своих рамок и фонов у них нет. Секция — прямой
   потомок <aside>. Эти же классы собирают скелетон первой загрузки. */
export const SIDEBAR =
  'w-[clamp(360px,34vw,600px)] shrink-0 flex-col divide-y overflow-y-auto border-x bg-background [scrollbar-gutter:stable]';
export const SECTION = 'flex shrink-0 flex-col gap-3 px-5 py-4';
const section = cn('summarySection', SECTION);
const sectionHeader = 'flex min-h-5 items-center justify-between gap-2';
const sectionTitle = 'min-w-0 truncate text-sm font-medium';
const sectionCount = 'min-w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums';

/* Строка «подпись — значение»: высота 28px и для текста, и для поля правки. */
const metaRow = 'grid min-h-7 grid-cols-[88px_minmax(0,1fr)] items-center gap-3 text-sm';
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

function ScenarioSkeleton() {
  return (
    <section className={section} aria-busy="true">
      <div className={sectionHeader}>
        <h3 className={sectionTitle}>Сценарий</h3>
        <Skeleton className="h-3 w-10" />
      </div>
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
    </section>
  );
}

/** Сценарий так и не загрузился: тихая строка и кнопка повтора вместо вечного скелетона. */
function ScenarioFailed({ onRetry }) {
  const [retrying, setRetrying] = useState(false);
  return (
    <section className={section} data-testid="scenario-failed">
      <div className={sectionHeader}>
        <h3 className={sectionTitle}>Сценарий</h3>
      </div>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">Не удалось загрузить</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={retrying}
          data-testid="scenario-retry"
          onClick={() => {
            setRetrying(true);
            Promise.resolve(onRetry?.()).finally(() => setRetrying(false));
          }}
        >
          <RotateCw aria-hidden="true" className={cn(retrying && 'animate-spin')} />
          Повторить
        </Button>
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
}) {
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
        '@container/side flex',
        SIDEBAR,
        // Узкий экран: колонка выезжает поверх затемнения (оно z-40, колонка z-50).
        // Закрытая — invisible: с клавиатуры в спрятанную колонку не попасть.
        'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:w-[min(420px,92vw)] max-lg:transition-[translate,visibility] max-lg:duration-200',
        sidebarOpen ? 'max-lg:translate-x-0' : 'max-lg:invisible max-lg:-translate-x-full',
      )}
    >
      <section className={cn('agentCard', SECTION)}>
        <div className="flex items-center gap-3">
          <ClientAvatar
            className="size-12 shrink-0 rounded-full border text-base"
            style={{ '--av-bg': AVATAR_BG.blue }}
            src={data.client_avatar}
            name={name}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-base leading-6 font-semibold [overflow-wrap:anywhere]">{name}</span>
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
          <div className={cn(metaRow, 'min-h-9')} data-testid="deal-stage">
            <span className={metaLabel}>Этап</span>
            <NativeSelect
              className="h-8 min-w-0 px-2"
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
                display={pins.city || dbCity || '—'}
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
                display={familyLabel(pins) || '—'}
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
        <div className="flex flex-col gap-0.5 rounded-md bg-muted/40 px-3 py-2.5">
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
                  'grid min-h-7 grid-cols-[14px_108px_minmax(0,1fr)] items-center gap-2 text-xs leading-4 @max-[400px]/side:grid-cols-[14px_minmax(0,1fr)]',
                )}
                title={h.title}
              >
                <span className={cn('text-center font-medium', CHECK_MARK[h.state] || CHECK_MARK.ask)}>
                  {h.state === 'ok' ? '✓' : h.state === 'fail' ? '!' : h.state === 'skip' ? '–' : '?'}
                </span>
                <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{h.label}</span>
                <span
                  className={cn(
                    'min-w-0 @max-[400px]/side:col-start-2',
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

      {!scenario && (scenarioFailed ? <ScenarioFailed onRetry={onRetryScenario} /> : <ScenarioSkeleton />)}

      {scenario && (
        <section className={section}>
          <div className={sectionHeader}>
            <h3 className={sectionTitle}>Сценарий</h3>
            <span className={sectionCount}>
              {scenario.beats.delivered} / {scenario.beats.total}
            </span>
          </div>

          {groupByDay(scenario.scenarioBeats).map((g) => {
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

          {scenario.telemetryRows.length > 0 && (
            <div className="flex flex-col gap-1 border-t pt-3">
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
    </aside>
  );
}

export default Sidebar;
