import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import s from '../../styles/AdminPage.module.scss';
import v from './VoiceNotifications.module.scss';
import { loadDismissed, normalizeQueue, pruneDismissed, queueKey, queueText, saveDismissed } from './queueNotices';

const normalize = data => ({ items: Array.isArray(data?.items) ? data.items : [], unread: Number(data?.unread) || 0 });
const waitingLabel = since => {
  if (!since) return '';
  const min = Math.max(0, Math.round((Date.now() / 1000 - since) / 60));
  return min < 60 ? `${min} мин` : min < 1440 ? `${Math.floor(min / 60)} ч` : `${Math.floor(min / 1440)} д`;
};
const pushSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export default function VoiceNotifications({ userId }) {
  const [data, setData] = useState({ items: [], unread: 0 }), [open, setOpen] = useState(false), [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(null);
  const [queue, setQueue] = useState([]);
  const [closed, setClosed] = useState(() => loadDismissed());
  const [permission, setPermission] = useState(() => (pushSupported() ? Notification.permission : 'unsupported'));
  const seen = useRef(null);
  const locked = useRef(false);
  const navigate = useNavigate();
  const load = useCallback(async () => {
    const result = await api.get('/api/voicer/notices');
    setData(normalize(result)); setError('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const closeQueue = useCallback(item => {
    setClosed(prev => {
      const next = { ...prev, [queueKey(item)]: Math.floor(Date.now() / 1000) };
      saveDismissed(next);
      return next;
    });
  }, []);

  const openChat = useCallback(item => {
    closeQueue(item);
    setOpen(false);
    navigate(`/conversation/${item.chat_id}`);
  }, [closeQueue, navigate]);

  // Браузерный push на новые чаты в очереди: только на те, что появились после
  // первого опроса, иначе при входе в панель прилетит вся очередь разом.
  const pushFor = useCallback(items => {
    if (!seen.current) { seen.current = new Set(items.map(queueKey)); return; }
    const fresh = items.filter(i => !seen.current.has(queueKey(i)));
    for (const item of items) seen.current.add(queueKey(item));
    if (!fresh.length || !pushSupported() || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    for (const item of fresh) {
      try {
        const n = new Notification('Ждут менеджера', { body: queueText(item), tag: queueKey(item), requireInteraction: true });
        n.onclick = () => { window.focus(); openChat(item); n.close(); };
      } catch {
        // браузер без конструктора Notification (мобильный Safari) — остаётся колокольчик
      }
    }
  }, [openChat]);

  useEffect(() => {
    let active = true, pending = false;
    const pull = async () => {
      if (pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const [notices, queued] = await Promise.all([
          api.get('/api/voicer/notices'),
          api.get('/api/manager/queue').then(normalizeQueue).catch(() => null),
        ]);
        if (!active) return;
        setData(normalize(notices)); setError('');
        if (queued) {
          setQueue(queued);
          setClosed(prev => { const next = pruneDismissed(prev, queued); if (Object.keys(next).length !== Object.keys(prev).length) saveDismissed(next); return next; });
          pushFor(queued);
        }
      }
      catch (e) { if (active) setError(PanelUX.readableError(e)); }
      finally { pending = false; }
    };
    pull(); const timer = setInterval(pull, 10000);
    document.addEventListener('visibilitychange', pull);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', pull); };
  }, [userId, pushFor]);

  async function read(item) {
    if (locked.current) return;
    locked.current = true;
    try { await api.post(`/api/voicer/notices/${item.id}/read`, {}); await load(); }
    catch (e) { setError(PanelUX.readableError(e)); }
    finally { locked.current = false; }
  }
  async function askPush() {
    if (!pushSupported()) return;
    try { setPermission(await Notification.requestPermission()); } catch { setPermission(Notification.permission); }
  }

  const pendingQueue = queue.filter(item => !closed[queueKey(item)]);
  const unread = data.unread + pendingQueue.length;
  const latestQueue = pendingQueue[0] ?? null;
  const latest = data.items.find(item => !item.readAt);
  useEffect(() => {
    if (!latest || latest.id === dismissed || open) return;
    const timer = setTimeout(() => setDismissed(latest.id), 7000);
    return () => clearTimeout(timer);
  }, [latest?.id, dismissed, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const showVoiceBanner = latest && latest.id !== dismissed && !open;
  const showQueueBanner = !showVoiceBanner && latestQueue && !open;
  return <>
    <button className={`${s.btnSm} ${v.bell}`} aria-label={`Уведомления: ${unread} непрочитанных`} onClick={() => setOpen(true)} title="Уведомления: ждут менеджера, голосовые">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6" /></svg>
      <span>{unread > 99 ? '99+' : unread}</span>
    </button>
    {showVoiceBanner && <div className={v.banner} role="status">
      <button className={v.noticeText} onClick={() => setOpen(true)}>{latest.text}</button>
      <button className={v.dismiss} aria-label="Скрыть уведомление" onClick={() => setDismissed(latest.id)}>×</button>
    </div>}
    {showQueueBanner && <div className={`${v.banner} ${v.bannerQueue}`} role="status" data-testid="queue-banner">
      <button className={v.noticeText} onClick={() => openChat(latestQueue)}>
        <strong>Ждут менеджера</strong> · {queueText(latestQueue)}
        {pendingQueue.length > 1 && <span className={v.more}> · ещё {pendingQueue.length - 1}</span>}
      </button>
      <button className={v.dismiss} aria-label="Закрыть уведомление" onClick={() => closeQueue(latestQueue)}>×</button>
    </div>}
    {open && <PanelUX.Modal title="Уведомления" onClose={() => setOpen(false)} footer={<button className={s.btn} onClick={() => setOpen(false)}>Закрыть</button>}>
      <div className={v.list}>
        {error && <p className={s.error} role="alert">{error}</p>}
        {permission === 'default' && <p className={v.pushRow}>
          Чтобы видеть новые чаты в очереди, даже когда панель свёрнута, включите уведомления браузера.{' '}
          <button className={s.btnSm} onClick={askPush}>Включить push</button>
        </p>}
        {permission === 'denied' && <p className={s.muted}>Push в браузере запрещён — разрешите уведомления для этого сайта в настройках браузера.</p>}
        {pendingQueue.length > 0 && <h4 className={v.groupTitle}>Ждут менеджера</h4>}
        {pendingQueue.map(item => <article key={queueKey(item)} className={`${v.item} ${v.unread}`} data-testid="queue-notice">
          <p>{queueText(item)}</p>
          <time>ждёт {waitingLabel(item.waiting_since)}{item.manager_name ? ` · ${item.manager_name}` : ''}</time>
          <div className={v.actions}>
            <button className={s.btnSm} onClick={() => openChat(item)}>Открыть чат</button>
            <button className={s.btnSm} onClick={() => closeQueue(item)}>Закрыть</button>
          </div>
        </article>)}
        {(pendingQueue.length > 0 || data.items.length > 0) && data.items.length > 0 && <h4 className={v.groupTitle}>Голосовые</h4>}
        {!data.items.length && !pendingQueue.length && <p>Новых уведомлений пока нет. Здесь появятся чаты, которые ждут менеджера, и готовые голосовые.</p>}
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
