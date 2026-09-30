import { useState } from 'react';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import s from '../../styles/AdminPage.module.scss';

export function VoiceBotLink({ userId, linked = false, onChange }) {
  const [link, setLink] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function create() {
    setBusy(true); setError('');
    try { setLink(await api.post(`/api/voicer/users/${userId}/link`, {})); }
    catch (e) { setError(PanelUX.readableError(e)); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    if (!await PanelUX.confirm({ title: 'Отключить Telegram?', message: 'Новые задания останутся в очереди до повторного подключения.', confirmLabel: 'Отключить' })) return;
    setBusy(true);
    try { await api.post(`/api/voicer/users/${userId}/disconnect`, {}); setLink(null); onChange?.(); }
    catch (e) { setError(PanelUX.readableError(e)); }
    finally { setBusy(false); }
  }
  return <>
    <button className={s.btnSm} disabled={busy} onClick={create}>{busy ? 'Готовим ссылку…' : linked ? 'Переподключить Telegram' : 'Подключить Telegram'}</button>
    {error && <span className={s.error} role="alert">{error}</span>}
    {link && <PanelUX.Modal title="Подключение войсера" onClose={() => setLink(null)} busy={busy} footer={<button className={s.btn} disabled={busy} onClick={() => setLink(null)}>Закрыть</button>}>
      <p>Передайте эту одноразовую ссылку войсеру. Он должен открыть её в своём Telegram и нажать «Запустить». Ссылка действует 15 минут.</p>
      <a className={s.btnPrimary} href={link.url} target="_blank" rel="noreferrer">Открыть бота</a>
      <input className={s.field} aria-label="Ссылка для войсера" value={link.url} readOnly onFocus={e => e.target.select()} />
      <button className={s.btn} onClick={() => PanelUX.run('voicer:copy', ['Копируем…', 'Ссылка скопирована'], () => navigator.clipboard.writeText(link.url)).catch(e => setError(PanelUX.readableError(e)))}>Копировать ссылку</button>
      {linked && <button className={s.btnDanger} disabled={busy} onClick={disconnect}>Отключить текущий Telegram</button>}
    </PanelUX.Modal>}
  </>;
}
