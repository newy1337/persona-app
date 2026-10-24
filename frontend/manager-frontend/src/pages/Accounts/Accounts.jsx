import TableSkeleton from '../../components/TableSkeleton/TableSkeleton';
import { AccountsTable } from '../../ui/ManagerRegion';
import { PanelUX } from '../../ui/PanelUX';
import { useCallback, useEffect, useState } from 'react';
import {
  addAccount,
  addVkAccount,
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
import ProxyDialog, { EMPTY_PROXY, EMPTY_VK_PROXY, ProxyFields, proxyPayload, proxyValid } from './ProxyDialog';
import VkSessionDialog, { VkCookieFields } from './VkSessionDialog';
import { CHANNEL_FILTERS, channelKey, matchesChannel } from '../../utils/channel';
import { parseVkCookies } from '../../utils/vkCookies';
import s from '../../styles/AdminPage.module.scss';
import ClientAvatar from '../../components/ClientAvatar/ClientAvatar';
import { setAccountPhotoAutoSend } from '../../api/photoSets';

const STATUS_LABEL = {
  unauthorized: 'нет сессии',
  active: 'активен',
  paused: 'пауза',
  banned: 'бан',
  retired: 'выведен',
};

export function accountStatusLabel(a) {
  if (a.status === 'unauthorized' && a.lost_at) return 'сессия завершена';
  if (a.status === 'banned') return channelKey(a.channel) === 'vk' ? 'бан VK' : 'бан Telegram';
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

const EMPTY_FORM = {
  channel: 'telegram', phone_e164: '', login: '', cookies: '', user_agent: '',
  persona_id: 'nastya', purpose: 'prod', daily_msg_quota: '', withProxy: false, proxy: EMPTY_PROXY,
};

/** Выбор мессенджера — как в Chutter: переключатель над формой, поля под канал. */
function ChannelSwitch({ value, onChange }) {
  return (
    <div className={`${s.label} ${s.formFull}`} role="radiogroup" aria-label="Мессенджер">
      Мессенджер
      <div className="mr-channel-switch">
        {[['telegram', 'Telegram'], ['vk', 'ВКонтакте']].map(([key, title]) => (
          <button key={key} type="button" role="radio" aria-checked={value === key} data-channel={key}
            className={`mr-channel-option ${value === key ? 'mr-channel-option-on' : ''}`}
            onClick={() => onChange(key)}>{title}</button>
        ))}
      </div>
    </div>
  );
}

function AddForm({ personas, onDone, onCancel }) {
  const [f, setF] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));
  const vk = f.channel === 'vk';
  // VK: токен привязан к выходному IP — без прокси аккаунт не живёт, поэтому прокси обязателен.
  const withProxy = vk || f.withProxy;
  const cookies = vk ? parseVkCookies(f.cookies) : null;
  const valid = f.persona_id.trim()
    && (vk ? f.login.trim().length >= 3 && cookies.ok : /^\+?\d{10,15}$/.test(f.phone_e164.trim()))
    && (!withProxy || proxyValid(f.proxy, f.channel));

  function switchChannel(channel) {
    set({ channel, proxy: channel === 'vk' ? EMPTY_VK_PROXY : EMPTY_PROXY, withProxy: false });
    setError(null);
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    const common = {
      persona_id: f.persona_id.trim(),
      purpose: f.purpose,
      daily_msg_quota: f.daily_msg_quota ? Number(f.daily_msg_quota) : null,
    };
    try {
      if (vk) {
        const r = await addVkAccount({
          ...common,
          login: f.login.trim(),
          cookies: cookies.cookies,
          user_agent: f.user_agent.trim() || undefined,
          proxy_config: proxyPayload(f.proxy),
        });
        if (r?.connect_error) {
          // Аккаунт уже создан: форму закрываем, причину показываем на странице.
          onDone({ warning: `VK-аккаунт ${r.login} добавлен, но не подключился: ${r.connect_error}. Проверьте прокси или обновите куки («Войти»).` });
          return;
        }
      } else {
        await addAccount({
          ...common,
          phone_e164: f.phone_e164.trim(),
          proxy_config: f.withProxy ? proxyPayload(f.proxy) : null,
        });
      }
      onDone();
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={submit}>
      <ChannelSwitch value={f.channel} onChange={switchChannel} />
      {vk ? (
        <label className={s.label}>
          Логин VK (номер или почта)
          <input className={s.field} autoFocus placeholder="+79001234567" value={f.login} onChange={(e) => set({ login: e.target.value })} />
        </label>
      ) : (
        <label className={s.label}>
          Телефон (E.164)
          <input className={s.field} autoFocus placeholder="+79001234567" value={f.phone_e164} onChange={(e) => set({ phone_e164: e.target.value })} />
        </label>
      )}
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
      {vk && (
        <VkCookieFields cookies={f.cookies} userAgent={f.user_agent} parsed={f.cookies.trim() ? cookies : null}
          onCookies={(text) => set({ cookies: text })} onUserAgent={(text) => set({ user_agent: text })} />
      )}
      {!vk && (
        <label className={`${s.check} ${s.label}`} style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'end' }}>
          <input type="checkbox" checked={f.withProxy} onChange={(e) => set({ withProxy: e.target.checked })} />
          Задать прокси сразу
        </label>
      )}
      {vk && <p className={`${s.hint} ${s.formFull}`} style={{ margin: 0 }}>Прокси обязателен: токен VK привязан к адресу. Нужен HTTP, HTTPS или SOCKS5, лучше липкий (один IP).</p>}
      {withProxy && <ProxyFields key={f.channel} value={f.proxy} onChange={(proxy) => set({ proxy })} channel={f.channel} />}
      {error && <p className={`${s.error} ${s.formFull}`} style={{ justifyContent: 'flex-start' }}>{error}</p>}
      <div className={s.formFull}>
        <button type="button" className={s.btn} onClick={onCancel}>Отмена</button>
        <button type="submit" className={s.btnPrimary} disabled={busy || !valid}>
          {busy ? (vk ? 'Подключение…' : 'Добавление…') : vk ? 'Добавить и подключить' : 'Добавить'}
        </button>
      </div>
    </form>
  );
}

export default function Accounts() {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState({});
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [auth, setAuth] = useState(null);
  const [proxyFor, setProxyFor] = useState(null);
  const [editing, setEditing] = useState(null);
  const [flash, setFlash] = useState(null);
  const [personas, setPersonas] = useState([]);
  const [channel, setChannel] = useState('all');
  const [vkSession, setVkSession] = useState(null);
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
      .catch((e) => setError(e.detail || e.message))
      .finally(() => setReady(true));
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
    if (!await PanelUX.confirm({ title: 'Удалить аккаунт?', message: `Аккаунт ${a.login || a.phone_e164}. Сессия будет стёрта, чаты останутся.`, confirmLabel: 'Удалить', danger: true })) return;
    run(() => deleteAccount(a.id));
  }

  return (
    <div className="mr-accounts">
          <div className={s.head}>
            <h2 className={s.title}>Аккаунты</h2>
            {items.length > 0 && (
              <div className="mr-channel-switch" role="radiogroup" aria-label="Фильтр канала">
                {CHANNEL_FILTERS.map(([key, title]) => (
                  <button key={key} type="button" role="radio" aria-checked={channel === key}
                    data-channel={key === 'all' ? undefined : key}
                    className={`mr-channel-option ${channel === key ? 'mr-channel-option-on' : ''}`}
                    onClick={() => setChannel(key)}>
                    {title} ({items.filter((a) => matchesChannel(a, key)).length})
                  </button>
                ))}
              </div>
            )}
            {!adding && <button type="button" className={s.btnPrimary} onClick={() => setAdding(true)}>Добавить аккаунт</button>}
          </div>
          {adding && <AddForm personas={personas} onDone={(o) => { setAdding(false); if (o?.warning) setError(o.warning); load(); }} onCancel={() => setAdding(false)} />}
          {error && <p className={s.error}>{error}</p>}
          {flash && <p className={s.ok} style={{ margin: '0 0 12px', fontSize: 13 }}>{flash}</p>}

          <p className={s.hint}>Образ аккаунта задаёт хед региона на странице «Образы» — по личности аккаунта.</p>
          {!ready && items.length === 0 ? <TableSkeleton rows={6} label="Загружаем аккаунты…" /> : <AccountsTable rows={items.filter((a) => matchesChannel(a, channel))} alive={online} onEdit={setEditing}
            onLogin={(row) => (channelKey(row.channel) === 'vk' ? setVkSession(row) : setAuth(row))}
            onPhotoAutoSend={(row, enabled) => run(() => setAccountPhotoAutoSend(row.id, enabled))}
            onProxy={setProxyFor} onStatus={(row, status) => run(() => setAccountStatus(row.id, status, 'operator:web'))}
            onClearFlood={row => run(() => clearAccountFlood(row.id))} onDelete={remove}
            helpers={{ Avatar: ClientAvatar, statusLabel: accountStatusLabel, statusClasses: BADGE, date: fmtTs }} />}

      {auth && <AuthWizard account={auth} onClose={() => { setAuth(null); load(); }} />}
      {proxyFor && <ProxyDialog account={proxyFor} onClose={() => { setProxyFor(null); load(); }} />}
      {vkSession && <VkSessionDialog account={vkSession} onClose={() => { setVkSession(null); load(); }} />}
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
