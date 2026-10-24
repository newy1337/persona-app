import { lazy, useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout/AppLayout';
import Login from './pages/Login/Login';
import SettingsLayout from './components/SettingsLayout/SettingsLayout';
import { hasSetting, hasTop, menuFor, settingsPath } from './navigation';
import { api, getToken } from './api/client';
import { Skeleton } from '@/components/ui/skeleton';

/* Код страниц подгружается по мере надобности, а после входа — заранее в фоне,
   чтобы переход между разделами не ждал сети. */
const load = {
  dashboard: () => import('./pages/Dashboard'),
  conversation: () => import('./pages/ConversationPage/ConversationPage'),
  voice: () => import('./pages/VoiceWork/VoiceWork'),
  leads: () => import('./pages/Leads/Leads'),
  accounts: () => import('./pages/Accounts/Accounts'),
  photoSets: () => import('./pages/PhotoSets/PhotoSets'),
  buffer: () => import('./pages/Buffer/Buffer'),
  managers: () => import('./pages/Managers/Managers'),
  personas: () => import('./pages/Personas/Personas'),
  stats: () => import('./pages/Stats/Stats'),
  settings: () => import('./pages/Settings/Settings'),
  users: () => import('./pages/Users/Users'),
  catalogs: () => import('./pages/Catalogs/Catalogs'),
};
const Dashboard = lazy(load.dashboard);
const ConversationPage = lazy(load.conversation);
const VoiceWork = lazy(load.voice);
const Leads = lazy(load.leads);
const Accounts = lazy(load.accounts);
const PhotoSets = lazy(load.photoSets);
const Buffer = lazy(load.buffer);
const Managers = lazy(load.managers);
const Personas = lazy(load.personas);
const Stats = lazy(load.stats);
const Settings = lazy(load.settings);
const Users = lazy(load.users);
const Catalogs = lazy(load.catalogs);

const STAFF_PAGES = ['dashboard', 'conversation', 'voice', 'leads', 'accounts', 'photoSets'];
const PAGES_BY_ROLE = {
  voice: ['voice'],
  manager: STAFF_PAGES,
  teamlead: [...STAFF_PAGES, 'buffer'],
  head: [...STAFF_PAGES, 'buffer', 'managers'],
  admin: Object.keys(load),
};

/* Каркас на время проверки входа: шапка той же высоты и место под заголовок,
   чтобы при появлении панели ничего не прыгало. */
function Shell() {
  return (
    <div className="app">
      <div className="h-[var(--header-h)] border-b" />
      <main className="main">
        <div className="container pt-5">
          <Skeleton className="h-8 w-48" />
          <span className="sr-only" role="status">Загружаем…</span>
        </div>
      </main>
    </div>
  );
}

function App() {
  const [me, setMe] = useState(undefined);

  const check = useCallback(() => {
    if (!getToken()) {
      setMe(null);
      return;
    }
    api.get('/auth/me').then(setMe).catch(() => setMe(null));
  }, []);

  useEffect(check, [check]);

  const role = me?.role;
  useEffect(() => {
    if (!role) return undefined;
    const warm = () => (PAGES_BY_ROLE[role] ?? []).forEach((key) => load[key]().catch(() => {}));
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(warm, 1200);
    return () => clearTimeout(t);
  }, [role]);

  if (me === undefined) return <Shell />;
  if (!me) return <Login onDone={check} />;

  const voice = role === 'voice';
  const home = voice ? '/voice' : '/';
  const away = <Navigate to={home} replace />;
  // Страница из верхнего меню или из подвкладки «Настроек»; иначе — домой.
  const top = (key, page) => (hasTop(role, key) ? page : away);
  const setting = (key, page) => (hasSetting(role, key) ? page : away);
  // Старый адрес страницы: открываем её сверху, если она там у роли, иначе ведём в «Настройки».
  const moved = (topKey, settingKey, page) =>
    topKey && hasTop(role, topKey)
      ? page
      : hasSetting(role, settingKey)
        ? <Navigate to={settingsPath(settingKey)} replace />
        : away;
  const firstSetting = menuFor(role).settings[0]?.to;

  return (
    <Routes>
      <Route element={<AppLayout me={me} />}>
        <Route path="/" element={top('dialogs', <Dashboard />)} />
        <Route path="/conversation/:id" element={top('dialogs', <ConversationPage />)} />
        <Route path="/voice" element={top('voice', <VoiceWork />)} />
        <Route path="/leads" element={top('leads', <Leads />)} />
        <Route path="/stats" element={top('stats', <Stats />)} />
        <Route path="/accounts" element={moved('accounts', 'accounts', <Accounts />)} />
        <Route path="/photo-sets" element={moved('photoSets', 'photoSets', <PhotoSets />)} />
        <Route path="/managers" element={moved('managers', 'team', <Managers />)} />
        <Route path="/personas" element={moved(null, 'personas', null)} />
        <Route path="/users" element={moved(null, 'leadget', null)} />
        <Route path="/catalogs" element={moved(null, 'catalogs', null)} />
        <Route path="/buffer" element={moved(null, 'buffer', null)} />
        <Route path="/settings" element={hasTop(role, 'settings') ? <SettingsLayout /> : away}>
          <Route index element={firstSetting ? <Navigate to={firstSetting} replace /> : away} />
          <Route path="accounts" element={setting('accounts', <Accounts />)} />
          <Route path="personas" element={setting('personas', <Personas />)} />
          <Route path="photo-sets" element={setting('photoSets', <PhotoSets />)} />
          <Route path="leadget" element={setting('leadget', <Users />)} />
          <Route path="catalogs" element={setting('catalogs', <Catalogs />)} />
          <Route path="buffer" element={setting('buffer', <Buffer />)} />
          <Route path="team" element={setting('team', <Managers />)} />
          <Route path="general" element={setting('general', <Settings />)} />
          <Route path="*" element={away} />
        </Route>
        <Route path="*" element={away} />
      </Route>
    </Routes>
  );
}

export default App;
