import { moscowInputTimestamp } from '../../utils/panelTime';
import { CallPanel } from './CallPanel';
import { CallBrief } from './CallBrief';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Header from '../../components/Header/Header';
import VoicePlayer from '../../components/VoicePlayer/VoicePlayer';
import { api, authHeaders } from '../../api/client';
import { SendVoice, DeliveryStatus } from './SendVoice';
import { PanelUX } from '../../ui/PanelUX';
import { VoiceBotLink } from './VoiceBotLink';
import { TaskChat, TaskChatSelect } from './TaskChat';
import s from '../../styles/AdminPage.module.scss';
import v from './VoiceWork.module.scss';

const states = { queued: 'В очереди', in_progress: 'В работе', ready: 'Выполнено', completed: 'Выполнено', cancelled: 'Отменено', delivering: 'Отправляется', sent: 'Отправлено', delivery_error: 'Ошибка отправки', delivery_review: 'Проверить доставку', delivery_closed: 'Проверка закрыта' };
const stateClass = status => status === 'delivery_error' ? s.badgeBanned : status === 'delivery_review' ? s.badgePaused : ['ready', 'completed', 'sent'].includes(status) ? s.badgeActive : v.tag;
const modeLabel = task => task.kind === 'call' ? 'Звонок' : task.voiceMode === 'once' ? 'Одноразовое' : 'В библиотеку';
const errorText = e => PanelUX.readableError(e);
const date = seconds => new Date(seconds * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });
const filename = title => title.replace(/[\\/:*?"<>|]/g, '_') + '.ogg';

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
  const field = (key, label, props = {}) => <label className={`${s.label} ${props.full ? v.full : ''}`}>{label}<input className={s.field} value={form[key]} onChange={e => set(key, e.target.value)} disabled={busy} {...Object.fromEntries(Object.entries(props).filter(([k]) => k !== 'full'))} /></label>;
  return <PanelUX.Modal title="Новое задание войсеру" wide busy={busy} onClose={onClose}
    footer={<><button className={s.btn} disabled={busy} onClick={onClose}>Отмена</button><button className={s.btnPrimary} type="submit" form="voice-task-form" disabled={busy || !manager?.voicer_id}>{busy ? 'Создаём…' : 'Поставить в очередь'}</button></>}>
    <form id="voice-task-form" onSubmit={submit} className={v.form}>
      <label className={s.label}>Тип задания<select className={s.select} value={form.kind} onChange={e => set('kind', e.target.value)}><option value="voice">Записать голосовое</option><option value="call">Звонок</option></select></label>
      {form.kind === 'voice' && <label className={s.label}>Режим голосового<select className={s.select} value={form.voice_mode} disabled={busy} onChange={e => set('voice_mode', e.target.value)}><option value="library">В библиотеку</option><option value="once">Одноразовое — сразу в диалог</option></select></label>}
      {form.kind === 'voice' && <p className={`${v.notice} ${v.full}`} style={{ margin: 0 }}>{form.voice_mode === 'once' ? 'После записи войсером голосовое автоматически отправится в выбранный диалог. Дополнительное подтверждение менеджера не требуется.' : 'Запись сохранится в библиотеке. Позже её можно выбрать и отправить в любой доступный вам диалог.'}</p>}
      <label className={s.label}>Менеджер<select className={s.select} value={form.manager_id} onChange={e => setForm(old => ({ ...old, manager_id: e.target.value, chat_id: '' }))} required>{options.managers.map(m => <option key={m.id} value={m.id}>{m.username}{m.region ? ` · ${m.region}` : ''}</option>)}</select></label>
      <div className={`${v.notice} ${v.full}`} style={{ margin: 0 }}>Войсер: <strong>{manager?.voicer_name || 'не назначен'}</strong>{manager?.voicer_id ? !manager.bot_linked && <span className={v.warning}>Telegram ещё не подключён — задание будет ждать в очереди</span> : <span>Администратор назначает войсера в разделе «Менеджеры»</span>}</div>
      {field('title', 'Название записи / задания', { required: true, maxLength: 160, placeholder: 'Сообщения для Димы · Доброе утро', full: true })}
      <label className={s.label}>Личность<select className={s.select} value={form.persona_slug} onChange={e => setForm(old => ({ ...old, persona_slug: e.target.value, chat_id: '' }))} required>{options.personas.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></label>
      {field('contact_label', form.kind === 'voice' && form.voice_mode === 'library' ? 'Собеседник (необязательно)' : 'Собеседник', { required: form.kind === 'call', maxLength: 160, placeholder: 'Дима' })}
      {form.kind === 'call' && field('contact_ref', 'Контакт для звонка', { required: form.kind === 'call' && !form.chat_id, maxLength: 200, placeholder: '@username или номер телефона' })}
      <div className={v.full}><TaskChatSelect managerId={form.manager_id} persona={form.persona_slug} value={form.chat_id} disabled={busy} required={form.kind === 'voice' && form.voice_mode === 'once'} warnMissing={form.kind === 'call'} showChatAccess={form.kind === 'call'}
        onChange={(id, item) => setForm(old => ({ ...old, chat_id: id, ...(item ? { contact_label: item.label, contact_ref: item.contact_ref || '' } : {}) }))} /></div>
      {form.kind === 'voice' && <label className={`${s.label} ${v.full}`}>Текст голосового<textarea className={s.field} value={form.script} onChange={e => set('script', e.target.value)} required maxLength={10000} placeholder="Точный текст, который нужно произнести" /></label>}
      {field('emotion', 'Эмоциональность', { required: form.kind === 'voice', maxLength: 500, placeholder: 'Тепло, с улыбкой, спокойно' })}
      {field('tempo', 'Темп разговора', { required: form.kind === 'call', maxLength: 500, placeholder: 'Неспешно, давать собеседнику договорить' })}
      <label className={`${s.label} ${v.full}`}>{form.kind === 'call' ? 'Тема звонка и что нужно сделать' : 'Дополнительные указания'}<textarea className={s.field} value={form.instructions} onChange={e => set('instructions', e.target.value)} maxLength={5000} required={form.kind === 'call'} /></label>
      <label className={s.label}>Приоритет<select className={s.select} value={form.priority} onChange={e => set('priority', e.target.value)}><option value="0">Обычный</option><option value="1">Повышенный</option><option value="2">Срочно</option></select></label>
      {field('due', 'Желаемое время (МСК)', { type: 'datetime-local' })}
      <p className={`${s.hint} ${v.full}`}>{form.kind === 'call' ? 'Войсер получит полную карточку личности, контакт, тему и темп. Войсер звонит с сайта через Telegram-аккаунт выбранного диалога.' : form.voice_mode === 'once' ? 'Получатель фиксируется при создании задания. Для другого диалога нужно новое задание.' : 'Запись сохранится в библиотеке под этим названием. Отправку собеседнику выбирает менеджер.'}</p>
      {error && <p className={`${s.error} ${v.full}`} role="alert">{error}</p>}
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
  return <PanelUX.Modal title={`#${task.id} · ${task.title}`} wide busy={busy || calling} onClose={onClose} footer={<button className={s.btn} disabled={busy || calling} onClick={onClose}>Закрыть</button>}>
    <div className={v.detail}>
      <div className={s.actions}><span className={stateClass(task.status)}>{states[task.status]}</span><span className={v.tag}>{modeLabel(task)}</span></div>
      <p>{task.personaName} · {task.contactLabel}<br />Менеджер: {task.managerName} · Войсер: {task.voicerName}</p>
      {task.voiceMode === 'once' && <DeliveryStatus delivery={task.delivery} /> }
      {task.source === 'bot' && <p className={v.notice}>Заявка создана ботом по ситуации в диалоге. После записи голосовое отправится автоматически.{task.autoExpiresAt && ` Актуально до ${date(task.autoExpiresAt)}.`}</p>}
      {voice && task.kind === 'call' && <CallPanel task={task} onActive={setCalling} />}
      {task.kind === 'call' && <CallBrief task={task} />}
      {task.contactRef && <p><strong>Контакт:</strong> {task.contactRef}</p>}
      {canReadChat && <div className={v.toolbar} role="tablist" aria-label="Задание и переписка">
        <button role="tab" aria-selected={view === 'brief'} className={view === 'brief' ? s.btnPrimary : s.btn} onClick={() => setView('brief')}>Задание и биография</button>
        <button role="tab" aria-selected={view === 'chat'} className={view === 'chat' ? s.btnPrimary : s.btn} onClick={() => setView('chat')}>Переписка</button>
      </div>}
      {canReadChat && view === 'chat' ? <TaskChat key={`${task.id}-${task.chatId}`} task={task} /> : <>
      {task.dueAt && <p><strong>Желаемое время:</strong> {date(task.dueAt)} (МСК)</p>}
      {task.script && <p><strong>Текст:</strong><br />{task.script}</p>}
      {task.emotion && <p><strong>Эмоциональность:</strong> {task.emotion}</p>}
      {task.tempo && <p><strong>Темп:</strong> {task.tempo}</p>}
      {task.instructions && <p><strong>Тема и указания:</strong><br />{task.instructions}</p>}
      {task.feedback && <p className={v.warning}><strong>На перезапись:</strong> {task.feedback}</p>}
      {task.outcome && <p><strong>Результат:</strong> {task.outcome}</p>}
      {task.call?.note && <p><strong>Важное из звонка:</strong> {task.call.note}</p>}
      <details><summary>Полная карточка личности</summary><p className={s.hint}>Снимок при создании задания. Неуказанные факты требуют уточнения.</p><pre className={v.brief}>{task.biography}</pre></details>
      {task.chatId && !voice && <Link className={s.btn} to={`/conversation/${task.chatId}`}>Открыть диалог менеджера</Link>}
      </>}
      {!task.chatId && !voice && task.status === 'queued' && <div className={v.chatSelect}>
        <TaskChatSelect managerId={task.managerId} persona={task.personaSlug} value={linkId} onChange={setLinkId} disabled={busy} />
        <button className={s.btnPrimary} disabled={busy || !linkId} onClick={linkChat}>Привязать диалог</button>
      </div>}
      {!voice && ['ready', 'completed'].includes(task.status) && task.kind === 'voice' && <p className={s.hint}>Запись доступна во вкладке «Библиотека».</p>}
      {((!voice && ['ready', 'completed'].includes(task.status) && task.kind === 'voice') || (voice && task.kind === 'call' && task.status === 'in_progress') || (task.kind === 'call' && task.call?.connectedAt && task.call?.endedAt)) && <label className={s.label}>{task.kind === 'call' ? task.call?.connectedAt && task.call?.endedAt ? 'Важное из звонка (необязательно, для памяти бота)' : 'Если звонка не было — укажите причину' : 'Что изменить при перезаписи'}<textarea className={s.field} value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></label>}
      {error && <p className={s.error} role="alert">{error}</p>}
      <div className={v.actions}>
        {voice && task.status === 'queued' && <button className={s.btnPrimary} disabled={busy} onClick={() => action('claim')}>Взять в работу</button>}
        {voice && task.status === 'in_progress' && task.kind === 'call' && <button className={s.btnPrimary} disabled={busy || calling || !note.trim()} onClick={() => action('complete')}>Сохранить итог звонка</button>}
        {task.kind === 'call' && task.call?.connectedAt && task.call?.endedAt && <button className={s.btn} disabled={busy || !note.trim()} onClick={() => action('call_note')}>Дополнить итог звонка</button>}
        {voice && task.status === 'in_progress' && task.kind === 'voice' && bot.username && <a className={s.btnPrimary} href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer">Записать в Telegram</a>}
        {voice && task.status === 'in_progress' && <button className={s.btn} disabled={busy || calling} onClick={() => action('release')}>Вернуть в очередь</button>}
        {!voice && task.status === 'delivery_error' && <button className={s.btnPrimary} disabled={busy} onClick={() => action('retry_delivery')}>Повторить отправку</button>}
        {!voice && ['ready', 'completed'].includes(task.status) && task.kind === 'voice' && <button className={s.btn} disabled={busy || !note.trim()} onClick={() => action('revise')}>На перезапись</button>}
        {!voice && ['queued', 'in_progress', 'ready', 'delivery_error'].includes(task.status) && <button className={s.btnDanger} disabled={busy} onClick={() => action('cancel')}>Отменить задание</button>}
      </div>
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
  return <article className={v.card}>
    <div className={v.cardTop}><h3>{item.title}</h3><span className={item.current ? s.badgeActive : v.tag}>{item.current ? 'Актуальная' : 'Предыдущая'}</span></div>
    <p className={v.meta}>{item.task.personaName} · {item.task.contactLabel}<br />{item.task.managerName} → {item.task.voicerName}<br />{date(item.createdAt)} · {item.duration} сек. · Версия {item.revision}</p>
    {url && <VoicePlayer src={url} />}
    {item.last_delivery && <DeliveryStatus delivery={item.last_delivery} />}
    {sending && <SendVoice item={item} initialChat={context.get('chat') || ''} onClose={() => setSending(false)} onChange={onChange} />}
    {editing && <form onSubmit={e => { e.preventDefault(); perform(async () => { await api.put(`/api/voicer/recordings/${item.id}`, { title }); setEditing(false); onChange(); }); }}>
      <label className={s.label}>Название записи<input className={s.field} value={title} onChange={e => setTitle(e.target.value)} maxLength={160} required /></label>
      <div className={v.actions}><button className={s.btnPrimary} disabled={busy || !title.trim()}>Сохранить</button><button type="button" className={s.btn} onClick={() => setEditing(false)}>Отмена</button></div>
    </form>}
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={v.actions}>
      {!url && <button className={s.btnPrimary} disabled={busy} onClick={() => perform(listen)}>Прослушать</button>}
      <button className={s.btn} disabled={busy} onClick={() => perform(download)}>Скачать</button>
      {role !== 'voice' && item.current && <button className={s.btnPrimary} disabled={busy} onClick={() => setSending(true)}>Отправить в диалог</button>}
      {role !== 'voice' && <button className={s.btnSm} disabled={busy} onClick={() => setEditing(!editing)}>Переименовать</button>}
      <button className={s.btnSm} disabled={busy} onClick={() => onOpen(item.task.id)}>Задание #{item.task.id}</button>
    </div>
  </article>;
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
  const [items, setItems] = useState([]), [total, setTotal] = useState(0), [page, setPage] = useState(1), [status, setStatus] = useState('active');
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
  const changeTab = next => { setTab(next); setPage(1); setItems([]); setLoading(true); };
  return <div className="app"><Header /><main className="main"><div className="container">
    <div className={s.head}><div><h2 className={s.title}>Войсер</h2><p className={v.meta}>Голосовые, звонки и готовые записи</p></div><div className={s.actions}>
      {context.get('chat') && options?.role !== 'voice' && <Link className={s.btn} to={`/conversation/${context.get('chat')}`}>Вернуться в диалог</Link>}
      {options && options.role !== 'voice' && <button className={s.btnPrimary} onClick={() => setCreating(true)}>Новое задание</button>}
    </div></div>
    {options?.role === 'voice' && <div className={v.notice}><span>{options.linked ? `Telegram подключён${options.telegram_username ? ': @' + options.telegram_username : ''}` : 'Подключите Telegram, чтобы получать задания и отправлять записи'}</span><VoiceBotLink userId={options.user_id} linked={options.linked} onChange={load} /></div>}
    {options?.bot.error && <p className={v.warning} role="status">{options.bot.error}</p>}
    {options && !options.bot.configured && <p className={v.warning}>Бот не настроен. Задания сохраняются, но уведомления пока не отправляются.</p>}
    <div className={v.toolbar} role="group" aria-label="Раздел озвучки">
      <button className={`${s.btn} ${tab === 'tasks' ? s.btnSelected : ''}`} aria-pressed={tab === 'tasks'} onClick={() => changeTab('tasks')}>Задания</button>
      <button className={`${s.btn} ${tab === 'library' ? s.btnSelected : ''}`} aria-pressed={tab === 'library'} onClick={() => changeTab('library')}>Библиотека</button>
      <input className={s.field} type="search" aria-label="Поиск заданий и записей" placeholder="Поиск по названию" value={query} onChange={e => setQuery(e.target.value)} />
      {tab === 'tasks' && <select className={s.select} aria-label="Статус заданий" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="active">Активные</option>{Object.entries(states).filter(([key]) => key !== 'ready').map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="all">Все</option></select>}
    </div>
    {error && <div role="alert" className={s.error}>{error} <button className={s.btnSm} onClick={load}>Повторить</button></div>}
    {detailError && <p role="alert" className={s.error}>{detailError}</p>}
    {loading ? <p role="status" className={v.meta}>Загружаем…</p> : !items.length ? <div className={v.empty}>{tab === 'library' ? 'Записей пока нет. Они появятся после выполнения заданий в Telegram.' : search || status !== 'active' ? 'По выбранным условиям заданий нет.' : 'Очередь пуста. Здесь появятся задания на голосовые и звонки.'}</div> : <>
      <p className={v.meta}>Найдено: {total}. {tab === 'tasks' && 'Порядок: приоритет, затем время создания.'}</p>
      <div className={v.grid}>{items.map(item => tab === 'library' ? <Recording key={item.id} item={item} role={options.role} context={context} onChange={load} onOpen={open} /> : <article key={item.id} className={v.card}>
        <div className={v.cardTop}><span className={v.tag}>#{item.id} · {modeLabel(item)}</span><span className={stateClass(item.status)}>{states[item.status]}</span></div>
        {item.source === 'bot' && <span className={v.tag}>Заявка бота</span>}
        <h3>{item.title}</h3><p className={v.meta}>{item.personaName} · {item.contactLabel}<br />{item.managerName} → {item.voicerName}</p>
        <p className={v.preview}>{item.script || item.instructions}</p>
        {item.emotion && <p>Эмоция: {item.emotion}</p>}{item.tempo && <p>Темп: {item.tempo}</p>}
        {item.feedback && <p className={v.warning}>Перезапись: {item.feedback}</p>}
        {item.priority > 0 && <span className={v.warning}>{item.priority === 2 ? 'Срочно' : 'Повышенный приоритет'}</span>}
        <p className={v.meta}>{item.dueAt ? `К ${date(item.dueAt)}` : `Создано ${date(item.createdAt)}`}</p>
        {item.voiceMode === 'once' && <DeliveryStatus delivery={item.delivery} />}
        {item.notifyError ? <p className={v.warning}>{item.notifyError}</p> : <p className={v.meta}>{item.notification === 'sent' ? 'Уведомление доставлено в Telegram' : 'Уведомление ожидает отправки'}</p>}
        <div className={v.actions}><button className={s.btnPrimary} onClick={() => open(item.id)}>Открыть задание</button></div>
      </article>)}</div>
      <div className={v.pager}><button className={s.btn} disabled={page === 1} onClick={() => setPage(n => n - 1)}>Назад</button><span>{page} / {Math.max(1, Math.ceil(total / 40))}</span><button className={s.btn} disabled={page * 40 >= total} onClick={() => setPage(n => n + 1)}>Далее</button></div>
    </>}
    {creating && options && options.role !== 'voice' && <CreateTask options={options} context={context} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); changeTab('tasks'); setStatus('active'); load(); }} />}
    {detail && <TaskDetail key={detail.id} task={detail} role={options.role} bot={options.bot} initialView={context.get('view')} onClose={closeDetail} onChange={load} />}
  </div></main></div>;
}
