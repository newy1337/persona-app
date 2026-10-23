import { lazy, useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout/AppLayout';
import { MeContext } from './components/AppLayout/me';
import Dashboard from './pages/Dashboard';
import ConversationPage from './pages/ConversationPage/ConversationPage';
import Accounts from './pages/Accounts/Accounts';
import Managers from './pages/Managers/Managers';
import Leads from './pages/Leads/Leads';
import Personas from './pages/Personas/Personas';
import Stats from './pages/Stats/Stats';
import Settings from './pages/Settings/Settings';
import Login from './pages/Login/Login';
import { isManagerRole } from './utils/roles';
import { PanelUX } from './ui/PanelUX';
import { api, getToken } from './api/client';
import './App.scss';

const VoiceWork = lazy(() => import('./pages/VoiceWork/VoiceWork'));
const PhotoSets = lazy(() => import('./pages/PhotoSets/PhotoSets'));
const Users = lazy(() => import('./pages/Users/Users'));
const Catalogs = lazy(() => import('./pages/Catalogs/Catalogs'));
const Buffer = lazy(() => import('./pages/Buffer/Buffer'));

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
  if (!me)
    return (
      <>
        <Login onDone={check} />
        <PanelUX.FeedbackHost />
      </>
    );

  const admin = me.role === 'admin';
  const voice = me.role === 'voice';
  const accountsAllowed = admin || isManagerRole(me.role);
  const home = voice ? '/voice' : '/';
  const only = (allowed, page) => (allowed ? page : <Navigate to={home} replace />);

  return (
    <MeContext.Provider value={me}>
      {/* Всплывашки результатов действий справа — не для админа. */}
      <PanelUX.FeedbackHost notices={!admin} />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={only(!voice, <Dashboard />)} />
          <Route path="/conversation/:id" element={only(!voice, <ConversationPage />)} />
          <Route path="/voice" element={<VoiceWork />} />
          <Route path="/leads" element={only(!voice, <Leads />)} />
          <Route path="/accounts" element={only(accountsAllowed, <Accounts />)} />
          <Route path="/photo-sets" element={only(accountsAllowed, <PhotoSets />)} />
          <Route path="/buffer" element={only(['admin', 'head', 'teamlead'].includes(me.role), <Buffer />)} />
          <Route path="/managers" element={only(admin || me.role === 'head', <Managers />)} />
          <Route path="/personas" element={only(admin, <Personas />)} />
          <Route path="/stats" element={only(admin, <Stats />)} />
          <Route path="/settings" element={only(admin, <Settings />)} />
          <Route path="/users" element={only(admin, <Users />)} />
          <Route path="/catalogs" element={only(admin, <Catalogs />)} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Route>
      </Routes>
    </MeContext.Provider>
  );
}

export default App;
