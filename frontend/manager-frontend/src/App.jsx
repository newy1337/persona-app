import { lazy, useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout/AppLayout';
import Login from './pages/Login/Login';
import { isManagerRole } from './utils/roles';
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

  const admin = role === 'admin';
  const voice = role === 'voice';
  const accountsAllowed = admin || isManagerRole(role);
  const home = voice ? '/voice' : '/';
  const only = (allowed, page) => (allowed ? page : <Navigate to={home} replace />);

  return (
    <Routes>
      <Route element={<AppLayout me={me} />}>
        <Route path="/" element={only(!voice, <Dashboard />)} />
        <Route path="/conversation/:id" element={only(!voice, <ConversationPage />)} />
        <Route path="/voice" element={<VoiceWork />} />
        <Route path="/leads" element={only(!voice, <Leads />)} />
        <Route path="/accounts" element={only(accountsAllowed, <Accounts />)} />
        <Route path="/photo-sets" element={only(accountsAllowed, <PhotoSets />)} />
        <Route path="/buffer" element={only(['admin', 'head', 'teamlead'].includes(role), <Buffer />)} />
        <Route path="/managers" element={only(admin || role === 'head', <Managers />)} />
        <Route path="/personas" element={only(admin, <Personas />)} />
        <Route path="/stats" element={only(admin, <Stats />)} />
        <Route path="/settings" element={only(admin, <Settings />)} />
        <Route path="/users" element={only(admin, <Users />)} />
        <Route path="/catalogs" element={only(admin, <Catalogs />)} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}

export default App;
