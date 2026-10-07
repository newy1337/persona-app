import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { api, authHeaders } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import VoicePlayer from '../../components/VoicePlayer/VoicePlayer';
import { IconAction } from '@/components/IconAction/IconAction';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const muted = 'text-xs text-muted-foreground';
const errorLine = 'text-xs text-destructive';

export function TaskChatSelect({ managerId, persona, value, onChange, disabled, required = false, warnMissing = true, sendTarget = false, showChatAccess = true }) {
  const [query, setQuery] = useState(''), [data, setData] = useState({ items: [] }), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setData({ items: [] });
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ manager_id: String(managerId), persona, q: query });
      api.get(`/api/voicer/${sendTarget ? 'send-targets' : 'conversations'}?${params}`).then(result => { if (active) setData(result); })
        .catch(e => { if (active) setError(PanelUX.readableError(e)); }).finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [managerId, persona, query, sendTarget]);
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2">
    <Field label="Поиск диалога"><Input placeholder="Имя, Telegram или ID" value={query} onChange={e => setQuery(e.target.value)} disabled={disabled} /></Field>
    <Field label={sendTarget ? 'Получатель' : required ? 'Диалог для автоматической отправки' : 'Переписка для войсера'}><NativeSelect required={required} disabled={disabled} aria-busy={loading} value={value}
      onChange={e => onChange(e.target.value, data.items.find(item => item.chat_id === e.target.value))}>
      <option value="">{required ? 'Выберите диалог' : 'Без привязанного диалога'}</option>
      {value && !data.items.some(item => item.chat_id === value) && <option value={value}>Диалог {value}</option>}
      {data.items.map(item => <option key={item.chat_id} value={item.chat_id}>{item.label} · {item.chat_id}{sendTarget && item.persona_name ? ` · ${item.persona_name}` : ''}{!sendTarget && item.unassigned ? ' · без менеджера' : ''}</option>)}
    </NativeSelect></Field>
    {/* Одна строка подсказки на оба поля, вплотную к ним (6px, как сообщение у Field); место занято всегда. */}
    <p className={cn(muted, '-mt-1.5 min-h-4 sm:col-span-2')}>{loading ? 'Ищем диалоги…' : data.more ? 'Показаны 40 диалогов. Уточните поиск.' : !data.items.length ? 'Подходящих диалогов не найдено.' : sendTarget ? 'Выберите получателя и убедитесь, что текст и голос подходят этому диалогу.' : showChatAccess ? 'Войсер сможет читать выбранную переписку, в том числе во время звонка.' : 'Войсер получит текст и эмоциональность. Переписка при записи голосового ему недоступна.'}</p>
    {!value && warnMissing && !sendTarget && <p className={cn(muted, 'flex items-center gap-1.5 sm:col-span-2')}><span className="size-1.5 shrink-0 rounded-full bg-warning-foreground" aria-hidden="true" />Без привязки войсер получит задание, но не увидит переписку.</p>}
    {!sendTarget && data.items.find(item => item.chat_id === value)?.unassigned && <p className={cn(muted, 'sm:col-span-2')}>Аккаунт не закреплён за менеджером. При создании задания доступ к этой переписке получит выбранный менеджер; войсер — только для звонка. Остальные диалоги аккаунта останутся закрыты.</p>}
    {error && <p className={cn(errorLine, 'sm:col-span-2')} role="alert">{error}</p>}
  </div>;
}

function Attachment({ taskId, message }) {
  const [file, setFile] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), locked = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);
  async function load() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/voicer/tasks/${taskId}/conversation/files/${message.id}`, { headers: authHeaders() });
      if (!response.ok) throw new Error('Вложение недоступно. Обновите переписку или уточните у менеджера');
      const blob = await response.blob();
      if (alive.current) setFile({ url: URL.createObjectURL(blob), type: blob.type });
    } catch (e) { if (alive.current) setError(PanelUX.readableError(e)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  const labels = { voice: 'Голосовое', audio: 'Аудио', photo: 'Фото', video: 'Видео', video_note: 'Видеосообщение', animation: 'Анимация', sticker: 'Стикер', document: 'Файл' };
  return <div className="mt-2 min-w-0">
    {!file && <Button type="button" variant="outline" size="xs" disabled={busy} onClick={load}>{busy ? 'Загружаем…' : `${labels[message.mediaKind] || 'Вложение'} · открыть`}</Button>}
    {file && (/^image\/(jpeg|png|gif|webp)$/.test(file.type) ? <div className="aspect-video w-full max-w-[320px] overflow-hidden rounded-md bg-muted"><img className="size-full object-contain" src={file.url} alt="Вложение в переписке" /></div> :
      file.type.startsWith('audio/') ? <VoicePlayer src={file.url} /> : file.type.startsWith('video/') ? <div className="aspect-video w-full max-w-[320px] overflow-hidden rounded-md bg-muted"><video className="size-full object-contain" controls playsInline src={file.url} /></div> :
        <Button asChild variant="outline" size="xs"><a href={file.url} download={`attachment-${message.id}`}><Download aria-hidden="true" />Скачать файл</a></Button>)}
    {error && <p className={cn(errorLine, 'mt-1')} role="alert">{error}</p>}
  </div>;
}

export function TaskChat({ task }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [before, setBefore] = useState(null), [trail, setTrail] = useState([]);
  const [refresh, setRefresh] = useState(0), [updated, setUpdated] = useState(null), [loading, setLoading] = useState(true);
  const scroller = useRef(null), stick = useRef(true);
  useEffect(() => {
    let active = true, busy = false;
    setLoading(true); setError(''); stick.current = true;
    async function load() {
      if (busy || !active) return;
      busy = true;
      try {
        const result = await api.get(`/api/voicer/tasks/${task.id}/conversation${before ? `?before=${before}` : ''}`);
        if (active) { setData(result); setError(''); setUpdated(new Date()); }
      } catch (e) {
        if (active) { setError(PanelUX.readableError(e)); if ([401, 403, 404].includes(e.status)) setData(null); }
      } finally { busy = false; if (active) setLoading(false); }
    }
    load();
    const visible = () => { if (document.visibilityState === 'visible') load(); };
    const timer = setInterval(visible, 5000);
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [task.id, task.chatId, task.status, before, refresh]);
  useEffect(() => { if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [data]);
  if (!task.chatId) return <Alert role="note"><AlertDescription>Диалог не привязан к заданию. Попросите менеджера выбрать переписку в карточке задания.</AlertDescription></Alert>;
  const scrollerClass = 'flex h-[42vh] min-h-[220px] flex-col gap-3 overflow-y-auto py-1 pr-2 pl-0.5 [overscroll-behavior:contain] [scrollbar-gutter:stable]';
  return <section className="flex min-w-0 flex-col gap-3" aria-label="Переписка по заданию">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-sm font-medium">Переписка · {task.contactLabel}</strong><p className={cn(muted, 'min-h-4 tabular-nums')}>Только просмотр · обновление каждые 5 секунд{updated && ` · ${updated.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })}`}</p></div>
      <div className="flex flex-wrap items-center gap-1">
        <Button type="button" variant="outline" disabled={loading || !data?.next_before} onClick={() => { setTrail(old => [...old, before]); setBefore(data.next_before); }}>Ранние сообщения</Button>
        <Button type="button" variant="outline" disabled={loading || !before} onClick={() => { setBefore(trail[trail.length - 1] ?? null); setTrail(old => old.slice(0, -1)); }}>Новые сообщения</Button>
        <Button type="button" variant="outline" disabled={!before} onClick={() => { setBefore(null); setTrail([]); }}>К последним</Button>
        <IconAction icon={RefreshCw} label="Обновить" disabled={loading} onClick={() => setRefresh(n => n + 1)} />
      </div></div>
    {error && <p className={errorLine} role="alert">{error}{data && ' Показаны ранее загруженные сообщения.'}</p>}
    {!data && <div className={scrollerClass} aria-busy={loading} {...(loading ? { role: 'status', 'aria-label': 'Загружаем переписку…' } : {})}>
      {loading && <><span className="sr-only">Загружаем переписку…</span><Skeleton className="h-14 w-3/5 rounded-lg" /><Skeleton className="h-14 w-1/2 self-end rounded-lg" /><Skeleton className="h-14 w-2/3 rounded-lg" /></>}
    </div>}
    {data && <div className={scrollerClass} aria-busy={loading} ref={scroller} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {!data.items.length && <p className={muted}>В этом диалоге пока нет сообщений.</p>}
      {data.items.map(m => <article key={m.id} className={cn('w-fit max-w-[95%] shrink-0 rounded-lg border bg-card p-3 text-sm text-card-foreground [overflow-wrap:anywhere] sm:max-w-[88%]', m.role !== 'user' && 'self-end border-transparent bg-muted')}>
        <div className={cn(muted, 'mb-1.5 flex flex-wrap gap-x-3.5 gap-y-1')}><strong className="font-medium">{m.role === 'user' ? task.contactLabel : m.author?.startsWith('operator:') ? 'Менеджер' : `Бот · ${task.personaName}`}</strong>
          <time className="tabular-nums" dateTime={new Date(m.ts * 1000).toISOString()}>{new Date(m.ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' })}</time></div>
        {m.deletedAt ? <p className={muted}>Сообщение удалено</p> : <>{m.text && <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>}{m.has_file && <Attachment taskId={task.id} message={m} />}{!m.has_file && m.mediaKind && !m.text && <p className={muted}>Вложение не сохранено</p>}{m.editedAt && <span className={muted}>Изменено</span>}</>}
        {m.reaction && <span aria-label="Реакция">{m.reaction}</span>}
      </article>)}
    </div>}
    <p className={muted}>Время сообщений — МСК (UTC+3)</p>
  </section>;
}
