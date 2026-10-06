import { moscowInputTimestamp } from '../../utils/panelTime';
import { CallPanel } from './CallPanel';
import { CallBrief } from './CallBrief';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, ExternalLink, FileText, LoaderCircle, Pencil, Play, Plus, Send } from 'lucide-react';
import VoicePlayer from '../../components/VoicePlayer/VoicePlayer';
import { api, authHeaders } from '../../api/client';
import { SendVoice, DeliveryStatus } from './SendVoice';
import { PanelUX } from '../../ui/PanelUX';
import { VoiceBotLink } from './VoiceBotLink';
import { TaskChat, TaskChatSelect } from './TaskChat';
import { useRouteBusy } from '@/components/AppLayout/routeBusy';
import { IconAction } from '@/components/IconAction/IconAction';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Pager } from '@/components/Pager/Pager';
import { SearchInput } from '@/components/SearchInput/SearchInput';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const states = { queued: 'В очереди', in_progress: 'В работе', ready: 'Выполнено', completed: 'Выполнено', cancelled: 'Отменено', delivering: 'Отправляется', sent: 'Отправлено', delivery_error: 'Ошибка отправки', delivery_review: 'Проверить доставку', delivery_closed: 'Проверка закрыта' };
const stateVariant = status => status === 'delivery_error' ? 'destructive' : status === 'delivery_review' ? 'warning' : ['ready', 'completed', 'sent'].includes(status) ? 'success' : 'outline';
const modeLabel = task => task.kind === 'call' ? 'Звонок' : task.voiceMode === 'once' ? 'Одноразовое' : 'В библиотеку';
const errorText = e => PanelUX.readableError(e);
const date = seconds => new Date(seconds * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });
const filename = title => title.replace(/[\\/:*?"<>|]/g, '_') + '.ogg';
const PAGE = 40;

const muted = 'text-sm text-muted-foreground';
const caption = 'text-xs text-muted-foreground';
// Строка ошибки занята всегда: окно или карточка не меняют высоту.
const errorSlot = 'min-h-4 text-xs text-destructive';
const prose = 'whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]';
const textareaClass = 'min-h-[100px] field-sizing-fixed';
// Карточка задания и записи — один стиль: одна рамка, p-4, без вложенных цветных блоков.
// Скелет и пустое состояние берут тот же класс, поэтому сетка не меняет высоту при загрузке.
const cardClass = 'flex min-h-[236px] min-w-0 flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground [overflow-wrap:anywhere]';
const gridClass = 'grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))]';

/** Точка статуса: предупреждение показываем ею, а не цветом текста. */
function Dot({ className }) {
  return <span className={cn('size-1.5 shrink-0 rounded-full bg-warning-foreground', className)} aria-hidden="true" />;
}

async function audioBlob(id) {
  const response = await fetch(`/api/voicer/recordings/${id}/file`, { headers: authHeaders() });
  if (!response.ok) throw new Error(response.status === 404 ? 'Запись не найдена' : 'Не удалось загрузить аудио. Обновите страницу и попробуйте ещё раз');
  return response.blob();
}

function CreateTask({ options, context, onClose, onCreated }) {
  const [form, setForm] = useState({ kind: 'voice', voice_mode: context.get('chat') ? 'once' : 'library', manager_id: context.get('manager') || String(options.managers[0]?.id ?? ''),
    persona_slug: context.get('persona') || options.personas[0]?.slug || '', title: '', contact_label: context.get('contact') || '',
    contact_ref: context.get('ref') || '', chat_id: context.get('chat') || '', script: '', emotion: '', tempo: '', instructions: '', priority: '0', due: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const set = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const manager = options.managers.find(m => m.id === Number(form.manager_id));
  async function submit(event) {
    event.preventDefault(); if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (form.kind === 'voice' && form.voice_mode === 'once' && !form.chat_id) throw new Error('Выберите диалог для одноразового голосового');
      const { due, ...body } = form;
      await api.post('/api/voicer/tasks', {
        ...body, manager_id: Number(body.manager_id), priority: Number(body.priority), chat_id: body.chat_id || undefined,
        due_at: due ? moscowInputTimestamp(due) : undefined,
      }); onCreated();
    } catch (e) { setError(errorText(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  const field = (key, label, { full, ...props } = {}) => <Field label={label} className={cn(full && 'sm:col-span-2')}><Input value={form[key]} onChange={e => set(key, e.target.value)} disabled={busy} {...props} /></Field>;
  return <PanelUX.Modal title="Новое задание войсеру" wide busy={busy} onClose={onClose}
    footer={<><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Отмена</Button><Button type="submit" form="voice-task-form" disabled={busy || !manager?.voicer_id}>{busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}{busy ? 'Создаём…' : 'Поставить в очередь'}</Button></>}>
    <form id="voice-task-form" onSubmit={submit} className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-2">
      <Field label="Тип задания"><NativeSelect value={form.kind} onChange={e => set('kind', e.target.value)}><option value="voice">Записать голосовое</option><option value="call">Звонок</option></NativeSelect></Field>
      {form.kind === 'voice' && <Field label="Режим голосового"><NativeSelect value={form.voice_mode} disabled={busy} onChange={e => set('voice_mode', e.target.value)}><option value="library">В библиотеку</option><option value="once">Одноразовое — сразу в диалог</option></NativeSelect></Field>}
      {form.kind === 'voice' && <p role="note" className={cn(caption, 'min-h-8 sm:col-span-2')}>{form.voice_mode === 'once' ? 'После записи войсером голосовое автоматически отправится в выбранный диалог. Дополнительное подтверждение менеджера не требуется.' : 'Запись сохранится в библиотеке. Позже её можно выбрать и отправить в любой доступный вам диалог.'}</p>}
      <Field label="Менеджер"><NativeSelect value={form.manager_id} onChange={e => setForm(old => ({ ...old, manager_id: e.target.value, chat_id: '' }))} required>{options.managers.map(m => <option key={m.id} value={m.id}>{m.username}{m.region ? ` · ${m.region}` : ''}</option>)}</NativeSelect></Field>
      {/* Войсера назначает администратор: это не поле ввода, а справка в той же сетке, что и поля. */}
      <div role="note" className={cn(caption, 'flex min-w-0 flex-col gap-1.5')}>
        Войсер
        <div className="flex h-9 items-center rounded-md bg-muted/40 px-3 text-sm text-foreground"><span className="truncate">{manager?.voicer_name || 'не назначен'}</span></div>
        <span className="flex min-h-4 items-start gap-1.5">{manager?.voicer_id ? !manager.bot_linked && <><Dot className="mt-[5px]" />Telegram ещё не подключён — задание будет ждать в очереди</> : 'Администратор назначает войсера в разделе «Менеджеры»'}</span>
      </div>
      {field('title', 'Название записи / задания', { required: true, maxLength: 160, placeholder: 'Сообщения для Димы · Доброе утро', full: true })}
      <Field label="Личность"><NativeSelect value={form.persona_slug} onChange={e => setForm(old => ({ ...old, persona_slug: e.target.value, chat_id: '' }))} required>{options.personas.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}</NativeSelect></Field>
      {field('contact_label', form.kind === 'voice' && form.voice_mode === 'library' ? 'Собеседник (необязательно)' : 'Собеседник', { required: form.kind === 'call', maxLength: 160, placeholder: 'Дима' })}
      {form.kind === 'call' && field('contact_ref', 'Контакт для звонка', { required: form.kind === 'call' && !form.chat_id, maxLength: 200, placeholder: '@username или номер телефона' })}
      <div className="sm:col-span-2"><TaskChatSelect managerId={form.manager_id} persona={form.persona_slug} value={form.chat_id} disabled={busy} required={form.kind === 'voice' && form.voice_mode === 'once'} warnMissing={form.kind === 'call'} showChatAccess={form.kind === 'call'}
        onChange={(id, item) => setForm(old => ({ ...old, chat_id: id, ...(item ? { contact_label: item.label, contact_ref: item.contact_ref || '' } : {}) }))} /></div>
      {form.kind === 'voice' && <Field label="Текст голосового" className="sm:col-span-2"><Textarea className={textareaClass} rows={4} value={form.script} onChange={e => set('script', e.target.value)} disabled={busy} required maxLength={10000} placeholder="Точный текст, который нужно произнести" /></Field>}
      {field('emotion', 'Эмоциональность', { required: form.kind === 'voice', maxLength: 500, placeholder: 'Тепло, с улыбкой, спокойно' })}
      {field('tempo', 'Темп разговора', { required: form.kind === 'call', maxLength: 500, placeholder: 'Неспешно, давать собеседнику договорить' })}
      <Field label={form.kind === 'call' ? 'Тема звонка и что нужно сделать' : 'Дополнительные указания'} className="sm:col-span-2"><Textarea className={textareaClass} rows={4} value={form.instructions} onChange={e => set('instructions', e.target.value)} disabled={busy} maxLength={5000} required={form.kind === 'call'} /></Field>
      <Field label="Приоритет"><NativeSelect value={form.priority} onChange={e => set('priority', e.target.value)}><option value="0">Обычный</option><option value="1">Повышенный</option><option value="2">Срочно</option></NativeSelect></Field>
      {field('due', 'Желаемое время (МСК)', { type: 'datetime-local' })}
      <p className={cn(caption, 'min-h-8 sm:col-span-2')}>{form.kind === 'call' ? 'Войсер получит полную карточку личности, контакт, тему и темп. Войсер звонит с сайта через Telegram-аккаунт выбранного диалога.' : form.voice_mode === 'once' ? 'Получатель фиксируется при создании задания. Для другого диалога нужно новое задание.' : 'Запись сохранится в библиотеке под этим названием. Отправку собеседнику выбирает менеджер.'}</p>
      <div className={cn(errorSlot, 'sm:col-span-2')}>{error && <p role="alert">{error}</p>}</div>
    </form>
  </PanelUX.Modal>;
}

function TaskDetail({ task: initial, role, bot, initialView, onClose, onChange }) {
  const [task, setTask] = useState(initial), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const voice = role === 'voice';
  const [calling, setCalling] = useState(false);
  const canReadChat = !voice || initial.kind === 'call';
  const [view, setView] = useState((canReadChat && initialView === 'chat') || (voice && initial.kind === 'call' && initial.chatId) ? 'chat' : 'brief');
  const [linkId, setLinkId] = useState(initial.chatId || '');
  async function linkChat() {
    if (lock.current || !linkId) return;
    lock.current = true; setBusy(true); setError('');
    try { setTask(await api.put(`/api/voicer/tasks/${task.id}/conversation`, { chat_id: linkId })); onChange(); setView('chat'); }
    catch (e) { setError(errorText(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => { let active = true; const timer = setInterval(() => {
    if (document.visibilityState === 'visible') api.get(`/api/voicer/tasks/${initial.id}`).then(fresh => { if (active) setTask(fresh); }).catch(() => {});
  }, 15000); return () => { active = false; clearInterval(timer); }; }, [initial.id]);
  async function action(actionName) {
    if (lock.current) return;
    if (actionName === 'cancel' && !await PanelUX.confirm({ title: 'Отменить задание?', message: task.title, confirmLabel: 'Отменить задание' })) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const updated = await api.post(`/api/voicer/tasks/${task.id}/action`, { action: actionName, revision: task.revision, note });
      setTask(updated); setNote(''); onChange();
    } catch (e) { setError(errorText(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  const callDone = task.kind === 'call' && task.call?.connectedAt && task.call?.endedAt;
  const recordingDone = !voice && ['ready', 'completed'].includes(task.status) && task.kind === 'voice';
  const title = <span className="flex flex-wrap items-center gap-2"><span className="[overflow-wrap:anywhere]"><span className="tabular-nums">#{task.id}</span> · {task.title}</span><Badge variant={stateVariant(task.status)}>{states[task.status]}</Badge><Badge variant="outline">{modeLabel(task)}</Badge></span>;
  const label = 'font-medium';
  // В подвале одна главная кнопка — следующий шаг по заданию; отмена задания — тихая красная слева.
  return <PanelUX.Modal title={title} wide busy={busy || calling} onClose={onClose} footer={<>
    {!voice && ['queued', 'in_progress', 'ready', 'delivery_error'].includes(task.status) && <Button type="button" variant="ghost" className="me-auto text-destructive hover:text-destructive" disabled={busy} onClick={() => action('cancel')}>Отменить задание</Button>}
    <Button type="button" variant="outline" disabled={busy || calling} onClick={onClose}>Закрыть</Button>
    {callDone && <Button type="button" variant="outline" disabled={busy || !note.trim()} onClick={() => action('call_note')}>Дополнить итог звонка</Button>}
    {voice && task.status === 'in_progress' && <Button type="button" variant="outline" disabled={busy || calling} onClick={() => action('release')}>Вернуть в очередь</Button>}
    {recordingDone && <Button type="button" variant="outline" disabled={busy || !note.trim()} onClick={() => action('revise')}>На перезапись</Button>}
    {voice && task.status === 'queued' && <Button type="button" disabled={busy} onClick={() => action('claim')}>Взять в работу</Button>}
    {voice && task.status === 'in_progress' && task.kind === 'call' && <Button type="button" disabled={busy || calling || !note.trim()} onClick={() => action('complete')}>Сохранить итог звонка</Button>}
    {voice && task.status === 'in_progress' && task.kind === 'voice' && bot.username && <Button asChild><a href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />Записать в Telegram</a></Button>}
    {!voice && task.status === 'delivery_error' && <Button type="button" disabled={busy} onClick={() => action('retry_delivery')}>Повторить отправку</Button>}
  </>}>
    <div className="flex min-h-[200px] flex-col gap-3 text-sm">
      <p className={cn(caption, 'leading-5 [overflow-wrap:anywhere]')}>{task.personaName} · {task.contactLabel}<br />Менеджер: {task.managerName} · Войсер: {task.voicerName}</p>
      {task.voiceMode === 'once' && <DeliveryStatus delivery={task.delivery} /> }
      {task.source === 'bot' && <Alert role="note"><AlertDescription>Заявка создана ботом по ситуации в диалоге. После записи голосовое отправится автоматически.{task.autoExpiresAt && ` Актуально до ${date(task.autoExpiresAt)}.`}</AlertDescription></Alert>}
      {voice && task.kind === 'call' && <CallPanel task={task} onActive={setCalling} />}
      {task.kind === 'call' && <CallBrief task={task} />}
      {task.contactRef && <p className={prose}><strong className={label}>Контакт:</strong> {task.contactRef}</p>}
      {canReadChat && <Tabs value={view} onValueChange={setView} className="gap-0">
        <TabsList className="h-8" aria-label="Задание и переписка">
          <TabsTrigger value="brief" onClick={() => setView('brief')}>Задание и биография</TabsTrigger>
          <TabsTrigger value="chat" onClick={() => setView('chat')}>Переписка</TabsTrigger>
        </TabsList>
      </Tabs>}
      {canReadChat && view === 'chat' ? <TaskChat key={`${task.id}-${task.chatId}`} task={task} /> : <>
      {task.dueAt && <p className={prose}><strong className={label}>Желаемое время:</strong> {date(task.dueAt)} (МСК)</p>}
      {task.script && <p className={prose}><strong className={label}>Текст:</strong><br />{task.script}</p>}
      {task.emotion && <p className={prose}><strong className={label}>Эмоциональность:</strong> {task.emotion}</p>}
      {task.tempo && <p className={prose}><strong className={label}>Темп:</strong> {task.tempo}</p>}
      {task.instructions && <p className={prose}><strong className={label}>Тема и указания:</strong><br />{task.instructions}</p>}
      {task.feedback && <p className={cn(prose, 'flex items-start gap-1.5')}><Dot className="mt-2" /><span><strong className={label}>На перезапись:</strong> {task.feedback}</span></p>}
      {task.outcome && <p className={prose}><strong className={label}>Результат:</strong> {task.outcome}</p>}
      {task.call?.note && <p className={prose}><strong className={label}>Важное из звонка:</strong> {task.call.note}</p>}
      <details><summary className="cursor-pointer py-1 text-primary">Полная карточка личности</summary><p className={caption}>Снимок при создании задания. Неуказанные факты требуют уточнения.</p><pre className="my-2 max-h-[45vh] overflow-y-auto font-sans text-sm leading-7 whitespace-pre-wrap [overflow-wrap:anywhere] [scrollbar-gutter:stable]">{task.biography}</pre></details>
      {task.chatId && !voice && <Button asChild variant="outline" size="sm" className="self-start"><Link to={`/conversation/${task.chatId}`}>Открыть диалог менеджера</Link></Button>}
      </>}
      {!task.chatId && !voice && task.status === 'queued' && <div className="flex min-w-0 flex-col gap-2.5">
        <TaskChatSelect managerId={task.managerId} persona={task.personaSlug} value={linkId} onChange={setLinkId} disabled={busy} />
        <Button type="button" variant="outline" className="self-start" disabled={busy || !linkId} onClick={linkChat}>Привязать диалог</Button>
      </div>}
      {recordingDone && <p className={caption}>Запись доступна во вкладке «Библиотека».</p>}
      {(recordingDone || (voice && task.kind === 'call' && task.status === 'in_progress') || callDone) && <Field label={task.kind === 'call' ? callDone ? 'Важное из звонка (необязательно, для памяти бота)' : 'Если звонка не было — укажите причину' : 'Что изменить при перезаписи'}><Textarea className={textareaClass} rows={4} value={note} onChange={e => setNote(e.target.value)} disabled={busy} maxLength={2000} /></Field>}
      <div className={errorSlot}>{error && <p role="alert">{error}</p>}</div>
    </div>
  </PanelUX.Modal>;
}

/** Переименование записи — окно, а не форма внутри карточки: сетка под ним не сдвигается. */
function RenameRecording({ item, onClose, onChange }) {
  const [title, setTitle] = useState(item.title), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (lock.current || !title.trim()) return;
    lock.current = true; setBusy(true); setError('');
    try { await api.put(`/api/voicer/recordings/${item.id}`, { title }); onChange(); onClose(); }
    catch (e) { setError(errorText(e)); lock.current = false; setBusy(false); }
  }
  return <PanelUX.Modal title="Переименовать запись" busy={busy} onClose={onClose} footer={<>
    <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Отмена</Button>
    <Button type="submit" form="recording-rename" disabled={busy || !title.trim()}>Сохранить</Button>
  </>}>
    <form id="recording-rename" onSubmit={submit}>
      <Field label="Название записи" error={error && <span role="alert">{error}</span>}><Input data-autofocus value={title} onChange={e => setTitle(e.target.value)} disabled={busy} maxLength={160} required /></Field>
    </form>
  </PanelUX.Modal>;
}

function Recording({ item, role, context, onChange, onOpen }) {
  const [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const alive = useRef(true), actionLock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function perform(fn) {
    if (actionLock.current) return; actionLock.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { if (alive.current) setError(errorText(e)); }
    finally { actionLock.current = false; if (alive.current) setBusy(false); }
  }
  async function listen() { const blob = await audioBlob(item.id); if (alive.current) setUrl(URL.createObjectURL(blob)); }
  async function download() {
    const fileUrl = URL.createObjectURL(await audioBlob(item.id)); const a = document.createElement('a');
    a.href = fileUrl; a.download = filename(item.title); a.click(); setTimeout(() => URL.revokeObjectURL(fileUrl), 10000);
  }
  const [sending, setSending] = useState(false);
  return <article className={cardClass}>
    <div className="flex items-start justify-between gap-2"><h3 className="text-sm leading-5 font-medium">{item.title}</h3><Badge variant={item.current ? 'success' : 'outline'}>{item.current ? 'Актуальная' : 'Предыдущая'}</Badge></div>
    <p className={cn(caption, 'leading-5')}>{item.task.personaName} · {item.task.contactLabel}<br />{item.task.managerName} → {item.task.voicerName}<br /><span className="tabular-nums">{date(item.createdAt)} · {item.duration} сек. · Версия {item.revision}</span></p>
    {/* Строка плеера занята всегда: до загрузки в ней кнопка той же высоты и с тем же кружком, что у плеера. */}
    <div className="flex h-[42px] items-center">{url ? <VoicePlayer src={url} /> : (
      <button type="button" disabled={busy} className="group flex h-[42px] items-center gap-2.5 rounded-md pr-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50" onClick={() => perform(listen)}>
        <span className="grid size-9 shrink-0 place-items-center rounded-full border bg-background shadow-xs transition-colors group-hover:bg-accent dark:border-input dark:bg-input/30"><Play className="size-4 fill-current" aria-hidden="true" /></span>
        Прослушать
      </button>
    )}</div>
    {item.last_delivery && <DeliveryStatus delivery={item.last_delivery} />}
    <div className={errorSlot}>{error && <p role="alert">{error}</p>}</div>
    <div className="mt-auto flex min-h-8 items-center justify-between gap-2">
      {role !== 'voice' && item.current ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setSending(true)}><Send aria-hidden="true" />Отправить в диалог</Button> : <span />}
      <div className="flex items-center gap-0.5">
        <IconAction icon={Download} label="Скачать" disabled={busy} onClick={() => perform(download)} />
        {role !== 'voice' && <IconAction icon={Pencil} label="Переименовать" disabled={busy} onClick={() => setEditing(true)} />}
        <IconAction icon={FileText} label={`Задание #${item.task.id}`} disabled={busy} onClick={() => onOpen(item.task.id)} />
      </div>
    </div>
    {sending && <SendVoice item={item} initialChat={context.get('chat') || ''} onClose={() => setSending(false)} onChange={onChange} />}
    {editing && <RenameRecording item={item} onClose={() => setEditing(false)} onChange={onChange} />}
  </article>;
}

function TaskCard({ item, onOpen }) {
  return <article className={cardClass}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-h-[22px] flex-wrap items-center gap-1.5"><span className={cn(caption, 'tabular-nums')}>#{item.id} · {modeLabel(item)}</span>{item.source === 'bot' && <Badge variant="secondary">Заявка бота</Badge>}{item.priority > 0 && <Badge variant={item.priority === 2 ? 'destructive' : 'warning'}>{item.priority === 2 ? 'Срочно' : 'Повышенный приоритет'}</Badge>}</div>
      <Badge variant={stateVariant(item.status)}>{states[item.status]}</Badge>
    </div>
    <h3 className="text-sm leading-5 font-medium">{item.title}</h3>
    <p className={cn(caption, 'leading-5')}>{item.personaName} · {item.contactLabel}<br />{item.managerName} → {item.voicerName}</p>
    <p className="line-clamp-3 text-sm leading-relaxed whitespace-pre-wrap">{item.script || item.instructions}</p>
    {(item.emotion || item.tempo) && <p className={cn(caption, 'line-clamp-2')}>{item.emotion && <>Эмоция: {item.emotion}</>}{item.emotion && item.tempo && ' · '}{item.tempo && <>Темп: {item.tempo}</>}</p>}
    {item.feedback && <p className={cn(caption, 'flex items-start gap-1.5')}><Dot className="mt-[5px]" /><span className="line-clamp-2">Перезапись: {item.feedback}</span></p>}
    {item.voiceMode === 'once' && <DeliveryStatus delivery={item.delivery} />}
    <div className="mt-auto flex items-end justify-between gap-3 pt-1">
      <div className={cn(caption, 'min-w-0')}>
        <p className="tabular-nums">{item.dueAt ? `К ${date(item.dueAt)}` : `Создано ${date(item.createdAt)}`}</p>
        <p className="flex min-h-4 items-start gap-1.5">{item.notifyError ? <><Dot className="mt-[5px]" />{item.notifyError}</> : item.notification === 'sent' ? 'Уведомление доставлено в Telegram' : 'Уведомление ожидает отправки'}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => onOpen(item.id)}>Открыть задание</Button>
    </div>
  </article>;
}

/* Скелет — та же карточка с теми же строками: высота совпадает с настоящей без подгонки. */
function SkeletonCard() {
  return <div className={cardClass}>
    <div className="flex min-h-[22px] items-center justify-between gap-2"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-5 w-20" /></div>
    <div className="flex h-5 items-center"><Skeleton className="h-3.5 w-2/3" /></div>
    <div className="flex h-10 flex-col justify-around"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-2/5" /></div>
    <div className="flex flex-col gap-2 pt-1"><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-5/6" /></div>
    <div className="mt-auto flex items-end justify-between gap-3 pt-1"><Skeleton className="h-3 w-32" /><Skeleton className="h-8 w-32" /></div>
  </div>;
}

export default function VoiceWork() {
  const [context, setContext] = useSearchParams();
  const [options, setOptions] = useState(null), [tab, setTab] = useState(context.get('tab') === 'library' ? 'library' : 'tasks');
  const [creating, setCreating] = useState(false), [detail, setDetail] = useState(null);
  const composeRequested = context.get('compose') === '1';
  useEffect(() => {
    if (!composeRequested) return;
    setCreating(true);
    setContext(previous => { const next = new URLSearchParams(previous); next.delete('compose'); return next; }, { replace: true });
  }, [composeRequested, setContext]);
  const [items, setItems] = useState(null), [shown, setShown] = useState(tab), [total, setTotal] = useState(0), [page, setPage] = useState(1), [status, setStatus] = useState('active');
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const sequence = useRef(0), shownRef = useRef(shown);
  shownRef.current = shown;
  const [detailError, setDetailError] = useState('');
  useRouteBusy(loading && items === null);
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const params = new URLSearchParams({ q: search, page: String(page), status });
      const [opts, result] = await Promise.all([api.get('/api/voicer/options'), api.get(`/api/voicer/${tab === 'tasks' ? 'tasks' : 'recordings'}?${params}`)]);
      if (current !== sequence.current) return;
      setOptions(opts); setItems(result.items); setShown(tab); setTotal(result.total); setError('');
    } catch (e) {
      if (current !== sequence.current) return;
      setError(errorText(e));
      // Карточки другого раздела нельзя оставлять под новой вкладкой: после неудачи показываем пустое состояние.
      if (shownRef.current !== tab) setItems(null);
    }
    finally { if (current === sequence.current) setLoading(false); }
  }, [tab, page, status, search]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); load(); const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15000); return () => { clearInterval(timer); sequence.current++; }; }, [load]);
  async function open(id) {
    try { setDetail(await api.get(`/api/voicer/tasks/${id}`)); setDetailError(''); }
    catch (e) { setDetailError(errorText(e)); }
  }
  const requestedTask = context.get('task');
  useEffect(() => {
    if (!requestedTask || !options?.role) return;
    let active = true;
    api.get(`/api/voicer/tasks/${encodeURIComponent(requestedTask)}`).then(task => { if (active) { setDetail(task); setDetailError(''); } })
      .catch(e => { if (active) setDetailError(errorText(e)); });
    return () => { active = false; };
  }, [requestedTask, options?.role]);
  function closeDetail() {
    setDetail(null); setDetailError('');
    if (requestedTask) { const next = new URLSearchParams(context); next.delete('task'); next.delete('view'); setContext(next, { replace: true }); }
  }
  const changeTab = next => { if (next === tab) return; setTab(next); setPage(1); setLoading(true); };
  const retry = () => { setLoading(true); load(); };
  const manager = options && options.role !== 'voice';
  const emptyText = shown === 'library' ? 'Записей пока нет. Они появятся после выполнения заданий в Telegram.' : search || status !== 'active' ? 'По выбранным условиям заданий нет.' : 'Очередь пуста. Здесь появятся задания на голосовые и звонки.';
  return <div className="container pb-6">
    <PageHeader title="Войсер" description="Голосовые, звонки и готовые записи">
      {context.get('chat') && options?.role !== 'voice' && <Button asChild variant="outline" size="sm"><Link to={`/conversation/${context.get('chat')}`}>Вернуться в диалог</Link></Button>}
      {!options && <Skeleton className="h-8 w-[146px]" />}
      {manager && <Button type="button" size="sm" onClick={() => setCreating(true)}><Plus aria-hidden="true" />Новое задание</Button>}
    </PageHeader>
    {options?.role === 'voice' && <Alert role="note" className="mb-4"><AlertDescription className="flex w-full flex-row flex-wrap items-center justify-between gap-3 text-foreground"><span>{options.linked ? `Telegram подключён${options.telegram_username ? ': @' + options.telegram_username : ''}` : 'Подключите Telegram, чтобы получать задания и отправлять записи'}</span><VoiceBotLink userId={options.user_id} linked={options.linked} onChange={load} /></AlertDescription></Alert>}
    {options?.bot.error && <Alert variant="warning" className="mb-4" role="status"><AlertDescription>{options.bot.error}</AlertDescription></Alert>}
    {options && !options.bot.configured && <Alert variant="warning" role="note" className="mb-4"><AlertDescription>Бот не настроен. Задания сохраняются, но уведомления пока не отправляются.</AlertDescription></Alert>}
    <div className="mb-4 flex min-h-8 flex-wrap items-center gap-2">
      <Tabs value={tab} onValueChange={changeTab} className="gap-0">
        <TabsList className="h-8" aria-label="Раздел озвучки">
          <TabsTrigger value="tasks" onClick={() => changeTab('tasks')}>Задания</TabsTrigger>
          <TabsTrigger value="library" onClick={() => changeTab('library')}>Библиотека</TabsTrigger>
        </TabsList>
      </Tabs>
      <SearchInput className="max-w-sm flex-[1_1_240px]" aria-label="Поиск заданий и записей" placeholder="Поиск по названию" value={query} onChange={setQuery} />
      {tab === 'tasks' && <NativeSelect className="h-8 w-auto" aria-label="Статус заданий" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="active">Активные</option>{Object.entries(states).filter(([key]) => key !== 'ready').map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="all">Все</option></NativeSelect>}
    </div>
    {error && <Alert variant="destructive" role="alert" className="mb-4"><AlertDescription className="flex w-full flex-row flex-wrap items-center gap-2">{error} <Button type="button" variant="outline" size="sm" disabled={loading} onClick={retry}>Повторить</Button></AlertDescription></Alert>}
    {detailError && <p role="alert" className="mb-3 text-xs text-destructive">{detailError}</p>}
    {items === null ? (loading
      ? <div role="status" className={gridClass} aria-label="Загружаем…"><span className="sr-only">Загружаем…</span>{Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}</div>
      : <div className={gridClass} aria-hidden="true"><div className={cn(cardClass, 'border-dashed bg-transparent')} /></div>)
      : !items.length ? <div className={cn(cardClass, 'items-center justify-center text-center')}><p className={cn(muted, 'max-w-sm leading-relaxed')}>{emptyText}</p></div> : <>
      <div className={cn(gridClass, shown !== tab && 'opacity-60')} aria-busy={loading}>{items.map(item => shown === 'library'
        ? <Recording key={`r${item.id}`} item={item} role={options.role} context={context} onChange={load} onOpen={open} />
        : <TaskCard key={`t${item.id}`} item={item} onOpen={open} />)}</div>
      <Pager className="mt-4" page={page} pageSize={PAGE} total={total} onPage={setPage} label={shown === 'library' ? 'Страницы записей' : 'Страницы заданий'} />
    </>}
    {creating && manager && <CreateTask options={options} context={context} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); changeTab('tasks'); setStatus('active'); load(); }} />}
    {detail && <TaskDetail key={detail.id} task={detail} role={options.role} bot={options.bot} initialView={context.get('view')} onClose={closeDetail} onChange={load} />}
  </div>;
}
