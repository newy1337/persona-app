import { useEffect, useState } from 'react';
import { CalendarClock, Check, Eye, ListPlus, ListX, MessageSquare, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { PanelUX } from '../../ui/PanelUX';
import { updateLead } from '../../api/leads';
import { setDealStage } from '../../api/conversations';
import { useChatWatch } from '../../components/ChatWatch/chatWatch';
import { DEAL_STAGES } from '../../data/dealStages';
import { genderLabel } from '../../utils/chat';
import { httpHref } from '../../utils/safeUrl';
import { NEXT_TONE, fromLocalInput, leadTypeLabel, leadsBy, nextStepState, nextStepWhen, shortDate, toLocalInput } from './leadInfo';

// Карточка лида — панель справа, как в CRM: всё о лиде в одном месте и то,
// что менеджер делает руками: следующий шаг с датой, заметки, этап сделки.
// Остальное (очередь, диалог, удаление) — те же действия, что в строке таблицы.
const SECTION = 'flex flex-col gap-2 border-t px-4 py-3';
const HEAD = 'text-xs font-medium tracking-wide text-muted-foreground uppercase';

function Row({ label, children }) {
  if (children === null || children === undefined || children === '' || children === false) return null;
  return (
    <div className="grid grid-cols-[112px_1fr] gap-2 text-sm leading-5">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

const hour = 3600;
/** Быстрые сроки шага: через час, завтра в 10:00, через 3 дня в 10:00 (по Москве). */
function presets(now = Math.floor(Date.now() / 1000)) {
  // Сдвиг на +3 часа: UTC-поля даты становятся московскими (летнего времени нет).
  const mskDay = (days) => {
    const d = new Date((now + 3 * hour) * 1000);
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(10, 0, 0, 0);
    return Math.floor(d.getTime() / 1000) - 3 * hour;
  };
  return [
    { label: 'Через час', ts: now + hour },
    { label: 'Завтра 10:00', ts: mskDay(1) },
    { label: 'Через 3 дня', ts: mskDay(3) },
  ];
}

function NextStep({ lead, onSaved }) {
  const [text, setText] = useState(lead.next_step || '');
  const [when, setWhen] = useState(toLocalInput(lead.next_step_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    setText(lead.next_step || '');
    setWhen(toLocalInput(lead.next_step_at));
  }, [lead.id, lead.next_step, lead.next_step_at]);

  const state = nextStepState(lead);
  const dirty = text.trim() !== (lead.next_step || '') || fromLocalInput(when) !== (lead.next_step_at ?? null);

  async function save(patch) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await updateLead(lead.id, patch));
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={SECTION} aria-label="Следующий шаг">
      <div className="flex items-center gap-2">
        <h3 className={HEAD}>Следующий шаг</h3>
        {state !== 'none' && (
          <span className={cn('ml-auto text-xs', NEXT_TONE[state], state === 'overdue' && 'font-medium')} data-testid="card-next-when">
            {nextStepWhen(lead)}
          </span>
        )}
      </div>
      <Input value={text} maxLength={200} placeholder="Что сделать: позвонить, уточнить депозит…" aria-label="Что сделать" onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Input type="datetime-local" className="w-auto" value={when} aria-label="Когда" onChange={(e) => setWhen(e.target.value)} />
        {presets().map((p) => (
          <Button key={p.label} type="button" size="xs" variant="outline" onClick={() => setWhen(toLocalInput(p.ts))}>
            {p.label}
          </Button>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy || !dirty || (!text.trim() && !when)} onClick={() => save({ next_step: text.trim() || null, next_step_at: fromLocalInput(when) })}>
          <CalendarClock aria-hidden="true" />
          Сохранить
        </Button>
        {state !== 'none' && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => save({ next_step: null, next_step_at: null })}>
            <Check aria-hidden="true" />
            Выполнено
          </Button>
        )}
      </div>
    </section>
  );
}

function Notes({ lead, onSaved }) {
  const [text, setText] = useState(lead.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => setText(lead.notes || ''), [lead.id, lead.notes]);
  const dirty = text.trim() !== (lead.notes || '');
  return (
    <section className={SECTION} aria-label="Заметки">
      <h3 className={HEAD}>Заметки</h3>
      <Textarea rows={3} maxLength={512} value={text} placeholder="Что важно помнить о лиде" aria-label="Заметки" onChange={(e) => setText(e.target.value)} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !dirty}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              onSaved(await updateLead(lead.id, { notes: text.trim() || null }));
            } catch (e) {
              setError(e.detail || e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Сохранить заметку
        </Button>
      </div>
    </section>
  );
}

export function LeadCard({ lead, statusLabel, statusBadge, onClose, onChanged, onChat, onQueue, onUnqueue, onDelete }) {
  const watch = useChatWatch();
  const [stageError, setStageError] = useState(null);
  if (!lead) return null;
  const name = lead.first_name || lead.phone_e164 || (lead.username ? `@${lead.username}` : `Лид #${lead.id}`);
  const about = [lead.age ? `${lead.age} лет` : null, genderLabel(lead.gender, true), lead.city].filter(Boolean).join(' · ');
  const chatId = lead.telegram_user_id;
  const by = leadsBy(lead);
  const profile = lead.profile_url ? httpHref(lead.profile_url) : null;
  const sender = lead.assigned_account_username || lead.preferred_account_username;

  async function changeStage(stage) {
    if (!stage || !chatId) return;
    let note = '';
    if (stage === 'archive') {
      note = await PanelUX.prompt({ title: 'В архив', message: 'Почему диалог уходит в архив?', value: '', confirmLabel: 'В архив' });
      if (!note) return;
    }
    setStageError(null);
    try {
      await setDealStage(chatId, stage, note);
      onChanged();
    } catch (e) {
      setStageError(e.detail || e.message);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md" data-testid="lead-card">
        <header className="flex flex-col gap-1.5 px-4 pt-4 pb-3 pr-12">
          <SheetTitle className="text-lg leading-6">{name}</SheetTitle>
          <SheetDescription className="text-sm">{about || `лид #${lead.id}`}</SheetDescription>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={statusBadge?.variant ?? 'outline'} className={statusBadge?.className}>{statusLabel}</Badge>
            <Badge variant={lead.cold ? 'secondary' : 'default'}>{leadTypeLabel(lead)}</Badge>
            {lead.reassigned && <Badge variant="outline">Перезабив</Badge>}
            {lead.unread_count > 0 && <Badge variant="default">{`${lead.unread_count} новых`}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {chatId && (
              <Button type="button" size="sm" onClick={() => onChat(chatId)}>
                <MessageSquare aria-hidden="true" />
                Открыть диалог
              </Button>
            )}
            {chatId && watch && (
              <Button type="button" size="sm" variant="outline" onClick={() => watch.open({ chatId, name, avatar: null, account: sender ? `@${sender}` : null })}>
                <Eye aria-hidden="true" />
                Следить
              </Button>
            )}
            {(lead.status === 'pending' || lead.status === 'dead') && (
              <Button type="button" size="sm" variant="outline" onClick={() => onQueue([lead.id])}>
                <ListPlus aria-hidden="true" />
                В очередь
              </Button>
            )}
            {lead.status === 'queued' && (
              <Button type="button" size="sm" variant="outline" onClick={() => onUnqueue([lead.id])}>
                <ListX aria-hidden="true" />
                Снять с очереди
              </Button>
            )}
          </div>
        </header>

        <NextStep lead={lead} onSaved={onChanged} />

        <section className={SECTION} aria-label="Сделка">
          <h3 className={HEAD}>Сделка</h3>
          <Field label="Этап">
            <NativeSelect value={lead.deal_stage || ''} disabled={!chatId} onChange={(e) => changeStage(e.target.value)}>
              <option value="">{chatId ? 'Нужно указать этап' : 'Этап появится, когда будет диалог'}</option>
              {DEAL_STAGES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </NativeSelect>
          </Field>
          {stageError && <p className="text-xs text-destructive">{stageError}</p>}
          <Row label="Ведёт">{by === 'none' ? null : by === 'manager' ? 'Менеджер' : 'Бот'}</Row>
          <Row label="Последнее">{lead.last_message_ts ? shortDate(lead.last_message_ts) : null}</Row>
          <Row label="Клиент писал">{lead.last_client_ts ? shortDate(lead.last_client_ts) : null}</Row>
          <Row label="Написали">{lead.first_contact_at ? shortDate(lead.first_contact_at) : 'ещё не писали'}</Row>
        </section>

        <section className={SECTION} aria-label="Контакт">
          <h3 className={HEAD}>Контакт</h3>
          <Row label="Телефон">{lead.phone_e164 && <span className="font-mono text-xs">{lead.phone_e164}</span>}</Row>
          <Row label="Username">{lead.username && `@${lead.username}`}</Row>
          <Row label="Найден в TG">{lead.telegram_username ? `@${lead.telegram_username}` : lead.telegram_user_id ? String(lead.telegram_user_id) : null}</Row>
          <Row label="Профиль">{lead.profile_url && (profile ? <a className="text-primary underline-offset-4 hover:underline" href={profile} target="_blank" rel="noreferrer">{lead.profile_url.replace(/^https?:\/\//i, '').slice(0, 60)}</a> : String(lead.profile_url).slice(0, 60))}</Row>
          <Row label="Сайт">{lead.site}</Row>
        </section>

        <section className={SECTION} aria-label="Работа с лидом">
          <h3 className={HEAD}>Работа</h3>
          <Row label="Личность">{lead.persona_name || lead.persona_id || 'не указана'}</Row>
          <Row label="Аккаунт">{sender ? `@${sender}` : 'автоматически'}</Row>
          <Row label="Менеджер">{lead.manager_username ? `${lead.manager_username}${lead.region_code ? ` · регион ${lead.region_code}` : ''}` : null}</Row>
          <Row label="Попытки">{`${lead.attempts ?? 0}${lead.next_attempt_at ? ` · следующая ${shortDate(lead.next_attempt_at)}` : ''}`}</Row>
          <Row label="Ошибка">{lead.last_error && <span className="text-destructive">{lead.last_error}</span>}</Row>
        </section>

        <section className={SECTION} aria-label="Откуда лид">
          <h3 className={HEAD}>Откуда</h3>
          <Row label="Добавлен">{shortDate(lead.inserted_at)}</Row>
          <Row label="Источник">{lead.inbound_at ? lead.source_type : 'вручную'}</Row>
          <Row label="Донор">{lead.donor}</Row>
          <Row label="ID у донора">{lead.external_id}</Row>
          <Row label="Аккаунт донора">{lead.account_label}</Row>
          <Row label="Регион">{lead.requested_region}</Row>
          <Row label="Личность от донора">{lead.requested_persona}</Row>
        </section>

        <Notes lead={lead} onSaved={onChanged} />

        {(lead.first_message || lead.last_messages) && (
          <section className={SECTION} aria-label="Переписка до нас">
            {lead.first_message && (
              <>
                <h3 className={HEAD}>{lead.first_contact_at ? 'Первое сообщение' : 'Напишем'}</h3>
                <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{lead.first_message}</p>
              </>
            )}
            {lead.last_messages && (
              <>
                <h3 className={HEAD}>История от донора</h3>
                <p className="max-h-48 overflow-y-auto text-sm whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{lead.last_messages}</p>
              </>
            )}
          </section>
        )}

        <footer className="border-t px-4 py-3">
          <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDelete(lead)}>
            <Trash2 aria-hidden="true" />
            Удалить лида
          </Button>
        </footer>
      </SheetContent>
    </Sheet>
  );
}
