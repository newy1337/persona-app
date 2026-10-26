import { useEffect, useId, useRef, useState } from 'react';
import { setVkSession } from '../../api/accounts';
import { parseVkCookies } from '../../utils/vkCookies';
import s from '../../styles/AdminPage.module.scss';
import help from './VkCookieHelp.module.scss';

/** «i» у поля кук: пошаговая инструкция для менеджера, закрывается кликом мимо или Esc. */
function VkCookieHelp() {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span ref={box}>
      <button type="button" className={help.toggle} aria-label="Как получить куки VK" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((v) => !v)}>i</button>
      {open && (
        <div id={id} role="dialog" aria-label="Как получить куки VK" className={help.popup}>
          <h4>Как получить куки VK</h4>
          <ol>
            <li>Войдите в этот VK-аккаунт в обычном браузере — лучше через тот же прокси, что у аккаунта.</li>
            <li>Выгрузите куки сайта vk.ru: расширение Cookie-Editor → «Export» → «JSON». Получится файл .json или текст в буфере.</li>
            <li>Отдайте их панели: вставьте текст в поле или выберите файл кнопкой «Выбрать файл».</li>
          </ol>
          <p>Куки — полный доступ к аккаунту, как логин с паролем. Не пересылайте их в чатах, файл удалите после добавления.</p>
        </div>
      )}
    </span>
  );
}

/**
 * Куки VK: войдите в аккаунт в браузере (через тот же прокси), выгрузите куки vk.ru
 * расширением Cookie-Editor («Export → JSON») или скопируйте заголовок Cookie из DevTools.
 */
export function VkCookieFields({ cookies, userAgent, parsed, onCookies, onUserAgent }) {
  const fieldId = useId();
  async function fromFile(file) {
    if (file) onCookies(await file.text());
  }
  return (
    <>
      <div className={`${s.label} ${s.formFull}`}>
        <span className={help.row}>
          <label htmlFor={fieldId}>Куки vk.ru — выгрузка Cookie-Editor (JSON) или строка Cookie из DevTools</label>
          <VkCookieHelp />
        </span>
        <textarea id={fieldId} className={`${s.field} ${s.mono}`} rows={4} value={cookies}
          onChange={(e) => onCookies(e.target.value)}
          placeholder={'[{"name":"remixsid","value":"…","domain":".vk.ru"}, …]  или  remixsid=…; remixlang=0'} />
      </div>
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
