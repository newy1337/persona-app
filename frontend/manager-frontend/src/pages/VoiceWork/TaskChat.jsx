import { useEffect, useRef, useState } from 'react';
import { api, authHeaders } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import VoicePlayer from '../../components/VoicePlayer/VoicePlayer';
import s from '../../styles/AdminPage.module.scss';
import v from './VoiceWork.module.scss';

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
  return <div className={v.chatSelect}>
    <label className={s.label}>Поиск диалога<input className={s.field} placeholder="Имя, Telegram или ID" value={query} onChange={e => setQuery(e.target.value)} disabled={disabled} /></label>
    <label className={s.label}>{sendTarget ? 'Получатель' : required ? 'Диалог для автоматической отправки' : 'Переписка для войсера'}<select required={required} className={s.select} disabled={disabled || loading} value={value}
      onChange={e => onChange(e.target.value, data.items.find(item => item.chat_id === e.target.value))}>
      <option value="">{required ? 'Выберите диалог' : 'Без привязанного диалога'}</option>
      {value && !data.items.some(item => item.chat_id === value) && <option value={value}>Диалог {value}</option>}
      {data.items.map(item => <option key={item.chat_id} value={item.chat_id}>{item.label} · {item.chat_id}{sendTarget && item.persona_name ? ` · ${item.persona_name}` : ''}{!sendTarget && item.unassigned ? ' · без менеджера' : ''}</option>)}
    </select></label>
    <p className={v.meta}>{loading ? 'Ищем диалоги…' : data.more ? 'Показаны 40 диалогов. Уточните поиск.' : !data.items.length ? 'Подходящих диалогов не найдено.' : sendTarget ? 'Выберите получателя и убедитесь, что текст и голос подходят этому диалогу.' : showChatAccess ? 'Войсер сможет читать выбранную переписку, в том числе во время звонка.' : 'Войсер получит текст и эмоциональность. Переписка при записи голосового ему недоступна.'}</p>
    {!value && warnMissing && !sendTarget && <p className={v.warning}>Без привязки войсер получит задание, но не увидит переписку.</p>}
    {!sendTarget && data.items.find(item => item.chat_id === value)?.unassigned && <p className={v.meta}>Аккаунт не закреплён за менеджером. При создании задания доступ к этой переписке получит выбранный менеджер; войсер — только для звонка. Остальные диалоги аккаунта останутся закрыты.</p>}
    {error && <p className={s.error} role="alert">{error}</p>}
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
  return <div className={v.attachment}>
    {!file && <button className={s.btnSm} disabled={busy} onClick={load}>{busy ? 'Загружаем…' : `${labels[message.mediaKind] || 'Вложение'} · открыть`}</button>}
    {file && (/^image\/(jpeg|png|gif|webp)$/.test(file.type) ? <img src={file.url} alt="Вложение в переписке" /> :
      file.type.startsWith('audio/') ? <VoicePlayer src={file.url} /> : file.type.startsWith('video/') ? <video controls playsInline src={file.url} /> :
        <a className={s.btnSm} href={file.url} download={`attachment-${message.id}`}>Скачать файл</a>)}
    {error && <p className={s.error} role="alert">{error}</p>}
  </div>;
}

export function TaskChat({ task }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [before, setBefore] = useState(null), [trail, setTrail] = useState([]);
  const [refresh, setRefresh] = useState(0), [updated, setUpdated] = useState(null), [loading, setLoading] = useState(true);
  const scroller = useRef(null), stick = useRef(true);
  useEffect(() => {
    let active = true, busy = false;
    setData(null); setLoading(true); setError(''); stick.current = true;
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
  if (!task.chatId) return <div className={v.notice}>Диалог не привязан к заданию. Попросите менеджера выбрать переписку в карточке задания.</div>;
  return <section className={v.chat} aria-label="Переписка по заданию">
    <div className={v.chatHeading}><div><strong>Переписка · {task.contactLabel}</strong><p className={v.meta}>Только просмотр · обновление каждые 5 секунд{updated && ` · ${updated.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })}`}</p></div>
      <button className={s.btnSm} disabled={loading} onClick={() => setRefresh(n => n + 1)}>Обновить</button></div>
    <div className={v.actions}>
      <button className={s.btnSm} disabled={loading || !data?.next_before} onClick={() => { setTrail(old => [...old, before]); setBefore(data.next_before); }}>Ранние сообщения</button>
      {before && <><button className={s.btnSm} disabled={loading} onClick={() => { setBefore(trail[trail.length - 1] ?? null); setTrail(old => old.slice(0, -1)); }}>Новые сообщения</button>
        <button className={s.btnSm} onClick={() => { setBefore(null); setTrail([]); }}>К последним</button></>}
    </div>
    {error && <p className={s.error} role="alert">{error}{data && ' Показаны ранее загруженные сообщения.'}</p>}
    {loading && <p className={v.meta} role="status">Загружаем переписку…</p>}
    {data && <div className={v.messages} ref={scroller} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {!data.items.length && <p className={v.meta}>В этом диалоге пока нет сообщений.</p>}
      {data.items.map(m => <article key={m.id} className={`${v.message} ${m.role === 'user' ? '' : v.outgoing}`}>
        <div className={v.messageMeta}><strong>{m.role === 'user' ? task.contactLabel : m.author?.startsWith('operator:') ? 'Менеджер' : `Бот · ${task.personaName}`}</strong>
          <time dateTime={new Date(m.ts * 1000).toISOString()}>{new Date(m.ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' })}</time></div>
        {m.deletedAt ? <p className={v.meta}>Сообщение удалено</p> : <>{m.text && <p>{m.text}</p>}{m.has_file && <Attachment taskId={task.id} message={m} />}{!m.has_file && m.mediaKind && !m.text && <p className={v.meta}>Вложение не сохранено</p>}{m.editedAt && <span className={v.meta}>Изменено</span>}</>}
        {m.reaction && <span aria-label="Реакция">{m.reaction}</span>}
      </article>)}
    </div>}
    <p className={v.meta}>Время сообщений — МСК (UTC+3)</p>
  </section>;
}
