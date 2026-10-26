import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { BANNER_MS, beep, loadDismissed, loadShown, loadSound, loadVoiceSeen, normalizeQueue, pruneDismissed, queueKey, queueText, saveDismissed, saveShown, saveSound, saveVoiceSeen } from './queueNotices';

const normalize = data => ({ items: Array.isArray(data?.items) ? data.items : [], unread: Number(data?.unread) || 0 });
const waitingLabel = since => {
  if (!since) return '';
  const min = Math.max(0, Math.round((Date.now() / 1000 - since) / 60));
  return min < 60 ? `${min} мин` : min < 1440 ? `${Math.floor(min / 60)} ч` : `${Math.floor(min / 1440)} д`;
};
const pushSupported = () => typeof window !== 'undefined' && 'Notification' in window;

// Всплывающее уведомление — нейтральная карточка: непрочитанное отмечает только точка.
const BANNER_CLASS = 'fixed right-5 bottom-5 z-[60] flex w-[min(380px,calc(100vw-2rem))] items-start gap-2.5 rounded-lg border bg-popover py-2.5 pr-2 pl-3.5 text-sm text-popover-foreground shadow-sm max-sm:right-4 max-sm:bottom-4';
const BANNER_TEXT_CLASS = 'min-w-0 flex-1 rounded-sm py-0.5 text-left leading-5 outline-none [overflow-wrap:anywhere] focus-visible:ring-[3px] focus-visible:ring-ring/50';
const BANNER_CLOSE_CLASS = 'shrink-0 text-muted-foreground hover:text-foreground';
const GROUP_TITLE_CLASS = 'text-xs font-medium text-muted-foreground';
// Строка списка: точка — текст и время — действия. Рамок и подложек у строк нет.
const ITEM_CLASS = 'flex flex-wrap items-start gap-x-2.5 gap-y-2 py-3';
const ITEM_ACTIONS_CLASS = 'ml-auto flex shrink-0 items-center gap-1 pl-4';
const smallBtn = buttonVariants({ variant: 'outline', size: 'sm' });

function UnreadDot({ className }) {
  return <span className={cn('size-1.5 shrink-0 rounded-full bg-primary', className)} aria-hidden="true" />;
}

export default function VoiceNotifications({ userId }) {
  const [data, setData] = useState({ items: [], unread: 0 }), [open, setOpen] = useState(false), [error, setError] = useState('');
  const [voiceSeen, setVoiceSeen] = useState(() => loadVoiceSeen(userId));
  const [queue, setQueue] = useState([]);
  const [closed, setClosed] = useState(() => loadDismissed());
  const [shown, setShown] = useState(() => loadShown());
  const [permission, setPermission] = useState(() => (pushSupported() ? Notification.permission : 'unsupported'));
  const [sound, setSound] = useState(loadSound);
  const soundRef = useRef(sound);
  soundRef.current = sound;
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
    if (fresh.length && soundRef.current) beep();
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
    // Свёрнутая вкладка опрашивает только очередь: иначе push «ждут менеджера»
    // не приходил никогда — он нужен как раз когда вкладка не видна.
    const pull = async () => {
      if (pending) return;
      const visible = document.visibilityState === 'visible';
      pending = true;
      try {
        const [notices, queued] = await Promise.all([
          visible ? api.get('/api/voicer/notices') : null,
          api.get('/api/manager/queue').then(normalizeQueue).catch(() => null),
        ]);
        if (!active) return;
        if (notices) { setData(normalize(notices)); setError(''); }
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
  // Баннер голосовых — только для уведомлений новее уже показанного: один раз
  // на уведомление, дальше оно живёт в колокольчике до «Прочитано».
  const markVoiceSeen = useCallback(id => setVoiceSeen(prev => {
    const next = Math.max(prev ?? 0, id);
    saveVoiceSeen(userId, next);
    return next;
  }), [userId]);
  const latest = data.items.find(item => !item.readAt && (voiceSeen == null || item.id > voiceSeen));
  useEffect(() => {
    if (!latest || open) return;
    const timer = setTimeout(() => markVoiceSeen(latest.id), 7000);
    return () => clearTimeout(timer);
  }, [latest?.id, open, markVoiceSeen]); // eslint-disable-line react-hooks/exhaustive-deps
  const showVoiceBanner = latest && !open;
  const showQueueBanner = !showVoiceBanner && latestQueue && !open;
  return <>
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="relative shrink-0 text-muted-foreground hover:text-foreground"
      aria-label={`Уведомления: ${unread} непрочитанных`}
      onClick={() => setOpen(true)}
      title="Уведомления: ждут менеджера, голосовые"
    >
      <Bell aria-hidden="true" />
      {/* Счётчик смонтирован всегда и не занимает места в потоке: шапка не дёргается. */}
      <span
        className={cn(
          'absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-[10px] leading-none font-medium text-background tabular-nums',
          !unread && 'invisible',
        )}
        aria-hidden="true"
      >
        {unread > 99 ? '99+' : unread}
      </span>
    </Button>
    {showVoiceBanner && <div className={BANNER_CLASS} role="status">
      <UnreadDot className="mt-2" />
      <button type="button" className={BANNER_TEXT_CLASS} onClick={() => setOpen(true)}>{latest.text}</button>
      <Button type="button" variant="ghost" size="icon-xs" className={BANNER_CLOSE_CLASS} aria-label="Скрыть уведомление" onClick={() => markVoiceSeen(latest.id)}>
        <X aria-hidden="true" />
      </Button>
    </div>}
    {showQueueBanner && <div className={BANNER_CLASS} role="status" data-testid="queue-banner">
      <UnreadDot className="mt-2" />
      <button type="button" className={BANNER_TEXT_CLASS} onClick={() => openChat(latestQueue)}>
        <strong className="font-medium">Ждут менеджера</strong> · {queueText(latestQueue)}
        {pendingQueue.length > 1 && <span className="text-muted-foreground"> · ещё {pendingQueue.length - 1}</span>}
      </button>
      <Button type="button" variant="ghost" size="icon-xs" className={BANNER_CLOSE_CLASS} aria-label="Закрыть уведомление" onClick={() => closeQueue(latestQueue)}>
        <X aria-hidden="true" />
      </Button>
    </div>}
    {open && <PanelUX.Modal title="Уведомления" onClose={() => setOpen(false)} footer={<Button type="button" variant="outline" onClick={() => setOpen(false)}>Закрыть</Button>}>
      <div className="flex min-h-[120px] flex-col gap-3 text-sm">
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        {permission === 'default' && <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md bg-muted/40 px-3 py-2.5">
          <p className="min-w-0 flex-[1_1_240px] text-xs leading-relaxed text-muted-foreground">Чтобы видеть новые чаты в очереди, даже когда панель свёрнута, включите уведомления браузера.</p>
          <Button type="button" variant="outline" onClick={askPush}>Включить push</Button>
        </div>}
        {permission === 'denied' && <p className="text-xs text-muted-foreground">Push в браузере запрещён — разрешите уведомления для этого сайта в настройках браузера.</p>}
        <label className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
          <span>Звук, когда чат попадает в «Ждут менеджера»</span>
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={sound}
            data-testid="queue-sound"
            onChange={(e) => { setSound(e.target.checked); saveSound(e.target.checked); if (e.target.checked) beep(); }}
          />
        </label>
        {!data.items.length && !pendingQueue.length && <p className="text-muted-foreground">Новых уведомлений пока нет. Здесь появятся чаты, которые ждут менеджера, и готовые голосовые.</p>}
        {pendingQueue.length > 0 && <section>
          <h4 className={GROUP_TITLE_CLASS}>Ждут менеджера</h4>
          <div className="divide-y">
            {pendingQueue.map(item => <article key={queueKey(item)} className={ITEM_CLASS} data-testid="queue-notice">
              <UnreadDot className="mt-1.5" />
              <div className="min-w-0 flex-1">
                <p className="leading-5 [overflow-wrap:anywhere]">{queueText(item)}</p>
                <time className="text-xs text-muted-foreground tabular-nums">ждёт {waitingLabel(item.waiting_since)}{item.manager_name ? ` · ${item.manager_name}` : ''}</time>
              </div>
              <div className={ITEM_ACTIONS_CLASS}>
                <Button type="button" variant="outline" onClick={() => openChat(item)}>Открыть чат</Button>
                <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => closeQueue(item)}>Закрыть</Button>
              </div>
            </article>)}
          </div>
        </section>}
        {data.items.length > 0 && <section>
          <h4 className={GROUP_TITLE_CLASS}>Голосовые</h4>
          <div className="divide-y">
            {data.items.map(item => <article key={item.id} className={ITEM_CLASS}>
              <UnreadDot className={cn('mt-1.5', item.readAt && 'invisible')} />
              <div className="min-w-0 flex-1">
                <p className={cn('leading-5 [overflow-wrap:anywhere]', item.readAt && 'text-muted-foreground')}>{item.text}</p>
                <time className="text-xs text-muted-foreground tabular-nums">{new Date(item.createdAt * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</time>
              </div>
              <div className={ITEM_ACTIONS_CLASS}>
                <Link className={smallBtn} to={`/voice?task=${item.taskId}`} onClick={() => { read(item); setOpen(false); }}>Открыть задание</Link>
                {!item.readAt && <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => read(item)}>Прочитано</Button>}
              </div>
            </article>)}
          </div>
        </section>}
        {data.items.length >= 40 && <p className="text-xs text-muted-foreground">Показаны последние 40 уведомлений; непрочитанные — первыми.</p>}
      </div>
    </PanelUX.Modal>}
  </>;
}
