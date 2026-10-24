import { useState, useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { LogOut, MessagesSquare } from 'lucide-react';
import { api, setTokens } from '../../api/client';
import { getStats } from '../../api/stats';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import VoiceNotifications from './VoiceNotifications';
import { isManagerRole } from '../../utils/roles';
import { menuFor } from '../../navigation';
import { useMe } from '../AppLayout/me';

const LIVE_POLL_MS = 30000;

/** Инициалы для аватара: первые буквы двух слов логина или две первые буквы. */
function initials(username) {
  const text = String(username || '').trim();
  if (!text) return '';
  const parts = text.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : text.slice(0, 2);
  return letters.toUpperCase();
}

/** Часы живут отдельно: секундный тик перерисовывает только их, а не всю шапку. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="hidden text-sm tabular-nums text-muted-foreground min-[1680px]:inline" title="Московское время">
      {now.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК
    </span>
  );
}

/** Счётчик живых диалогов. До первого ответа — заглушка той же ширины. */
function LivePill() {
  const [live, setLive] = useState(null);
  useEffect(() => {
    const pull = () => getStats().then((s) => setLive(s?.active_now ?? 0)).catch(() => {});
    pull();
    const t = setInterval(() => document.visibilityState === 'visible' && pull(), LIVE_POLL_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <Badge
      variant="outline"
      className={cn('h-7 gap-1.5 px-2.5 font-normal', live === null && 'animate-pulse')}
      title="Диалогов с сообщениями за последние сутки"
    >
      <span
        className={cn('size-1.5 shrink-0 rounded-full bg-success-foreground', live !== null && 'animate-[livePulse_2s_ease-in-out_infinite]')}
        aria-hidden="true"
      />
      <span className="text-xs text-muted-foreground">Live</span>
      <span className={cn('liveCount', 'min-w-[2ch] text-center text-sm font-medium tabular-nums')}>{live ?? ''}</span>
    </Badge>
  );
}

const navClass = ({ isActive }) =>
  cn(
    buttonVariants({ variant: 'ghost', size: 'sm' }),
    'text-muted-foreground hover:text-foreground',
    isActive && 'bg-accent text-foreground',
  );



/**
 * Шапка панели. Монтируется один раз в каркасе (AppLayout) и получает уже
 * загруженного пользователя, поэтому при переходах между разделами не
 * перерисовывается и не меняет размеры. busy — страница под шапкой ждёт данные:
 * по нижней кромке бежит полоса загрузки.
 */
function Header({ me: meProp, busy = false }) {
  // Каркас передаёт пользователя пропом; вне его (тесты) берём из контекста.
  const fromContext = useMe();
  const me = meProp ?? fromContext;
  const [leaving, setLeaving] = useState(false);
  const role = me?.role;
  const staff = role === 'admin' || isManagerRole(role);

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="container flex min-h-[var(--header-h)] flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex shrink-0 items-center gap-3">
          <Link to="/" className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MessagesSquare className="size-4" aria-hidden="true" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight max-[479px]:hidden">BestChat</span>
          </Link>
          {/* Войсеру статистика не отдаётся — для него счётчика нет. */}
          {staff && <LivePill />}
        </div>

        <nav className="flex min-h-9 min-w-0 items-center gap-0.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-[1180px]:order-10 max-[1180px]:-mx-1 max-[1180px]:basis-full">
          {menuFor(role).top.map((item) => (
            <NavLink key={item.key} to={item.to} end={item.end} className={navClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3 max-[479px]:gap-2">
          <Clock />
          {/* Уведомления о голосовых и очереди — менеджеру, как в рабочей панели. */}
          {role === 'manager' && <VoiceNotifications key={me.id} userId={me.id} />}
          <div className="flex items-center gap-2.5">
            <div className="flex flex-col items-end max-[1279px]:hidden">
              <span className="text-[13px] leading-4 font-medium">{me?.username || '—'}</span>
              <span className="min-h-4 text-[11px] leading-4 text-muted-foreground">{role || ''}</span>
            </div>
            <Avatar className="size-8">
              <AvatarFallback className="text-xs font-medium">{initials(me?.username) || '—'}</AvatarFallback>
            </Avatar>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Выйти"
              title="Выйти"
              disabled={leaving}
              onClick={async () => {
                setLeaving(true);
                try {
                  await api.post('/auth/logout').catch(() => {});
                } finally {
                  setTokens(null);
                  window.location.reload();
                }
              }}
            >
              <LogOut aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden opacity-0 transition-opacity duration-200',
          busy && 'opacity-100 delay-150',
        )}
        aria-hidden="true"
      >
        <div className="h-full w-1/3 rounded-full bg-primary animate-[routeProgress_1.1s_ease-in-out_infinite]" />
      </div>
    </header>
  );
}

export default Header;
