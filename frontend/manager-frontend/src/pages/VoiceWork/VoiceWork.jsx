import { moscowInputTimestamp } from '../../utils/panelTime';
import { CallPanel } from './CallPanel';
import { CallBrief } from './CallBrief';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, ExternalLink, LoaderCircle, Play, Plus, Search, Send } from 'lucide-react';
import Header from '../../components/Header/Header';
import VoicePlayer from '../../components/VoicePlayer/VoicePlayer';
import { api, authHeaders } from '../../api/client';
import { SendVoice, DeliveryStatus } from './SendVoice';
import { PanelUX } from '../../ui/PanelUX';
import { VoiceBotLink } from './VoiceBotLink';
import { TaskChat, TaskChatSelect } from './TaskChat';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
const warn = 'text-sm text-warning-foreground';
const errorLine = 'text-sm text-destructive';
const prose = 'whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]';
const textareaClass = 'min-h-[100px] field-sizing-fixed';
const cardClass = 'min-h-[260px] min-w-0 gap-3 rounded-lg p-5 [overflow-wrap:anywhere]';
const gridClass = 'grid gap-4 pb-6 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))]';

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
    footer={<><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Отмена</Button><Button type="submit" form="voice-task-form" disabled={busy || !manager?.voicer_id}>{busy && <LoaderCircle className="animate-spin" />}{busy ? 'Создаём…' : 'Поставить в очередь'}</Button></>}>
    <form id="voice-task-form" onSubmit={submit} className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-2">
      <Field label="Тип задания"><NativeSelect value={form.kind} onChange={e => set('kind', e.target.value)}><option value="voice">Записать голосовое</option><option value="call">Звонок</option></NativeSelect></Field>
      {form.kind === 'voice' && <Field label="Режим голосового"><NativeSelect value={form.voice_mode} disabled={busy} onChange={e => set('voice_mode', e.target.value)}><option value="library">В библиотеку</option><option value="once">Одноразовое — сразу в диалог</option></NativeSelect></Field>}
      {form.kind === 'voice' && <Alert className="sm:col-span-2"><AlertDescription className="min-h-10">{form.voice_mode === 'once' ? 'После записи войсером голосовое автоматически отправится в выбранный диалог. Дополнительное подтверждение менеджера не требуется.' : 'Запись сохранится в библиотеке. Позже её можно выбрать и отправить в любой доступный вам диалог.'}</AlertDescription></Alert>}
      <Field label="Менеджер"><NativeSelect value={form.manager_id} onChange={e => setForm(old => ({ ...old, manager_id: e.target.value, chat_id: '' }))} required>{options.managers.map(m => <option key={m.id} value={m.id}>{m.username}{m.region ? ` · ${m.region}` : ''}</option>)}</NativeSelect></Field>
      <Alert className="sm:col-span-2"><AlertDescription className="block min-h-5 text-foreground">Войсер: <strong className="font-medium">{manager?.voicer_name || 'не назначен'}</strong>{manager?.voicer_id ? !manager.bot_linked && <span className={cn(warn, 'block')}>Telegram ещё не подключён — задание будет ждать в очереди</span> : <span className={cn(muted, 'block')}>Администратор назначает войсера в разделе «Менеджеры»</span>}</AlertDescription></Alert>
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
      {error && <p className={cn(errorLine, 'sm:col-span-2')} role="alert">{error}</p>}
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
  const title = <span className="flex flex-wrap items-center gap-2"><span className="[overflow-wrap:anywhere]"><span className="font-mono tabular-nums">#{task.id}</span> · {task.title}</span><Badge variant={stateVariant(task.status)}>{states[task.status]}</Badge><Badge variant="outline">{modeLabel(task)}</Badge></span>;
  return <PanelUX.Modal title={title} wide busy={busy || calling} onClose={onClose} footer={<>
    <Button type="button" variant="outline" disabled={busy || calling} onClick={onClose}>Закрыть</Button>
    {callDone && <Button type="button" variant="outline" disabled={busy || !note.trim()} onClick={() => action('call_note')}>Дополнить итог звонка</Button>}
    {voice && task.status === 'in_progress' && <Button type="button" variant="outline" disabled={busy || calling} onClick={() => action('release')}>Вернуть в очередь</Button>}
    {recordingDone && <Button type="button" variant="outline" disabled={busy || !note.trim()} onClick={() => action('revise')}>На перезапись</Button>}
    {!voice && ['queued', 'in_progress', 'ready', 'delivery_error'].includes(task.status) && <Button type="button" variant="destructive" disabled={busy} onClick={() => action('cancel')}>Отменить задание</Button>}
    {voice && task.status === 'queued' && <Button type="button" disabled={busy} onClick={() => action('claim')}>Взять в работу</Button>}
    {voice && task.status === 'in_progress' && task.kind === 'call' && <Button type="button" disabled={busy || calling || !note.trim()} onClick={() => action('complete')}>Сохранить итог звонка</Button>}
    {voice && task.status === 'in_progress' && task.kind === 'voice' && bot.username && <Button asChild><a href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer"><ExternalLink />Записать в Telegram</a></Button>}
    {!voice && task.status === 'delivery_error' && <Button type="button" disabled={busy} onClick={() => action('retry_delivery')}>Повторить отправку</Button>}
  </>}>
    <div className="flex min-h-[200px] flex-col gap-3.5 text-sm">
      <p className={prose}>{task.personaName} · {task.contactLabel}<br />Менеджер: {task.managerName} · Войсер: {task.voicerName}</p>
      {task.voiceMode === 'once' && <DeliveryStatus delivery={task.delivery} /> }
      {task.source === 'bot' && <Alert><AlertDescription>Заявка создана ботом по ситуации в диалоге. После записи голосовое отправится автоматически.{task.autoExpiresAt && ` Актуально до ${date(task.autoExpiresAt)}.`}</AlertDescription></Alert>}
      {voice && task.kind === 'call' && <CallPanel task={task} onActive={setCalling} />}
      {task.kind === 'call' && <CallBrief task={task} />}
      {task.contactRef && <p className={prose}><strong className="font-medium">Контакт:</strong> {task.contactRef}</p>}
      {canReadChat && <Tabs value={view} onValueChange={setView} className="gap-0">
        <TabsList aria-label="Задание и переписка">
          <TabsTrigger value="brief" onClick={() => setView('brief')}>Задание и биография</TabsTrigger>
          <TabsTrigger value="chat" onClick={() => setView('chat')}>Переписка</TabsTrigger>
        </TabsList>
      </Tabs>}
      {canReadChat && view === 'chat' ? <TaskChat key={`${task.id}-${task.chatId}`} task={task} /> : <>
      {task.dueAt && <p className={prose}><strong className="font-medium">Желаемое время:</strong> {date(task.dueAt)} (МСК)</p>}
      {task.script && <p className={prose}><strong className="font-medium">Текст:</strong><br />{task.script}</p>}
      {task.emotion && <p className={prose}><strong className="font-medium">Эмоциональность:</strong> {task.emotion}</p>}
      {task.tempo && <p className={prose}><strong className="font-medium">Темп:</strong> {task.tempo}</p>}
      {task.instructions && <p className={prose}><strong className="font-medium">Тема и указания:</strong><br />{task.instructions}</p>}
      {task.feedback && <p className={cn(prose, warn)}><strong className="font-medium">На перезапись:</strong> {task.feedback}</p>}
      {task.outcome && <p className={prose}><strong className="font-medium">Результат:</strong> {task.outcome}</p>}
      {task.call?.note && <p className={prose}><strong className="font-medium">Важное из звонка:</strong> {task.call.note}</p>}
      <details><summary className="cursor-pointer py-2 text-primary">Полная карточка личности</summary><p className={caption}>Снимок при создании задания. Неуказанные факты требуют уточнения.</p><pre className="my-2 max-h-[45vh] overflow-y-auto font-sans text-sm leading-7 whitespace-pre-wrap [overflow-wrap:anywhere] [scrollbar-gutter:stable]">{task.biography}</pre></details>
      {task.chatId && !voice && <Button asChild variant="outline" className="self-start"><Link to={`/conversation/${task.chatId}`}>Открыть диалог менеджера</Link></Button>}
      </>}
      {!task.chatId && !voice && task.status === 'queued' && <div className="flex min-w-0 flex-col gap-2.5">
        <TaskChatSelect managerId={task.managerId} persona={task.personaSlug} value={linkId} onChange={setLinkId} disabled={busy} />
        <Button type="button" className="self-start" disabled={busy || !linkId} onClick={linkChat}>Привязать диалог</Button>
      </div>}
      {recordingDone && <p className={caption}>Запись доступна во вкладке «Библиотека».</p>}
      {(recordingDone || (voice && task.kind === 'call' && task.status === 'in_progress') || callDone) && <Field label={task.kind === 'call' ? callDone ? 'Важное из звонка (необязательно, для памяти бота)' : 'Если звонка не было — укажите причину' : 'Что изменить при перезаписи'}><Textarea className={textareaClass} rows={4} value={note} onChange={e => setNote(e.target.value)} disabled={busy} maxLength={2000} /></Field>}
      {error && <p className={errorLine} role="alert">{error}</p>}
    </div>
  </PanelUX.Modal>;
}

function Recording({ item, role, context, onChange, onOpen }) {
  const [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [editing, setEditing] = useState(false), [title, setTitle] = useState(item.title);
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
  return <Card className={cardClass}>
    <div className="flex items-start justify-between gap-2"><h3 className="text-base leading-snug font-medium">{item.title}</h3><Badge variant={item.current ? 'success' : 'outline'}>{item.current ? 'Актуальная' : 'Предыдущая'}</Badge></div>
    <p className={cn(muted, 'leading-relaxed')}>{item.task.personaName} · {item.task.contactLabel}<br />{item.task.managerName} → {item.task.voicerName}<br /><span className="tabular-nums">{date(item.createdAt)} · {item.duration} сек. · Версия {item.revision}</span></p>
    <div className="min-h-[42px]">{url && <VoicePlayer src={url} />}</div>
    {item.last_delivery && <DeliveryStatus delivery={item.last_delivery} />}
    {sending && <SendVoice item={item} initialChat={context.get('chat') || ''} onClose={() => setSending(false)} onChange={onChange} />}
    {editing && <form className="flex flex-col gap-2" onSubmit={e => { e.preventDefault(); perform(async () => { await api.put(`/api/voicer/recordings/${item.id}`, { title }); setEditing(false); onChange(); }); }}>
      <Field label="Название записи"><Input value={title} onChange={e => setTitle(e.target.value)} disabled={busy} maxLength={160} required /></Field>
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy || !title.trim()}>Сохранить</Button><Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>Отмена</Button></div>
    </form>}
    {error && <p className={errorLine} role="alert">{error}</p>}
    <div className="mt-auto flex flex-wrap gap-2 pt-1.5">
      {!url && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => perform(listen)}><Play />Прослушать</Button>}
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => perform(download)}><Download />Скачать</Button>
      {role !== 'voice' && item.current && <Button type="button" size="sm" disabled={busy} onClick={() => setSending(true)}><Send />Отправить в диалог</Button>}
      {role !== 'voice' && <Button type="button" variant="outline" size="sm" disabled={busy} aria-pressed={editing} onClick={() => setEditing(!editing)}>Переименовать</Button>}
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onOpen(item.task.id)}>Задание #{item.task.id}</Button>
    </div>
  </Card>;
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
  const [items, setItems] = useState(null), [total, setTotal] = useState(0), [page, setPage] = useState(1), [status, setStatus] = useState('active');
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const [detailError, setDetailError] = useState('');
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const params = new URLSearchParams({ q: search, page: String(page), status });
      const [opts, result] = await Promise.all([api.get('/api/voicer/options'), api.get(`/api/voicer/${tab === 'tasks' ? 'tasks' : 'recordings'}?${params}`)]);
      if (current !== sequence.current) return;
      setOptions(opts); setItems(result.items); setTotal(result.total); setError('');
    } catch (e) { if (current === sequence.current) setError(errorText(e)); }
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
  const changeTab = next => { if (next === tab) return; setTab(next); setPage(1); setItems(null); setLoading(true); };
  const manager = options && options.role !== 'voice';
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const emptyText = tab === 'library' ? 'Записей пока нет. Они появятся после выполнения заданий в Telegram.' : search || status !== 'active' ? 'По выбранным условиям заданий нет.' : 'Очередь пуста. Здесь появятся задания на голосовые и звонки.';
  return <div className="app"><Header /><main className="main"><div className="container">
    <div className="my-6 flex min-w-0 flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Войсер</h2><p className={muted}>Голосовые, звонки и готовые записи</p></div><div className="flex min-h-9 flex-wrap items-center gap-2">
      {context.get('chat') && options?.role !== 'voice' && <Button asChild variant="outline"><Link to={`/conversation/${context.get('chat')}`}>Вернуться в диалог</Link></Button>}
      {!options && <Skeleton className="h-9 w-[148px]" />}
      {manager && <Button type="button" onClick={() => setCreating(true)}><Plus />Новое задание</Button>}
    </div></div>
    {options?.role === 'voice' && <Alert className="mb-4 min-h-[52px]"><AlertDescription className="flex w-full flex-row flex-wrap items-center justify-between gap-3 text-foreground"><span>{options.linked ? `Telegram подключён${options.telegram_username ? ': @' + options.telegram_username : ''}` : 'Подключите Telegram, чтобы получать задания и отправлять записи'}</span><VoiceBotLink userId={options.user_id} linked={options.linked} onChange={load} /></AlertDescription></Alert>}
    {options?.bot.error && <Alert variant="warning" className="mb-4 min-h-10" role="status"><AlertDescription>{options.bot.error}</AlertDescription></Alert>}
    {options && !options.bot.configured && <Alert variant="warning" className="mb-4 min-h-10"><AlertDescription>Бот не настроен. Задания сохраняются, но уведомления пока не отправляются.</AlertDescription></Alert>}
    <div className="my-4 flex flex-wrap items-center gap-2">
      <Tabs value={tab} onValueChange={changeTab} className="gap-0">
        <TabsList className="h-8" aria-label="Раздел озвучки">
          <TabsTrigger value="tasks" onClick={() => changeTab('tasks')}>Задания</TabsTrigger>
          <TabsTrigger value="library" onClick={() => changeTab('library')}>Библиотека</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="relative min-w-0 flex-[1_1_240px]"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input className="h-8 pl-8" type="search" aria-label="Поиск заданий и записей" placeholder="Поиск по названию" value={query} onChange={e => setQuery(e.target.value)} /></div>
      {tab === 'tasks' && <NativeSelect className="h-8 w-auto" aria-label="Статус заданий" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="active">Активные</option>{Object.entries(states).filter(([key]) => key !== 'ready').map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="all">Все</option></NativeSelect>}
    </div>
    {error && <Alert variant="destructive" role="alert" className="mb-4"><AlertDescription className="flex w-full flex-row flex-wrap items-center gap-2">{error} <Button type="button" variant="outline" size="sm" onClick={load}>Повторить</Button></AlertDescription></Alert>}
    {detailError && <p role="alert" className={cn(errorLine, 'mb-4')}>{detailError}</p>}
    {items === null ? <div role="status" className={gridClass} aria-label="Загружаем…"><span className="sr-only">Загружаем…</span>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="min-h-[260px] rounded-lg" />)}</div>
      : !items.length ? <Card className={cn(cardClass, 'items-center justify-center px-6 py-10 text-center', muted)}><p className="leading-relaxed">{emptyText}</p>{manager && tab === 'tasks' && <Button type="button" onClick={() => setCreating(true)}><Plus />Новое задание</Button>}</Card> : <>
      <p className={cn(caption, 'mb-3 min-h-4')}>Найдено: <span className="tabular-nums">{total}</span>. {tab === 'tasks' && 'Порядок: приоритет, затем время создания.'}</p>
      <div className={gridClass} aria-busy={loading}>{items.map(item => tab === 'library' ? <Recording key={item.id} item={item} role={options.role} context={context} onChange={load} onOpen={open} /> : <Card key={item.id} className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-1.5"><Badge variant="outline" className="tabular-nums">#{item.id} · {modeLabel(item)}</Badge>{item.source === 'bot' && <Badge variant="secondary">Заявка бота</Badge>}{item.priority > 0 && <Badge variant={item.priority === 2 ? 'destructive' : 'warning'}>{item.priority === 2 ? 'Срочно' : 'Повышенный приоритет'}</Badge>}</div><Badge variant={stateVariant(item.status)}>{states[item.status]}</Badge></div>
        <h3 className="text-base leading-snug font-medium">{item.title}</h3><p className={cn(muted, 'leading-relaxed')}>{item.personaName} · {item.contactLabel}<br />{item.managerName} → {item.voicerName}</p>
        <p className="line-clamp-3 text-sm leading-relaxed whitespace-pre-wrap">{item.script || item.instructions}</p>
        {item.emotion && <p className="text-sm">Эмоция: {item.emotion}</p>}{item.tempo && <p className="text-sm">Темп: {item.tempo}</p>}
        {item.feedback && <p className={warn}>Перезапись: {item.feedback}</p>}
        <p className={cn(muted, 'min-h-5 tabular-nums')}>{item.dueAt ? `К ${date(item.dueAt)}` : `Создано ${date(item.createdAt)}`}</p>
        {item.voiceMode === 'once' && <DeliveryStatus delivery={item.delivery} />}
        {item.notifyError ? <p className={cn(warn, 'min-h-5')}>{item.notifyError}</p> : <p className={cn(muted, 'min-h-5')}>{item.notification === 'sent' ? 'Уведомление доставлено в Telegram' : 'Уведомление ожидает отправки'}</p>}
        <div className="mt-auto flex flex-wrap gap-2 pt-1.5"><Button type="button" size="sm" onClick={() => open(item.id)}>Открыть задание</Button></div>
      </Card>)}</div>
      {pages > 1 && <nav className="mb-6 flex items-center justify-center gap-3" aria-label="Страницы"><Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(n => n - 1)}>Назад</Button><span className={cn(muted, 'min-w-[56px] text-center font-mono tabular-nums')}>{page} / {pages}</span><Button type="button" variant="outline" size="sm" disabled={page * PAGE >= total} onClick={() => setPage(n => n + 1)}>Далее</Button></nav>}
    </>}
    {creating && manager && <CreateTask options={options} context={context} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); changeTab('tasks'); setStatus('active'); load(); }} />}
    {detail && <TaskDetail key={detail.id} task={detail} role={options.role} bot={options.bot} initialView={context.get('view')} onClose={closeDetail} onChange={load} />}
  </div></main></div>;
}
