import { PanelUX } from '../../ui/PanelUX';
import { useEffect, useRef, useState } from 'react';
import { getAccountPrivacy, setAccountPrivacy, updateAccount, updateAccountProfile, uploadAccountAvatar } from '../../api/accounts';
import s from '../../styles/AdminPage.module.scss';
import acc from './Accounts.module.scss';
import ClientAvatar from '../../components/ClientAvatar/ClientAvatar';
import { AVATAR_BG } from '../../utils/avatar';

export function splitName(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

export default function EditAccountDialog({ account, personas, onClose }) {
  const initialName = splitName(account.display_name);
  const [profile, setProfile] = useState({ first: initialName.first, last: initialName.last, username: account.username || '' });
  const [avatarUrl, setAvatarUrl] = useState(account.avatar_url);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInput = useRef(null);
  const profileChanged =
    profile.first.trim() !== initialName.first ||
    profile.last.trim() !== initialName.last ||
    profile.username.trim().replace(/^@+/, '') !== (account.username || '');
  const [lastSeen, setLastSeen] = useState({ hidden: null, busy: false, error: null });
  useEffect(() => {
    if (!account.online) return;
    getAccountPrivacy(account.id)
      .then((r) => setLastSeen({ hidden: r.hide_last_seen, busy: false, error: null }))
      .catch((e) => setLastSeen({ hidden: null, busy: false, error: e.detail || e.message }));
  }, [account.id, account.online]);
  const toggleLastSeen = async (hide) => {
    setLastSeen((v) => ({ ...v, busy: true, error: null }));
    try {
      const r = await setAccountPrivacy(account.id, hide);
      setLastSeen({ hidden: r.hide_last_seen, busy: false, error: null });
    } catch (e) {
      setLastSeen((v) => ({ ...v, busy: false, error: e.detail || e.message }));
    }
  };
  const [f, setF] = useState({
    persona_id: account.persona_id,
    purpose: account.purpose || 'prod',
    daily_msg_quota: account.daily_msg_quota ?? '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));
  const personaChanged = f.persona_id !== account.persona_id;
  const quota = String(f.daily_msg_quota).trim();
  const quotaValid = quota === '' || (/^\d+$/.test(quota) && Number(quota) >= 1 && Number(quota) <= 1000);

  async function submit(e) {
    e.preventDefault();
    if (busy || !quotaValid) return;
    setBusy(true);
    setError(null);
    try {
      if (profileChanged) {
        if (!profile.first.trim()) throw new Error('имя в Telegram не может быть пустым');
        await updateAccountProfile(account.id, {
          first_name: profile.first.trim(),
          last_name: profile.last.trim(),
          username: profile.username.trim(),
        });
      }
      const r = await updateAccount(account.id, {
        persona_id: f.persona_id,
        purpose: f.purpose,
        daily_msg_quota: quota === '' ? null : Number(quota),
      });
      onClose(true, r);
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose(avatarUrl !== account.avatar_url)}>
      <form className={s.modal} onSubmit={submit}>
        <h3 className={s.modalTitle}>Аккаунт {account.username ? `@${account.username}` : account.phone_e164}</h3>

        <fieldset className={acc.profileBox} disabled={!account.online || busy}>
          <legend className={acc.profileLegend}>Профиль в Telegram{account.online ? '' : ' — аккаунт не в сети'}</legend>
          <div className={acc.profilePhotoRow}>
            <ClientAvatar
              className={acc.profileAvatar}
              style={{ '--av-bg': AVATAR_BG.purple }}
              src={avatarUrl}
              name={account.display_name || account.username || '?'}
            />
            <input
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setPhotoBusy(true);
                setError(null);
                try {
                  const r = await PanelUX.run(`avatar:${account.id}`, ['Загружаем фото…', 'Фото обновлено'], () => uploadAccountAvatar(account.id, file));
                  setAvatarUrl(r.avatar_url);
                } catch (err) {
                  setError(err.detail || err.message);
                } finally {
                  setPhotoBusy(false);
                }
              }}
            />
            <button type="button" className={s.btnSm} disabled={photoBusy} onClick={() => photoInput.current?.click()}>
              {photoBusy ? 'Загрузка…' : 'Сменить фото'}
            </button>
          </div>
          <div className={acc.profileNames}>
            <label className={s.label}>
              Имя
              <input className={s.field} maxLength={64} value={profile.first} onChange={(e) => setProfile((v) => ({ ...v, first: e.target.value }))} />
            </label>
            <label className={s.label}>
              Фамилия
              <input className={s.field} maxLength={64} placeholder="необязательно" value={profile.last} onChange={(e) => setProfile((v) => ({ ...v, last: e.target.value }))} />
            </label>
          </div>
          <label className={s.label}>
            Юзернейм
            <input
              className={s.field}
              maxLength={33}
              placeholder="без ника"
              value={profile.username}
              onChange={(e) => setProfile((v) => ({ ...v, username: e.target.value }))}
            />
          </label>
          <label className={s.check} title="Настройка приватности Telegram: собеседники не видят, когда аккаунт был в сети">
            <input
              type="checkbox"
              data-testid="hide-last-seen"
              checked={Boolean(lastSeen.hidden)}
              disabled={lastSeen.hidden === null || lastSeen.busy}
              onChange={(e) => toggleLastSeen(e.target.checked)}
            />
            Скрывать «был в сети»{lastSeen.busy ? ' — сохраняю…' : lastSeen.hidden === null && account.online && !lastSeen.error ? ' — загрузка…' : ''}
          </label>
          {lastSeen.error && <p className={s.error} style={{ margin: 0 }}>{lastSeen.error}</p>}
        </fieldset>
        <label className={s.label}>
          Личность
          <select className={s.select} value={f.persona_id} onChange={(e) => set({ persona_id: e.target.value })}>
            {!personas.some((p) => p.slug === account.persona_id) && (
              <option value={account.persona_id}>{account.persona_id} — нет такой личности</option>
            )}
            {personas.map((p) => (
              <option key={p.slug} value={p.slug} disabled={!p.enabled}>
                {p.name} ({p.slug}){p.enabled ? '' : ' — выключена'}
              </option>
            ))}
          </select>
        </label>
        {personaChanged && (
          <p className={s.error} style={{ margin: 0 }}>
            {account.chats > 0
              ? `У аккаунта ${account.chats} диалог(ов) — со следующего сообщения их все поведёт новая личность, с её именем и биографией. `
              : 'Диалогов у аккаунта пока нет. '}
            Лиды, которых он взял под другую личность и ещё не написал, перейдут аккаунтам нужной личности.
          </p>
        )}
        <label className={s.label}>
          Назначение
          <select className={s.select} value={f.purpose} onChange={(e) => set({ purpose: e.target.value })}>
            <option value="prod">prod</option>
            <option value="test">test</option>
          </select>
        </label>
        <label className={s.label}>
          Лимит сообщений/день
          <input
            className={s.field}
            inputMode="numeric"
            placeholder="без лимита"
            value={f.daily_msg_quota}
            onChange={(e) => set({ daily_msg_quota: e.target.value })}
          />
        </label>
        {!quotaValid && <p className={s.error} style={{ margin: 0 }}>Лимит — число от 1 до 1000 или пусто</p>}
        {error && <p className={s.error}>{error}</p>}
        <div className={s.modalActions}>
          <button type="button" className={s.btn} onClick={() => onClose(avatarUrl !== account.avatar_url)}>Отмена</button>
          <button type="submit" className={s.btnPrimary} disabled={busy || !quotaValid}>{busy ? 'Сохранение…' : 'Сохранить'}</button>
        </div>
      </form>
    </div>
  );
}
