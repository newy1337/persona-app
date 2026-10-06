import { lazy, useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout/AppLayout';
import Login from './pages/Login/Login';
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
  managers: () => import('./pages/Managers/Managers'),
  personas: () => import('./pages/Personas/Personas'),
  stats: () => import('./pages/Stats/Stats'),
  settings: () => import('./pages/Settings/Settings'),
};
const Dashboard = lazy(load.dashboard);
const ConversationPage = lazy(load.conversation);
const VoiceWork = lazy(load.voice);
const Leads = lazy(load.leads);
const Accounts = lazy(load.accounts);
const Managers = lazy(load.managers);
const Personas = lazy(load.personas);
const Stats = lazy(load.stats);
const Settings = lazy(load.settings);

const PAGES_BY_ROLE = {
  voice: ['voice'],
  manager: ['dashboard', 'conversation', 'voice', 'leads', 'accounts'],
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
  const accountsAllowed = admin || role === 'manager';
  const home = voice ? '/voice' : '/';
  const away = <Navigate to={home} replace />;

  return (
    <Routes>
      <Route element={<AppLayout me={me} />}>
        <Route path="/" element={voice ? away : <Dashboard />} />
        <Route path="/conversation/:id" element={voice ? away : <ConversationPage />} />
        <Route path="/voice" element={<VoiceWork />} />
        <Route path="/leads" element={voice ? away : <Leads />} />
        <Route path="/accounts" element={accountsAllowed ? <Accounts /> : away} />
        <Route path="/managers" element={admin ? <Managers /> : away} />
        <Route path="/personas" element={admin ? <Personas /> : away} />
        <Route path="/stats" element={admin ? <Stats /> : away} />
        <Route path="/settings" element={admin ? <Settings /> : away} />
      </Route>
      <Route path="*" element={away} />
    </Routes>
  );
}

export default App;
