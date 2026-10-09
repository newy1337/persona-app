import { useState, useRef, useEffect } from 'react';
import { api, setTokens } from '../../api/client';
import { getStats } from '../../api/stats';
import { Link, NavLink } from 'react-router-dom';
import styles from './Header.module.scss';
import VoiceNotifications from './VoiceNotifications';
import {
  LogoChatIcon,
  LiveUsersIcon,
  SearchIcon,
  FiltersIcon,
  ChevronDownIcon,
  UserAvatarIcon,
  LogoutIcon,
} from '../../assets/icons';

function FiltersDropdown({ value, onChange, accounts }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const pill = (active) =>
    `${styles.dropdownOption} ${active ? styles.dropdownOptionActive : ''}`;
  const active = Boolean(value.lead || value.account);

  return (
    <div className={styles.dropdown}>
      <div className={styles.dropdownHeader}>
        <span className={styles.dropdownTitle}>Фильтры</span>
        {active && (
          <button
            className={styles.dropdownClear}
            onClick={() => onChange({ lead: '', account: '' })}
          >
            Сбросить
          </button>
        )}
      </div>

      <div className={styles.dropdownGroup}>
        <span className={styles.dropdownGroupLabel}>Ведёт</span>
        <div className={styles.dropdownOptions}>
          {[
            { key: '', label: 'любой' },
            { key: 'bot', label: 'бот' },
            { key: 'manager', label: 'менеджер' },
          ].map((o) => (
            <button
              key={o.key || 'any'}
              className={pill(value.lead === o.key)}
              onClick={() => set({ lead: o.key })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.dropdownGroup}>
        <span className={styles.dropdownGroupLabel}>Аккаунт</span>
        <div className={styles.dropdownOptions}>
          <button
            className={pill(value.account === '')}
            onClick={() => set({ account: '' })}
          >
            любой
          </button>
          {accounts.map((a) => (
            <button
              key={a}
              className={pill(value.account === String(a))}
              onClick={() => set({ account: String(a) })}
            >
              #{a}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const navClass = ({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`;

function Header({
  liveCount,
  query = '',
  onQueryChange,
  filters = { lead: '', account: '' },
  onFiltersChange,
  accounts = [],
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [me, setMe] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [ownLive, setOwnLive] = useState(null);
  const searchable = typeof onQueryChange === 'function';
  const filtersRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api.get('/auth/me').then(setMe).catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (liveCount !== undefined || !me || me.role === 'voice') return undefined;
    const pull = () => getStats().then((s) => setOwnLive(s?.active_now ?? 0)).catch(() => {});
    pull();
    const t = setInterval(() => document.visibilityState === 'visible' && pull(), 30000);
    return () => clearInterval(t);
  }, [liveCount, me]);
  const live = liveCount ?? ownLive;

  useEffect(() => {
    function handleClickOutside(e) {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) {
        setFiltersOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <div className={styles.left}>
          <Link to="/" className={styles.logo}>
          <span className={styles.logoIcon}>
            <LogoChatIcon />
          </span>
            <span className={styles.logoText}>
            BestChat
            <span className={styles.logoDescription}>AI PLATFORM</span>
          </span>
          </Link>

          <span className={styles.separator}></span>

          {live !== null && (
            <div className={styles.livePill} title="Диалогов с сообщениями за последние сутки">
              <span className={styles.liveDot}></span>
              <span className={styles.liveLabel}>LIVE</span>
              <span className={styles.liveCount}>{live}</span>
              <span className={styles.liveIcon}><LiveUsersIcon /></span>
            </div>
          )}
        </div>

        {me && (
          <nav className={styles.nav}>
            {me.role !== 'voice' && <NavLink to="/" end className={navClass}>Диалоги</NavLink>}
            {me.role !== 'voice' && <NavLink to="/leads" className={navClass}>Лиды</NavLink>}
            <NavLink to="/voice" className={navClass}>Войсер</NavLink>
            {me.role === 'admin' && <NavLink to="/personas" className={navClass}>Личности</NavLink>}
            {(me.role === 'admin' || me.role === 'manager') && <NavLink to="/accounts" className={navClass}>Аккаунты</NavLink>}
            {me.role === 'admin' && <NavLink to="/managers" className={navClass}>Менеджеры</NavLink>}
            {me.role === 'admin' && <NavLink to="/stats" className={navClass}>Статистика</NavLink>}
            {me.role === 'admin' && <NavLink to="/settings" className={navClass}>Настройки</NavLink>}
          </nav>
        )}

        {searchable && (
          <div className={styles.center}>
            <div className={styles.search}>
              <span className={styles.searchIcon}><SearchIcon /></span>
              <input
                className={styles.searchInput}
                type="text"
                placeholder="Имя, номер, город, chat_id…"
                value={query}
                onChange={(e) => onQueryChange?.(e.target.value)}
                aria-label="Поиск по диалогам"
              />
            </div>

            <div className={styles.filtersWrap} ref={filtersRef}>
              <button
                className={`${styles.filtersBtn} ${filtersOpen ? styles.filtersBtnActive : ''}`}
                onClick={() => setFiltersOpen((v) => !v)}
              >
                <FiltersIcon />
                <span>Фильтры{(filters.lead || filters.account) ? ' •' : ''}</span>
                <ChevronDownIcon
                  width="14"
                  height="14"
                  strokeWidth="1.5"
                  className={`${styles.chevron} ${filtersOpen ? styles.chevronUp : ''}`}
                />
              </button>
              {filtersOpen && (
                <FiltersDropdown
                  value={filters}
                  onChange={onFiltersChange ?? (() => {})}
                  accounts={accounts}
                />
              )}
            </div>
          </div>
        )}

        <div className={styles.right}>
          {me && ['manager', 'admin'].includes(me.role) && <VoiceNotifications key={me.id} userId={me.id} />}
          <div className={styles.timeBlock}>
            <span className={styles.timeValue}>{now.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК</span>
            <span className={styles.timeDate}>{now.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>

          <span className={styles.separator}></span>

          <div className={styles.user}>
            <div className={styles.userInfo}>
              <span className={styles.userName}>{me?.username || '—'}</span>
              <span className={styles.userRole}>{me?.role || ''}</span>
            </div>
            <div className={styles.avatar}>
              <UserAvatarIcon />
              <span className={styles.avatarStatus}></span>
            </div>
            <button
              className={styles.logout}
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
              <LogoutIcon />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;