import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import s from '../../styles/AdminPage.module.scss';
import v from './VoiceNotifications.module.scss';

const normalize = data => ({ items: Array.isArray(data?.items) ? data.items : [], unread: Number(data?.unread) || 0 });

export default function VoiceNotifications({ userId }) {
  const [data, setData] = useState({ items: [], unread: 0 }), [open, setOpen] = useState(false), [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(null);
  const locked = useRef(false);
  const load = useCallback(async () => {
    const result = await api.get('/api/voicer/notices');
    setData(normalize(result)); setError('');
  }, [userId]);
  useEffect(() => {
    let active = true, pending = false;
    const pull = async () => {
      if (pending || document.visibilityState !== 'visible') return;
      pending = true;
      try { const result = await api.get('/api/voicer/notices'); if (active) { setData(normalize(result)); setError(''); } }
      catch (e) { if (active) setError(PanelUX.readableError(e)); }
      finally { pending = false; }
    };
    pull(); const timer = setInterval(pull, 10000);
    document.addEventListener('visibilitychange', pull);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', pull); };
  }, [userId]);
  async function read(item) {
    if (locked.current) return;
    locked.current = true;
    try { await api.post(`/api/voicer/notices/${item.id}/read`, {}); await load(); }
    catch (e) { setError(PanelUX.readableError(e)); }
    finally { locked.current = false; }
  }
  const latest = data.items.find(item => !item.readAt);
  useEffect(() => {
    if (!latest || latest.id === dismissed || open) return;
    const timer = setTimeout(() => setDismissed(latest.id), 7000);
    return () => clearTimeout(timer);
  }, [latest?.id, dismissed, open]);
  return <>
    <button className={`${s.btnSm} ${v.bell}`} aria-label={`Уведомления: ${data.unread} непрочитанных`} onClick={() => setOpen(true)} title="Уведомления о голосовых">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6" /></svg>
      <span>{data.unread > 99 ? '99+' : data.unread}</span>
    </button>
    {latest && latest.id !== dismissed && !open && <div className={v.banner} role="status">
      <button className={v.noticeText} onClick={() => setOpen(true)}>{latest.text}</button>
      <button className={v.dismiss} aria-label="Скрыть уведомление" onClick={() => setDismissed(latest.id)}>×</button>
    </div>}
    {open && <PanelUX.Modal title="Уведомления о голосовых" onClose={() => setOpen(false)} footer={<button className={s.btn} onClick={() => setOpen(false)}>Закрыть</button>}>
      <div className={v.list}>
        {error && <p className={s.error} role="alert">{error}</p>}
        {!data.items.length && <p>Новых уведомлений пока нет. Здесь появятся готовые записи и результаты отправки.</p>}
        {data.items.map(item => <article key={item.id} className={`${v.item} ${!item.readAt ? v.unread : ''}`}>
          <p>{item.text}</p><time>{new Date(item.createdAt * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</time>
          <div className={v.actions}>
            <Link className={s.btnSm} to={`/voice?task=${item.taskId}`} onClick={() => { read(item); setOpen(false); }}>Открыть задание</Link>
            {!item.readAt && <button className={s.btnSm} onClick={() => read(item)}>Прочитано</button>}
          </div>
        </article>)}
        {data.items.length >= 40 && <p>Показаны последние 40 уведомлений; непрочитанные — первыми.</p>}
      </div>
    </PanelUX.Modal>}
  </>;
}
