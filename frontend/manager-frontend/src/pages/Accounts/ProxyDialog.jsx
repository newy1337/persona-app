import { useState } from 'react';
import { setAccountProxy } from '../../api/accounts';
import { parseProxyLine } from '../../utils/proxyLine';
import s from '../../styles/AdminPage.module.scss';

export const EMPTY_PROXY = { type: 'socks5', host: '', port: '', username: '', password: '', secret: '' };
export const EMPTY_VK_PROXY = { ...EMPTY_PROXY, type: 'http' };

/** Типы прокси по каналу аккаунта: Telegram и VK принимают разные. */
export const PROXY_TYPES = {
  telegram: [['socks5', 'SOCKS5'], ['mtproto', 'MTProto'], ['socks4', 'SOCKS4']],
  vk: [['http', 'HTTP'], ['https', 'HTTPS'], ['socks5', 'SOCKS5']],
};
const typesFor = (channel) => PROXY_TYPES[channel === 'vk' ? 'vk' : 'telegram'];

export function proxyPayload(p) {
  return {
    type: p.type,
    host: p.host.trim(),
    port: Number(p.port),
    username: p.username || null,
    password: p.password || null,
    secret: p.type === 'mtproto' ? p.secret || null : null,
  };
}

export function ProxyFields({ value, onChange, channel = 'telegram' }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const [line, setLine] = useState('');
  const [parsed, setParsed] = useState(null);

  const applyLine = (text) => {
    setLine(text);
    if (!text.trim()) {
      setParsed(null);
      return;
    }
    const r = parseProxyLine(text, { channel });
    setParsed(r);
    if (r.ok) onChange({ ...EMPTY_PROXY, ...r.proxy });
  };

  return (
    <>
      <label className={s.label}>
        Одной строкой
        <input
          className={`${s.field} ${s.mono}`}
          value={line}
          onChange={(e) => applyLine(e.target.value)}
          placeholder={channel === 'vk' ? 'хост:порт:логин:пароль или http://логин:пароль@хост:порт' : '1.2.3.4:1080:логин:пароль или socks5://логин:пароль@хост:порт'}
          autoFocus
        />
      </label>
      {parsed && !parsed.ok && <p className={s.error}>Не разобрал: {parsed.error}</p>}
      {parsed?.ok && (
        <p className={s.hint} style={{ margin: 0 }}>
          Распознано: {parsed.proxy.type.toUpperCase()} {parsed.proxy.host}:{parsed.proxy.port}
          {parsed.proxy.username ? ` · логин ${parsed.proxy.username}` : ''} — проверьте поля ниже
        </p>
      )}
      <label className={s.label}>
        Тип
        <select className={s.select} value={value.type} onChange={(e) => set({ type: e.target.value })}>
          {typesFor(channel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label className={s.label}>
        Хост
        <input className={s.field} value={value.host} onChange={(e) => set({ host: e.target.value })} placeholder="1.2.3.4" />
      </label>
      <label className={s.label}>
        Порт
        <input className={s.field} inputMode="numeric" value={value.port} onChange={(e) => set({ port: e.target.value })} placeholder="1080" />
      </label>
      {value.type === 'mtproto' ? (
        <label className={s.label}>
          Secret
          <input className={s.field} value={value.secret} onChange={(e) => set({ secret: e.target.value })} />
        </label>
      ) : (
        <>
          <label className={s.label}>
            Логин
            <input className={s.field} value={value.username} onChange={(e) => set({ username: e.target.value })} />
          </label>
          <label className={s.label}>
            Пароль
            <input className={s.field} type="password" value={value.password} onChange={(e) => set({ password: e.target.value })} />
          </label>
        </>
      )}
    </>
  );
}

export function proxyValid(p, channel = 'telegram') {
  const port = Number(p.port);
  return (
    typesFor(channel).some(([key]) => key === p.type)
    && p.host.trim()
    && Number.isInteger(port) && port > 0 && port < 65536
    && (p.type !== 'mtproto' || p.secret)
  );
}

export default function ProxyDialog({ account, onClose }) {
  const channel = account.channel === 'vk' ? 'vk' : 'telegram';
  const [proxy, setProxy] = useState(channel === 'vk' ? EMPTY_VK_PROXY : EMPTY_PROXY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy || !proxyValid(proxy, channel)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await setAccountProxy(account.id, proxyPayload(proxy));
      if (r?.reconnect_error) {
        setError(`Прокси сохранён, но аккаунт через него не подключился: ${r.reconnect_error}`);
        return;
      }
      onClose(true);
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <form className={s.modal} onSubmit={submit}>
        <h3 className={s.modalTitle}>Прокси: {account.login || account.phone_e164}</h3>
        {account.proxy_label && (
          <p className={s.modalText}>Сейчас: <span className={s.mono}>{account.proxy_label}</span> — новый заменит его.</p>
        )}
        <p className={s.modalText}>
          После сохранения аккаунт переподключится через этот прокси. Не подключится — будет видно по статусу «онлайн».
        </p>
        <ProxyFields value={proxy} onChange={setProxy} channel={channel} />
        {error && <p className={s.error}>{error}</p>}
        <div className={s.modalActions}>
          <button type="button" className={s.btn} onClick={() => onClose(false)}>Отмена</button>
          <button type="submit" className={s.btnPrimary} disabled={busy || !proxyValid(proxy, channel)}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  );
}
