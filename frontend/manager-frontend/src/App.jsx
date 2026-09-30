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
import Login from './pages/Login/Login';
import { api, getToken } from './api/client';
import './App.scss';

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

  if (me === undefined) return null;
  if (!me) return <Login onDone={check} />;

  const admin = me.role === 'admin';
  const accountsAllowed = admin || me.role === 'manager';
  const home = me.role === 'voice' ? '/voice' : '/';

  return (
    <Routes>
      <Route path="/" element={me.role === 'voice' ? <Navigate to="/voice" replace /> : <Dashboard />} />
      <Route path="/conversation/:id" element={me.role === 'voice' ? <Navigate to={home} replace /> : <ConversationPage />} />
      <Route path="/voice" element={<Suspense fallback={<p role="status">Загружаем…</p>}><VoiceWork /></Suspense>} />
      <Route path="/leads" element={me.role === 'voice' ? <Navigate to={home} replace /> : <Leads />} />
      <Route path="/accounts" element={accountsAllowed ? <Accounts /> : <Navigate to={home} replace />} />
      <Route path="/managers" element={admin ? <Managers /> : <Navigate to={home} replace />} />
      <Route path="/personas" element={admin ? <Personas /> : <Navigate to={home} replace />} />
      <Route path="/stats" element={admin ? <Stats /> : <Navigate to={home} replace />} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}

export default App;
