import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { BANNER_MS, loadDismissed, loadShown, normalizeQueue, pruneDismissed, queueKey, queueText, saveDismissed, saveShown } from './queueNotices';

const normalize = data => ({ items: Array.isArray(data?.items) ? data.items : [], unread: Number(data?.unread) || 0 });
const waitingLabel = since => {
  if (!since) return '';
  const min = Math.max(0, Math.round((Date.now() / 1000 - since) / 60));
  return min < 60 ? `${min} мин` : min < 1440 ? `${Math.floor(min / 60)} ч` : `${Math.floor(min / 1440)} д`;
};
const pushSupported = () => typeof window !== 'undefined' && 'Notification' in window;

const BANNER_CLASS = 'fixed right-5 bottom-5 z-[60] flex w-[min(390px,calc(100vw-2rem))] min-h-14 items-start gap-3 rounded-lg border bg-card p-4 text-sm text-card-foreground shadow-lg max-sm:right-4 max-sm:bottom-4';
const BANNER_TEXT_CLASS = 'min-w-0 flex-1 rounded-sm text-left leading-relaxed outline-none [overflow-wrap:anywhere] focus-visible:ring-[3px] focus-visible:ring-ring/50';
const GROUP_TITLE_CLASS = 'mt-1 text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase';
const ITEM_CLASS = 'rounded-lg border bg-card p-3.5';
const ITEM_UNREAD_CLASS = 'border-primary/40 bg-primary/5';
const smallBtn = buttonVariants({ variant: 'outline', size: 'sm' });

export default function VoiceNotifications({ userId }) {
  const [data, setData] = useState({ items: [], unread: 0 }), [open, setOpen] = useState(false), [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(null);
  const [queue, setQueue] = useState([]);
  const [closed, setClosed] = useState(() => loadDismissed());
  const [shown, setShown] = useState(() => loadShown());
  const [permission, setPermission] = useState(() => (pushSupported() ? Notification.permission : 'unsupported'));
  const seen = useRef(null);
  const locked = useRef(false);
  const navigate = useNavigate();
  const load = useCallback(async () => {
    const result = await api.get('/api/voicer/notices');
    setData(normalize(result)); setError('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const markShown = useCallback(item => {
    setShown(prev => {
      if (prev.has(queueKey(item))) return prev;
      const next = new Set(prev); next.add(queueKey(item)); saveShown(next);
      return next;
    });
  }, []);

  const closeQueue = useCallback(item => {
    markShown(item);
    setClosed(prev => {
      const next = { ...prev, [queueKey(item)]: Math.floor(Date.now() / 1000) };
      saveDismissed(next);
      return next;
    });
  }, [markShown]);

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
  // Баннер показывается один раз на несколько секунд и «улетает» в колокольчик:
  // там чат остаётся непрочитанным, пока его не откроют или не закроют.
  const latestQueue = pendingQueue.find(item => !shown.has(queueKey(item))) ?? null;
  useEffect(() => {
    if (!latestQueue || open) return undefined;
    const timer = setTimeout(() => markShown(latestQueue), BANNER_MS);
    return () => clearTimeout(timer);
  }, [latestQueue, open, markShown]);
  const latest = data.items.find(item => !item.readAt);
  useEffect(() => {
    if (!latest || latest.id === dismissed || open) return;
    const timer = setTimeout(() => setDismissed(latest.id), 7000);
    return () => clearTimeout(timer);
  }, [latest?.id, dismissed, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const showVoiceBanner = latest && latest.id !== dismissed && !open;
  const showQueueBanner = !showVoiceBanner && latestQueue && !open;
  return <>
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="relative shrink-0"
      aria-label={`Уведомления: ${unread} непрочитанных`}
      onClick={() => setOpen(true)}
      title="Уведомления: ждут менеджера, голосовые"
    >
      <Bell aria-hidden="true" />
      <Badge
        variant={unread ? 'default' : 'secondary'}
        className="absolute -top-1.5 -right-1.5 h-4 min-w-4 rounded-full px-1 font-mono text-[10px] leading-none tabular-nums"
        aria-hidden="true"
      >
        {unread > 99 ? '99+' : unread}
      </Badge>
    </Button>
    {showVoiceBanner && <div className={BANNER_CLASS} role="status">
      <button type="button" className={BANNER_TEXT_CLASS} onClick={() => setOpen(true)}>{latest.text}</button>
      <Button type="button" variant="ghost" size="icon" className="-mt-2 -mr-2 size-8" aria-label="Скрыть уведомление" onClick={() => setDismissed(latest.id)}>
        <X aria-hidden="true" />
      </Button>
    </div>}
    {showQueueBanner && <div className={cn(BANNER_CLASS, 'border-warning-foreground/40')} role="status" data-testid="queue-banner">
      <button type="button" className={BANNER_TEXT_CLASS} onClick={() => openChat(latestQueue)}>
        <strong className="font-semibold">Ждут менеджера</strong> · {queueText(latestQueue)}
        {pendingQueue.length > 1 && <span className="text-muted-foreground"> · ещё {pendingQueue.length - 1}</span>}
      </button>
      <Button type="button" variant="ghost" size="icon" className="-mt-2 -mr-2 size-8" aria-label="Закрыть уведомление" onClick={() => closeQueue(latestQueue)}>
        <X aria-hidden="true" />
      </Button>
    </div>}
    {open && <PanelUX.Modal title="Уведомления" onClose={() => setOpen(false)} footer={<Button type="button" variant="outline" onClick={() => setOpen(false)}>Закрыть</Button>}>
      <div className="flex min-h-[120px] flex-col gap-3 text-sm">
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {permission === 'default' && <p className="rounded-lg border border-dashed px-3.5 py-3 leading-relaxed">
          Чтобы видеть новые чаты в очереди, даже когда панель свёрнута, включите уведомления браузера.{' '}
          <Button type="button" variant="outline" size="sm" onClick={askPush}>Включить push</Button>
        </p>}
        {permission === 'denied' && <p className="text-muted-foreground">Push в браузере запрещён — разрешите уведомления для этого сайта в настройках браузера.</p>}
        {pendingQueue.length > 0 && <h4 className={GROUP_TITLE_CLASS}>Ждут менеджера</h4>}
        {pendingQueue.map(item => <article key={queueKey(item)} className={cn(ITEM_CLASS, ITEM_UNREAD_CLASS)} data-testid="queue-notice">
          <p className="mb-2 leading-relaxed [overflow-wrap:anywhere]">{queueText(item)}</p>
          <time className="font-mono text-xs text-muted-foreground">ждёт {waitingLabel(item.waiting_since)}{item.manager_name ? ` · ${item.manager_name}` : ''}</time>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => openChat(item)}>Открыть чат</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => closeQueue(item)}>Закрыть</Button>
          </div>
        </article>)}
        {(pendingQueue.length > 0 || data.items.length > 0) && data.items.length > 0 && <h4 className={GROUP_TITLE_CLASS}>Голосовые</h4>}
        {!data.items.length && !pendingQueue.length && <p>Новых уведомлений пока нет. Здесь появятся чаты, которые ждут менеджера, и готовые голосовые.</p>}
        {data.items.map(item => <article key={item.id} className={cn(ITEM_CLASS, !item.readAt && ITEM_UNREAD_CLASS)}>
          <p className="mb-2 leading-relaxed [overflow-wrap:anywhere]">{item.text}</p>
          <time className="font-mono text-xs text-muted-foreground">{new Date(item.createdAt * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</time>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link className={smallBtn} to={`/voice?task=${item.taskId}`} onClick={() => { read(item); setOpen(false); }}>Открыть задание</Link>
            {!item.readAt && <Button type="button" variant="outline" size="sm" onClick={() => read(item)}>Прочитано</Button>}
          </div>
        </article>)}
        {data.items.length >= 40 && <p className="text-muted-foreground">Показаны последние 40 уведомлений; непрочитанные — первыми.</p>}
      </div>
    </PanelUX.Modal>}
  </>;
}
