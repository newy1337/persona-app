import { useState } from 'react';
import { setVkSession } from '../../api/accounts';
import { parseVkCookies } from '../../utils/vkCookies';
import s from '../../styles/AdminPage.module.scss';

/**
 * Куки VK: войдите в аккаунт в браузере (через тот же прокси), выгрузите куки vk.ru
 * расширением Cookie-Editor («Export → JSON») или скопируйте заголовок Cookie из DevTools.
 */
export function VkCookieFields({ cookies, userAgent, parsed, onCookies, onUserAgent }) {
  async function fromFile(file) {
    if (file) onCookies(await file.text());
  }
  return (
    <>
      <label className={`${s.label} ${s.formFull}`}>
        Куки vk.ru — выгрузка Cookie-Editor (JSON) или строка Cookie из DevTools
        <textarea className={`${s.field} ${s.mono}`} rows={4} value={cookies}
          onChange={(e) => onCookies(e.target.value)}
          placeholder={'[{"name":"remixsid","value":"…","domain":".vk.ru"}, …]  или  remixsid=…; remixlang=0'} />
      </label>
      <label className={s.label}>
        Или файлом
        <input className={s.field} type="file" accept=".json,.txt,application/json,text/plain"
          onChange={(e) => fromFile(e.target.files?.[0])} />
      </label>
      <label className={s.label}>
        User-Agent браузера входа (необязательно)
        <input className={s.field} value={userAgent} onChange={(e) => onUserAgent(e.target.value)}
          placeholder="Mozilla/5.0 … Chrome/151 …" />
      </label>
      {parsed && !parsed.ok && <p className={`${s.error} ${s.formFull}`} style={{ justifyContent: 'flex-start' }}>{parsed.error}</p>}
      {parsed?.ok && <p className={`${s.hint} ${s.formFull}`} style={{ margin: 0 }}>Кук VK: {parsed.cookies.length}, сессия есть.</p>}
    </>
  );
}

/** «Войти» у VK-аккаунта: новые куки вместо мастера Telegram. */
export default function VkSessionDialog({ account, onClose }) {
  const [cookies, setCookies] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const parsed = cookies.trim() ? parseVkCookies(cookies) : null;

  async function submit(e) {
    e.preventDefault();
    if (busy || !parsed?.ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await setVkSession(account.id, parsed.cookies, userAgent.trim());
      if (r?.connect_error) {
        setError(`Куки сохранены, но аккаунт не подключился: ${r.connect_error}`);
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
        <h3 className={s.modalTitle}>Вход VK: {account.login || account.phone_e164}</h3>
        <p className={s.modalText}>
          Войдите в этот аккаунт в браузере через прокси аккаунта и вставьте куки vk.ru — пароль не нужен.
          После сохранения аккаунт переподключится.
        </p>
        <VkCookieFields cookies={cookies} userAgent={userAgent} parsed={parsed}
          onCookies={setCookies} onUserAgent={setUserAgent} />
        {error && <p className={s.error}>{error}</p>}
        <div className={s.modalActions}>
          <button type="button" className={s.btn} onClick={() => onClose(false)}>Отмена</button>
          <button type="submit" className={s.btnPrimary} disabled={busy || !parsed?.ok}>
            {busy ? 'Подключение…' : 'Сохранить и подключить'}
          </button>
        </div>
      </form>
    </div>
  );
}
