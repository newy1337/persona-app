import { AccountsTable } from '../../ui/ManagerRegion';
import { PanelUX } from '../../ui/PanelUX';
import { useCallback, useEffect, useState } from 'react';
import Header from '../../components/Header/Header';
import {
  addAccount,
  deleteAccount,
  getAccounts,
  clearAccountFlood,
  getLiveState,
  setAccountStatus,
} from '../../api/accounts';
import AuthWizard from './AuthWizard';
import EditAccountDialog from './EditAccountDialog';
import { getPersonas } from '../../api/personas';
import { getLeadPersonas } from '../../api/leads';
import ProxyDialog, { EMPTY_PROXY, ProxyFields, proxyPayload, proxyValid } from './ProxyDialog';
import s from '../../styles/AdminPage.module.scss';
import ClientAvatar from '../../components/ClientAvatar/ClientAvatar';

const STATUS_LABEL = {
  unauthorized: 'нет сессии',
  active: 'активен',
  paused: 'пауза',
  banned: 'бан Telegram',
  retired: 'выведен',
};

export function accountStatusLabel(a) {
  if (a.status === 'unauthorized' && a.lost_at) return 'сессия завершена';
  return STATUS_LABEL[a.status] ?? a.status;
}
const BADGE = {
  unauthorized: s.badgeUnauthorized,
  active: s.badgeActive,
  paused: s.badgePaused,
  banned: s.badgeBanned,
  retired: s.badgeRetired,
};

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const EMPTY_FORM = { phone_e164: '', persona_id: 'nastya', purpose: 'prod', daily_msg_quota: '', withProxy: false, proxy: EMPTY_PROXY };

function AddForm({ personas, onDone, onCancel }) {
  const [f, setF] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));
  const valid = /^\+?\d{10,15}$/.test(f.phone_e164.trim()) && f.persona_id.trim() && (!f.withProxy || proxyValid(f.proxy));

  async function submit(e) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await addAccount({
        phone_e164: f.phone_e164.trim(),
        persona_id: f.persona_id.trim(),
        purpose: f.purpose,
        daily_msg_quota: f.daily_msg_quota ? Number(f.daily_msg_quota) : null,
        proxy_config: f.withProxy ? proxyPayload(f.proxy) : null,
      });
      onDone();
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={submit}>
      <label className={s.label}>
        Телефон (E.164)
        <input className={s.field} autoFocus placeholder="+79001234567" value={f.phone_e164} onChange={(e) => set({ phone_e164: e.target.value })} />
      </label>
      <label className={s.label}>
        Личность
        <select className={s.select} value={f.persona_id} onChange={(e) => set({ persona_id: e.target.value })}>
          {!personas.some((p) => p.slug === f.persona_id) && <option value={f.persona_id}>{f.persona_id}</option>}
          {personas.filter((p) => p.enabled).map((p) => (
            <option key={p.slug} value={p.slug}>{p.name} ({p.slug})</option>
          ))}
        </select>
      </label>
      <label className={s.label}>
        Назначение
        <select className={s.select} value={f.purpose} onChange={(e) => set({ purpose: e.target.value })}>
          <option value="prod">prod</option>
          <option value="test">test</option>
        </select>
      </label>
      <label className={s.label}>
        Лимит сообщений/день
        <input className={s.field} inputMode="numeric" placeholder="без лимита" value={f.daily_msg_quota} onChange={(e) => set({ daily_msg_quota: e.target.value })} />
      </label>
      <label className={`${s.check} ${s.label}`} style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'end' }}>
        <input type="checkbox" checked={f.withProxy} onChange={(e) => set({ withProxy: e.target.checked })} />
        Задать прокси сразу
      </label>
      {f.withProxy && <ProxyFields value={f.proxy} onChange={(proxy) => set({ proxy })} />}
      {error && <p className={`${s.error} ${s.formFull}`} style={{ justifyContent: 'flex-start' }}>{error}</p>}
      <div className={s.formFull}>
        <button type="button" className={s.btn} onClick={onCancel}>Отмена</button>
        <button type="submit" className={s.btnPrimary} disabled={busy || !valid}>{busy ? 'Добавление…' : 'Добавить'}</button>
      </div>
    </form>
  );
}

export default function Accounts() {
  const [items, setItems] = useState([]);
  const [online, setOnline] = useState({});
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [auth, setAuth] = useState(null);
  const [proxyFor, setProxyFor] = useState(null);
  const [editing, setEditing] = useState(null);
  const [flash, setFlash] = useState(null);
  const [personas, setPersonas] = useState([]);

  useEffect(() => {
    getPersonas()
      .then((r) => setPersonas(r.items ?? []))
      .catch(() =>
        getLeadPersonas()
          .then((r) => setPersonas((r.items ?? []).map((p) => ({ ...p, enabled: true }))))
          .catch(() => setPersonas([])),
      );
  }, []);

  const load = useCallback(() => {
    Promise.all([getAccounts(), getLiveState().catch(() => null)])
      .then(([list, state]) => {
        setItems(list);
        const map = {};
        for (const a of state?.tg_accounts ?? []) map[a.id] = Boolean(a.alive);
        setOnline(map);
      })
      .catch((e) => setError(e.detail || e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 10000);
    return () => clearInterval(t);
  }, [load]);

  async function run(fn) {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e.detail || e.message);
    }
  }

  async function remove(a) {
    if (!await PanelUX.confirm({ title: 'Удалить аккаунт?', message: `Аккаунт ${a.phone_e164}. Сессия будет стёрта, чаты останутся.`, confirmLabel: 'Удалить', danger: true })) return;
    run(() => deleteAccount(a.id));
  }

  return (
    <div className="app mr-accounts">
      <Header />
      <main className="main">
        <div className="container">
          <div className={s.head}>
            <h2 className={s.title}>Telegram-аккаунты</h2>
            {!adding && <button className={s.btnPrimary} onClick={() => setAdding(true)}>+ Добавить аккаунт</button>}
          </div>
          {adding && <AddForm personas={personas} onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
          {error && <p className={s.error}>{error}</p>}
          {flash && <p className={s.ok} style={{ margin: '0 0 12px', fontSize: 13 }}>{flash}</p>}

          <AccountsTable rows={items} alive={online} onEdit={setEditing} onLogin={setAuth}
            onProxy={setProxyFor} onStatus={(row, status) => run(() => setAccountStatus(row.id, status, 'operator:web'))}
            onClearFlood={row => run(() => clearAccountFlood(row.id))} onDelete={remove}
            helpers={{ Avatar: ClientAvatar, statusLabel: accountStatusLabel, statusClasses: BADGE, date: fmtTs }} />
        </div>
      </main>

      {auth && <AuthWizard account={auth} onClose={() => { setAuth(null); load(); }} />}
      {proxyFor && <ProxyDialog account={proxyFor} onClose={() => { setProxyFor(null); load(); }} />}
      {editing && (
        <EditAccountDialog
          account={editing}
          personas={personas}
          onClose={(saved, r) => {
            setEditing(null);
            if (saved && r) {
              const released = r.released_leads ? `, ${r.released_leads} лид(ов) переданы аккаунтам нужной личности` : '';
              setFlash(`Аккаунт #${r.id} сохранён: личность ${r.persona_name ?? r.persona_id}${released}`);
            }
            load();
          }}
        />
      )}
    </div>
  );
}
