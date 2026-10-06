import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ConversationPage from './pages/ConversationPage/ConversationPage';
const VoiceWork = lazy(() => import('./pages/VoiceWork/VoiceWork'));
import Accounts from './pages/Accounts/Accounts';
import Managers from './pages/Managers/Managers';
import Leads from './pages/Leads/Leads';
import Personas from './pages/Personas/Personas';
import Stats from './pages/Stats/Stats';
import Settings from './pages/Settings/Settings';
import Login from './pages/Login/Login';
import { api, getToken } from './api/client';
import { Skeleton } from '@/components/ui/skeleton';

/* Каркас страницы на время загрузки: шапка той же высоты и место под заголовок,
   чтобы при появлении данных ничего не прыгало. */
function Shell() {
  return (
    <div className="app">
      <div className="h-[var(--header-h)] border-b" />
      <main className="main">
        <div className="container pt-4">
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

  if (me === undefined) return <Shell />;
  if (!me) return <Login onDone={check} />;

  const admin = me.role === 'admin';
  const accountsAllowed = admin || me.role === 'manager';
  const home = me.role === 'voice' ? '/voice' : '/';

  return (
    <Routes>
      <Route path="/" element={me.role === 'voice' ? <Navigate to="/voice" replace /> : <Dashboard />} />
      <Route path="/conversation/:id" element={me.role === 'voice' ? <Navigate to={home} replace /> : <ConversationPage />} />
      <Route path="/voice" element={<Suspense fallback={<Shell />}><VoiceWork /></Suspense>} />
      <Route path="/leads" element={me.role === 'voice' ? <Navigate to={home} replace /> : <Leads />} />
      <Route path="/accounts" element={accountsAllowed ? <Accounts /> : <Navigate to={home} replace />} />
      <Route path="/managers" element={admin ? <Managers /> : <Navigate to={home} replace />} />
      <Route path="/personas" element={admin ? <Personas /> : <Navigate to={home} replace />} />
      <Route path="/stats" element={admin ? <Stats /> : <Navigate to={home} replace />} />
      <Route path="/settings" element={admin ? <Settings /> : <Navigate to={home} replace />} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}

export default App;
