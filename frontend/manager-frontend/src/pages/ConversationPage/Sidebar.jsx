import { useRef } from 'react';
import { Cake, Flag, Globe, IdCard, ListChecks, MapPin, Phone, Target, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Attribution } from '../../ui/ManagerRegion';
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

/* Общие куски карточек сайдбара. Карточка — прямой потомок <aside>. */
const section = cn('summarySection', 'shrink-0 gap-0 rounded-lg py-0 shadow-none');
const sectionHeader = 'flex min-h-10 items-center justify-between gap-2 border-b px-4 py-2';
const sectionTitle = 'flex min-w-0 items-center gap-2 text-sm font-semibold';
const sectionIcon = 'size-4 shrink-0 text-muted-foreground';
const sectionTag = 'h-5 min-w-[44px] rounded-full font-mono font-normal tabular-nums';
const sectionBody = 'flex flex-col gap-2 p-4';

const metaRow = 'grid min-h-6 grid-cols-[80px_1fr] items-center gap-2.5 text-xs font-medium';
const metaLabel = 'flex items-center gap-2 font-normal text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0';
const metaValue = 'min-w-0 truncate';
const metaLink = 'rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50';

const caption = 'font-mono text-[10px] leading-4 tracking-wide text-muted-foreground uppercase';
const mono = 'shrink-0 font-mono text-[10px] font-semibold';

/* Плашка «сейчас»: свой набор тонов, отдельный от тонов строк ниже. */
const NOW_TONE = {
  ask: { box: 'border-primary/30 bg-primary/10', label: 'text-primary' },
  ok: { box: 'border-success-foreground/25 bg-success/60', label: 'text-success-foreground' },
  skip: { box: 'border-border bg-muted/40', label: 'text-muted-foreground' },
  fail: { box: 'border-destructive/30 bg-destructive/10', label: 'text-destructive' },
};

const CHECK_TONE = {
  ok: { mark: 'text-success-foreground', label: 'text-foreground', note: 'text-muted-foreground' },
  ask: { mark: 'text-warning-foreground', label: 'text-muted-foreground', note: 'text-warning-foreground' },
  fail: { mark: 'text-destructive', label: 'text-muted-foreground', note: 'text-destructive' },
  skip: { mark: 'text-muted-foreground', label: 'text-muted-foreground', note: 'text-muted-foreground' },
};

const SIGNAL_VARIANT = { warn: 'warning' };

/* Заглушка первой загрузки сценария: те же строки и отступы, что у готового
   списка (шапка дня h-4 + строки по 24px), чтобы высоты совпадали. */
const SKELETON_BEATS = ['w-2/3', 'w-1/2', 'w-3/5', 'w-2/5'];

function ScenarioSkeleton() {
  return (
    <Card className={section} aria-busy="true">
      <div className={sectionHeader}>
        <span className={sectionTitle}>
          <ListChecks className={sectionIcon} />
          <span className="truncate">Сценарий</span>
        </span>
        <Skeleton className="h-5 w-11 rounded-full" />
      </div>
      <div className={sectionBody}>
        <div className="flex flex-col gap-0.5">
          <div className="flex h-4 items-center gap-2">
            <Skeleton className="h-2.5 w-11" />
            <Skeleton className="h-1 flex-1 rounded-full" />
            <Skeleton className="h-2.5 w-[34px]" />
          </div>
          <div className="flex flex-col">
            {SKELETON_BEATS.map((w) => (
              <div key={w} className="flex h-6 items-center gap-2 px-1.5">
                <Skeleton className="h-2.5 w-2.5" />
                <Skeleton className="h-2.5 w-6" />
                <Skeleton className={cn('h-3', w)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
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
  busy,
  setBusy,
  load,
  scrollToMessage,
  sidebarOpen,
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
  const nowTone = NOW_TONE[now.tone] || NOW_TONE.ask;

  return (
    <aside
      className={cn(
        'sidebar',
        '@container/side flex w-[clamp(360px,34vw,600px)] shrink-0 flex-col gap-3 overflow-y-auto border-r bg-background p-4 [scrollbar-gutter:stable]',
        'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:w-[min(420px,92vw)] max-lg:shadow-lg max-lg:transition-transform max-lg:duration-200',
        sidebarOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
      )}
    >
      <Card className={cn('agentCard', 'shrink-0 gap-3 rounded-lg p-4 shadow-none')}>
        <ClientAvatar
          className="size-[72px] shrink-0 rounded-full border text-2xl"
          style={{ '--av-bg': AVATAR_BG.blue }}
          src={data.client_avatar}
          name={name}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-base leading-6 font-semibold [overflow-wrap:anywhere]">{name}</span>
          <Attribution value={data} compact />
          <span className="flex min-h-4 items-center text-xs leading-4">
            {data.blocked_by_client_at ? (
              <span className="font-semibold text-destructive" data-testid="client-blocked">заблокировал(а) нас</span>
            ) : data.cleared_by_client_at ? (
              <span className="font-semibold text-destructive" data-testid="client-cleared">почистил(а) диалог · {whenLabel(data.cleared_by_client_at)}</span>
            ) : (
              presence && (
                <span
                  className={presence.tone === 'online' ? 'text-primary' : 'text-muted-foreground'}
                  data-testid="client-presence"
                >
                  {presence.text}
                </span>
              )
            )}
          </span>
          <span className="flex min-h-[26px] items-center">
            {cfg.label && (
              <Badge
                variant="outline"
                className="h-[26px] max-w-full gap-1.5 rounded-full border-[color:color-mix(in_srgb,var(--badge-color)_20%,transparent)] bg-(--badge-bg) px-2.5 font-semibold text-(color:--badge-color)"
                style={{ '--badge-color': cfg.color, '--badge-bg': cfg.bg }}
              >
                <span className="size-1.5 shrink-0 rounded-full bg-current" />
                <span className="truncate">{cfg.label}</span>
              </Badge>
            )}
          </span>
          <span className="flex min-w-0 flex-col gap-1 text-xs" data-testid="deal-stage">
            <span className="flex min-w-0 items-center gap-2">
              <span className={metaLabel}><Flag />Этап</span>
              <NativeSelect
                className="h-7 min-w-0 flex-1 px-1.5 text-xs"
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
            </span>
            {pins.deal_stage === 'archive' && pins.deal_note && (
              <span className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]" title="Причина архива">{pins.deal_note}</span>
            )}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1 border-t pt-3">
          <span className={metaRow}>
            <span className={metaLabel}><Cake />Возраст</span>
            <span className={metaValue}>
              <EditableValue
                label="Возраст"
                value={pins.age ? String(pins.age) : ''}
                onSave={async (v) => { await pinFact(id, 'age', v); load(); }}
              />
            </span>
          </span>
          <span className={metaRow}>
            <span className={metaLabel}><MapPin />Город</span>
            <span className={metaValue}>
              <EditableValue
                label="Город"
                value={pins.city || ''}
                display={pins.city || dbCity || '—'}
                onSave={async (v) => { await pinFact(id, 'city', v); load(); }}
              />
            </span>
          </span>
          <span className={metaRow}>
            <span className={metaLabel}><Globe />Сайт</span>
            <span className={metaValue}>
              <EditableValue
                label="Сайт"
                value={pins.site || ''}
                title="Сайт знакомств лида — подставляется в {site} этого диалога"
                onSave={async (v) => { await pinFact(id, 'site', v); load(); }}
              />
            </span>
          </span>
          <span className={metaRow}>
            <span className={metaLabel}><Phone />Контакт</span>
            <span className={metaValue}>
              {phoneLabel(pins, dbPhone) || (data.client_username ? (
                <a className={metaLink} href={`https://t.me/${data.client_username}`} target="_blank" rel="noreferrer" title="Номер скрыт в Telegram — ник собеседника">
                  @{data.client_username}
                </a>
              ) : '—')}
            </span>
          </span>
          <span className={metaRow} data-testid="writing-account">
            <span className={metaLabel}><IdCard />Аккаунт</span>
            <span className={metaValue}>
              {data.account ? (
                <span title={`Аккаунт Telegram, с которого ${data.persona_name || data.account.persona_id || 'личность'} ведёт этот чат`}>
                  {data.account.display_name || data.persona_name || data.account.persona_id}
                  {data.account.username ? (
                    <> · <a className={metaLink} href={`https://t.me/${data.account.username}`} target="_blank" rel="noreferrer">@{data.account.username}</a></>
                  ) : data.account.phone ? ` · ${data.account.phone}` : ''}
                </span>
              ) : '—'}
            </span>
          </span>
          <span className={metaRow}>
            <span className={metaLabel}><Users />Семья</span>
            <span className={metaValue}>
              <EditableValue
                label="Семья"
                value={pins.family || ''}
                display={familyLabel(pins) || '—'}
                onSave={async (v) => { await pinFact(id, 'family', v); load(); }}
              />
            </span>
          </span>
        </div>
        <div className={cn('signals', 'flex min-h-5 w-full flex-wrap gap-1')}>
          {signals.map((s) => (
            <Badge key={s.key} variant={SIGNAL_VARIANT[s.tone] || 'success'} className="h-5 rounded-full">
              {s.text}
            </Badge>
          ))}
        </div>
      </Card>

      <ChatNote
        note={data.note}
        noteBy={data.note_by}
        noteAt={data.note_at}
        onSave={async (text) => { await setChatNote(id, text); load(); }}
      />

      <Card className={section}>
        <div className={sectionHeader}>
          <span className={sectionTitle}>
            <Target className={sectionIcon} />
            <span className="truncate">Цели знакомства{goals?.stage?.title ? ` · ${goals.stage.title}` : ''}</span>
          </span>
          <Badge variant="outline" className={sectionTag}>
            {goals ? `${goals.known} / ${goals.total}` : '—'}
          </Badge>
        </div>
        <div className={sectionBody}>
          <div className={cn('flex flex-col gap-0.5 rounded-lg border px-3 py-2.5', nowTone.box)}>
            <span className={cn(caption, 'font-semibold', nowTone.label)}>сейчас</span>
            <p className={cn('nextText', 'm-0 text-sm leading-5')}>{now.text}</p>
            <span className="min-h-4 text-xs leading-4 text-muted-foreground italic">{now.hint}</span>
          </div>
          {handoff.map((h) => {
            const tone = CHECK_TONE[h.state] || CHECK_TONE.ask;
            return (
              <span
                key={h.key}
                className={cn(
                  'checkRow',
                  'grid min-h-6 grid-cols-[14px_108px_1fr] items-center gap-1.5 text-xs leading-4 @max-[400px]/side:grid-cols-[14px_minmax(0,1fr)]',
                )}
                title={h.title}
              >
                <span className={cn('text-center font-mono font-bold', tone.mark)}>
                  {h.state === 'ok' ? '✓' : h.state === 'fail' ? '!' : h.state === 'skip' ? '–' : '?'}
                </span>
                <span className={cn('min-w-0 [overflow-wrap:anywhere]', tone.label)}>{h.label}</span>
                <span className={cn('min-w-0 [overflow-wrap:anywhere] @max-[400px]/side:col-start-2', tone.note)}>
                  <EditableValue
                    label={h.label}
                    value={h.value || ''}
                    display={h.note}
                    title={`${h.title} — нажмите, чтобы отметить вручную`}
                    onSave={async (v) => { await setSlot(id, h.key, v); load(); }}
                  />
                </span>
              </span>
            );
          })}
        </div>
      </Card>

      {!scenario && <ScenarioSkeleton />}

      {scenario && (
        <Card className={section}>
          <div className={sectionHeader}>
            <span className={sectionTitle}>
              <ListChecks className={sectionIcon} />
              <span className="truncate">Сценарий</span>
            </span>
            <Badge variant="outline" className={sectionTag}>
              {scenario.beats.delivered} / {scenario.beats.total}
            </Badge>
          </div>

          <div className={sectionBody}>
            {groupByDay(scenario.scenarioBeats).map((g) => {
              const done = g.items.filter((b) => b.status === 'delivered').length;
              return (
                <div key={g.day} className="flex flex-col gap-0.5">
                  <div className="flex min-h-4 items-center gap-2">
                    <span className={cn('dayProgressLabel', caption, 'min-w-[44px]')}>
                      {g.day ? `день ${g.day}` : 'без дня'}
                    </span>
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn('progressFill', 'block h-full rounded-full bg-primary transition-[width] duration-300')}
                        style={{ width: `${g.items.length ? (done / g.items.length) * 100 : 0}%` }}
                      />
                    </span>
                    <span className={cn('dayFraction', 'min-w-[34px] text-right font-mono text-[10px] leading-4 text-muted-foreground tabular-nums')}>
                      {done} / {g.items.length}
                    </span>
                  </div>
                  <div className={cn('beatRows', 'flex flex-col')}>
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
                              'group/beat flex min-h-6 items-baseline gap-2 rounded-md px-1.5 py-1 hover:bg-accent/50',
                              jumpable &&
                                'cursor-pointer outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
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
                            <span className={cn('beatCheck', mono, 'min-w-[10px] text-success-foreground')}>{isDone ? '✓' : ''}</span>
                            <span
                              className={cn(
                                'beatId',
                                mono,
                                'min-w-6',
                                isDone ? 'beatIdDone text-success-foreground' : 'text-muted-foreground',
                              )}
                            >
                              {b.id}
                            </span>
                            <span
                              className={cn(
                                'min-w-0 flex-1 text-xs leading-4',
                                isDone ? 'text-success-foreground' : 'text-muted-foreground',
                                jumpable && 'group-hover/beat:text-primary',
                              )}
                            >
                              {shortTitle(b.title)}
                            </span>
                          </div>
                          {b.evidence && isMediaEvidence(b.evidence) && (
                            <p className={cn('beatEvidence', 'm-0 mb-1 ml-[54px] text-[11px] leading-4 text-muted-foreground italic')}>
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
                            <p className={cn('beatEvidence', 'm-0 mb-1 ml-[54px] line-clamp-2 text-[11px] leading-4 text-muted-foreground italic')}>
                              {comment.kind === 'reason' ? (
                                <>
                                  {deliveredBy(b)}: {comment.text}
                                  {comment.evidence && (
                                    <>
                                      <br />
                                      <span className={cn('beatEvidenceMeta', 'not-italic opacity-75')}>
                                        улика: «{comment.evidence}»
                                      </span>
                                    </>
                                  )}
                                </>
                              ) : comment.kind === 'pair' ? (
                                <>
                                  {deliveredBy(b)}: зачтено по обмену
                                  <br />
                                  <span className={cn('beatEvidenceMeta', 'not-italic opacity-75')}>клиент:</span>{' '}
                                  «{comment.client || '—'}»{' '}
                                  <span className={cn('beatEvidenceMeta', 'not-italic opacity-75')}>Ира:</span> «
                                  {comment.ira || '—'}»
                                </>
                              ) : comment.kind === 'pin' ? (
                                <>
                                  {deliveredBy(b)}:{' '}
                                  {comment.phrase || (
                                    <span className={cn('beatEvidenceMeta', 'not-italic opacity-75')}>
                                      ключ леджера
                                    </span>
                                  )}
                                  {comment.key && (
                                    <>
                                      <br />
                                      <span className={cn('beatEvidenceMeta', 'not-italic opacity-75')}>
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
              <div className="mt-1 flex flex-col gap-0.5 border-t pt-2">
                <span className={caption}>вне счёта</span>
                {scenario.telemetryRows.map(({ beat: b, note }) => (
                  <div key={b.id} className={cn('telemetryRow', 'flex min-h-6 items-baseline gap-2 px-1.5 py-1 text-muted-foreground')}>
                    <span className={cn(mono, 'min-w-6')}>{b.id}</span>
                    <span className="min-w-0 flex-1 text-xs leading-4">{shortTitle(b.title)}</span>
                    <span className="shrink-0 font-mono text-[10px] tracking-wide">{note}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </aside>
  );
}

export default Sidebar;
