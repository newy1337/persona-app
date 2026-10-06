import { useState, useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ChevronDown, LogOut, MessagesSquare, Search, SlidersHorizontal } from 'lucide-react';
import { api, getToken, setTokens } from '../../api/client';
import { getStats } from '../../api/stats';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import VoiceNotifications from './VoiceNotifications';

const LEAD_OPTIONS = [
  { key: '', label: 'любой' },
  { key: 'bot', label: 'бот' },
  { key: 'manager', label: 'менеджер' },
];

/** Инициалы для аватара: первые буквы двух слов логина или две первые буквы. */
function initials(username) {
  const text = String(username || '').trim();
  if (!text) return '';
  const parts = text.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : text.slice(0, 2);
  return letters.toUpperCase();
}

function OptionPill({ active, children, ...props }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'secondary' : 'outline'}
      aria-pressed={active}
      className="h-8 rounded-full px-3 text-xs font-normal"
      {...props}
    >
      {children}
    </Button>
  );
}

function FiltersPanel({ value, onChange, accounts }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const active = Boolean(value.lead || value.account);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-5 items-center justify-between">
        <span className="text-sm font-medium">Фильтры</span>
        <Button
          type="button"
          variant="link"
          size="sm"
          className={cn('h-auto p-0 text-xs', !active && 'invisible')}
          disabled={!active}
          onClick={() => onChange({ lead: '', account: '' })}
        >
          Сбросить
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Ведёт</span>
        <div className="flex flex-wrap gap-1.5">
          {LEAD_OPTIONS.map((o) => (
            <OptionPill key={o.key || 'any'} active={value.lead === o.key} onClick={() => set({ lead: o.key })}>
              {o.label}
            </OptionPill>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Аккаунт</span>
        <div className="flex flex-wrap gap-1.5">
          <OptionPill active={value.account === ''} onClick={() => set({ account: '' })}>
            любой
          </OptionPill>
          {accounts.map((a) => (
            <OptionPill key={a} active={value.account === String(a)} onClick={() => set({ account: String(a) })}>
              #{a}
            </OptionPill>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Часы живут отдельно: секундный тик перерисовывает только их, а не всю шапку. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="hidden flex-col items-end gap-0.5 font-mono tabular-nums min-[1680px]:flex">
      <span className="text-base leading-none font-medium tracking-[0.03em]">
        {now.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК
      </span>
      <span className="text-[10px] leading-4 tracking-[0.06em] text-muted-foreground uppercase">
        {now.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
      </span>
    </div>
  );
}

const navClass = ({ isActive }) =>
  cn(
    buttonVariants({ variant: 'ghost', size: 'sm' }),
    'text-muted-foreground hover:text-foreground',
    isActive && 'bg-primary/15 text-foreground',
  );

const NAV = [
  { to: '/', end: true, label: 'Диалоги', roles: ['admin', 'manager'] },
  { to: '/leads', label: 'Лиды', roles: ['admin', 'manager'] },
  { to: '/voice', label: 'Войсер' },
  { to: '/personas', label: 'Личности', roles: ['admin'] },
  { to: '/accounts', label: 'Аккаунты', roles: ['admin', 'manager'] },
  { to: '/managers', label: 'Менеджеры', roles: ['admin'] },
  { to: '/stats', label: 'Статистика', roles: ['admin'] },
  { to: '/settings', label: 'Настройки', roles: ['admin'] },
];

/* Заглушка того же размера, что и будущий текст: подпись рисуется прозрачным
   псевдоэлементом из data-label, поэтому ширина совпадает по построению, а в
   textContent ничего не попадает. */
const GHOST_TEXT = 'animate-pulse bg-accent text-transparent before:content-[attr(data-label)]';

/* Шапка монтируется заново на каждой странице, а /auth/me отвечает не сразу.
   Чтобы блоки не появлялись и не меняли ширину, помним, кто вошёл: в памяти
   вкладки — для мгновенного показа, в localStorage — для первого кадра после
   перезагрузки. Запись привязана к хвосту токена: с тем же токеном показываем
   её сразу, с другим она задаёт только размеры заглушек. */
const KNOWN_KEY = 'panel_header_me';
const tokenTag = () => String(getToken() || '').slice(-24);
let memory = null;

function readKnown() {
  if (memory) return memory;
  try {
    const saved = JSON.parse(window.localStorage.getItem(KNOWN_KEY) || 'null');
    return saved && typeof saved.role === 'string' ? saved : null;
  } catch {
    return null;
  }
}

function remember(patch) {
  const tag = tokenTag();
  // Без токена (тесты, гость) ничего не запоминаем.
  if (!tag) return;
  memory = { ...(memory?.tag === tag ? memory : null), ...patch, tag };
  try {
    const { id, username, role } = memory;
    if (role) window.localStorage.setItem(KNOWN_KEY, JSON.stringify({ tag, id, username, role }));
  } catch {
    // хранилище недоступно — остаётся память вкладки
  }
}

/** При выходе оставляем только роль — по ней строятся заглушки следующего входа. */
function forget() {
  const role = memory?.role ?? readKnown()?.role;
  memory = null;
  try {
    if (role) window.localStorage.setItem(KNOWN_KEY, JSON.stringify({ role }));
  } catch {
    // хранилище недоступно
  }
}

function Header({
  liveCount,
  query = '',
  onQueryChange,
  filters = { lead: '', account: '' },
  onFiltersChange,
  accounts = [],
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  // known — последний известный пользователь; fresh — запись от текущего токена.
  const [known] = useState(readKnown);
  const fresh = Boolean(known?.tag) && known.tag === tokenTag();
  const [me, setMe] = useState(() => (fresh ? known : null));
  const [pending, setPending] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [ownLive, setOwnLive] = useState(() => (fresh ? known.live ?? null : null));
  const searchable = typeof onQueryChange === 'function';

  useEffect(() => {
    api.get('/auth/me')
      .then((user) => {
        setMe(user);
        if (user) remember({ id: user.id, username: user.username, role: user.role });
      })
      .catch(() => setMe(null))
      .finally(() => setPending(false));
  }, []);

  useEffect(() => {
    if (liveCount !== undefined || !me || me.role === 'voice') return undefined;
    const pull = () => getStats().then((s) => {
      const value = s?.active_now ?? 0;
      setOwnLive(value);
      remember({ live: value });
    }).catch(() => {});
    pull();
    const t = setInterval(() => document.visibilityState === 'visible' && pull(), 30000);
    return () => clearInterval(t);
  }, [liveCount, me]);
  const live = liveCount ?? ownLive;
  // Пока /auth/me не ответил, размеры блоков берём по последнему известному
  // пользователю; если его нет — по менеджеру (самая частая роль).
  const waiting = !me && pending;
  const shape = me ?? (waiting ? known ?? { role: 'manager' } : null);
  // Войсеру статистика не отдаётся — для него пилюля не рисуется вовсе.
  const livePill = !(liveCount === undefined && shape?.role === 'voice');
  const withBell = ['manager', 'admin'].includes(shape?.role);
  const activeFilters = Number(Boolean(filters.lead)) + Number(Boolean(filters.account));

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="container flex min-h-[var(--header-h)] flex-wrap items-center gap-x-5 gap-y-2.5">
        <div className="flex shrink-0 items-center gap-4">
          <Link to="/" className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MessagesSquare className="size-4" aria-hidden="true" />
            </span>
            <span className="grid text-[15px] leading-[22px] font-bold tracking-tight max-[479px]:hidden">
              BestChat
              <span className="font-mono text-[10px] leading-[15px] font-medium tracking-[0.08em] text-primary max-[1279px]:hidden">AI PLATFORM</span>
            </span>
          </Link>

          <span className="h-8 w-px shrink-0 bg-border max-[479px]:hidden" aria-hidden="true" />

          {livePill && (live === null ? (
            <Badge variant="outline" className="h-7 animate-pulse gap-1.5 border-transparent bg-accent px-2.5 font-mono" aria-hidden="true">
              <span className="size-1.5 shrink-0" />
              <span className="text-xs font-normal tracking-[0.04em] text-transparent before:content-['LIVE']" />
              <span className="min-w-[2ch] text-sm font-medium" />
            </Badge>
          ) : (
            <Badge variant="outline" className="h-7 gap-1.5 px-2.5 font-mono" title="Диалогов с сообщениями за последние сутки">
              <span className="size-1.5 shrink-0 rounded-full bg-primary animate-[livePulse_2s_ease-in-out_infinite]" aria-hidden="true" />
              <span className="text-xs font-normal tracking-[0.04em] text-primary">LIVE</span>
              <span className={cn('liveCount', 'min-w-[2ch] text-center text-sm font-medium tabular-nums')}>{live}</span>
            </Badge>
          ))}
        </div>

        <nav className="flex min-h-9 min-w-0 items-center gap-0.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-[1180px]:order-10 max-[1180px]:-mx-1 max-[1180px]:basis-full">
          {me && NAV.filter((item) => !item.roles || item.roles.includes(me.role)).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>{item.label}</NavLink>
          ))}
          {waiting && NAV.filter((item) => !item.roles || item.roles.includes(shape.role)).map((item) => (
            <span
              key={item.to}
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'pointer-events-none', GHOST_TEXT)}
              data-label={item.label}
              aria-hidden="true"
            />
          ))}
        </nav>

        {searchable && (
          <div className="flex min-w-0 flex-[1_1_260px] items-center justify-end gap-2.5 max-[1599px]:order-11 max-[1599px]:basis-full max-[1599px]:justify-start">
            <div className="relative min-w-0 flex-1 max-w-[360px] max-[1599px]:max-w-[480px] max-md:max-w-none">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="text"
                className="h-9 pl-8"
                placeholder="Имя, номер, город, chat_id…"
                value={query}
                onChange={(e) => onQueryChange?.(e.target.value)}
                aria-label="Поиск по диалогам"
              />
            </div>

            <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="group relative shrink-0 gap-1.5 text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                >
                  <SlidersHorizontal aria-hidden="true" />
                  <span>Фильтры</span>
                  <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
                  <Badge
                    className={cn(
                      'absolute -top-1.5 -right-1.5 h-4 min-w-4 rounded-full px-1 font-mono text-[10px] leading-none tabular-nums',
                      !activeFilters && 'invisible',
                    )}
                    aria-hidden={!activeFilters}
                  >
                    {activeFilters}
                  </Badge>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[280px] p-4">
                <FiltersPanel value={filters} onChange={onFiltersChange ?? (() => {})} accounts={accounts} />
              </PopoverContent>
            </Popover>
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-4 max-[479px]:gap-2">
          {withBell && (me
            ? <VoiceNotifications key={me.id} userId={me.id} />
            : <Skeleton className="size-9 shrink-0" aria-hidden="true" />)}
          <Clock />
          <span className="hidden h-8 w-px shrink-0 bg-border min-[1680px]:block" aria-hidden="true" />

          <div className="flex items-center gap-2.5">
            <div className="flex flex-col items-end gap-0.5 max-[1279px]:hidden">
              {waiting ? (
                <>
                  <span className={cn('min-w-12 rounded-sm text-[13px] leading-4 font-semibold', GHOST_TEXT)} data-label={shape.username || ''} aria-hidden="true" />
                  <span className={cn('min-h-4 min-w-10 rounded-sm text-[11px] leading-4', GHOST_TEXT)} data-label={shape.role || ''} aria-hidden="true" />
                </>
              ) : (
                <>
                  <span className="text-[13px] leading-4 font-semibold">{me?.username || '—'}</span>
                  <span className="min-h-4 text-[11px] leading-4 text-muted-foreground">{me?.role || ''}</span>
                </>
              )}
            </div>
            <span className="relative inline-flex shrink-0">
              <Avatar className="size-9">
                <AvatarFallback className={cn('text-xs font-semibold', waiting && 'animate-pulse')}>{waiting ? '' : initials(me?.username) || '—'}</AvatarFallback>
              </Avatar>
              <span className="absolute right-0 bottom-0 size-2.5 rounded-full bg-success-foreground ring-2 ring-background" aria-hidden="true" />
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              aria-label="Выйти"
              title="Выйти"
              disabled={leaving}
              onClick={async () => {
                setLeaving(true);
                try {
                  await api.post('/auth/logout').catch(() => {});
                } finally {
                  setTokens(null);
                  forget();
                  window.location.reload();
                }
              }}
            >
              <LogOut aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
