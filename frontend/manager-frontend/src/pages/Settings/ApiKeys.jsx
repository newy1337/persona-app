import { useCallback, useEffect, useState } from 'react';
import { PanelUX as ux } from '../../ui/PanelUX';
import { createApiKey, getApiKeys, revokeApiKey } from '../../api/apiKeys';
import s from '../../styles/AdminPage.module.scss';
import p from './Settings.module.scss';

const when = (ts) => (ts ? new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

/** Ключи для внешних систем: создать (значение показывается один раз), отозвать. */
export default function ApiKeys() {
  const [items, setItems] = useState(null);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => getApiKeys().then((r) => setItems(r.items ?? [])).catch((e) => setError(ux.readableError(e))), []);
  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setError(''); setCopied(false);
    try {
      const r = await createApiKey(name.trim());
      setFresh(r);
      setName('');
      await load();
    } catch (err) { setError(ux.readableError(err)); }
    finally { setBusy(false); }
  }
  async function revoke(k) {
    if (!await ux.confirm({ title: `Отозвать ключ «${k.name}»?`, message: 'Запросы с этим ключом сразу начнут получать 401. Вернуть ключ нельзя, только создать новый.', confirmLabel: 'Отозвать', danger: true })) return;
    setError('');
    try { setItems((await revokeApiKey(k.id)).items ?? []); }
    catch (err) { setError(ux.readableError(err)); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(fresh.key); setCopied(true); }
    catch { setCopied(false); }
  }

  return (
    <section className={p.section} aria-label="API-ключи">
      <h3 className={p.sectionTitle}>API-ключи</h3>
      <p className={p.hint}>
        Для внешних систем, которые присылают лиды в <code>POST /api/post/leads</code> с заголовком <code>X-Api-Key</code>.
        Значение ключа показывается один раз при создании. Отозванный ключ перестаёт работать сразу.
      </p>
      {error && <p className={s.error} role="alert">{error}</p>}
      <form className={s.actions} onSubmit={create} aria-label="Новый ключ">
        <input className={s.field} value={name} maxLength={64} placeholder="Название, например «Донор Beboo»" aria-label="Название ключа" disabled={busy} onChange={(e) => setName(e.target.value)} style={{ minWidth: 260 }} />
        <button type="submit" className={s.btnPrimary} disabled={!name.trim() || busy}>{busy ? 'Создаём…' : 'Создать ключ'}</button>
      </form>
      {fresh && (
        <div className="ak-fresh" role="status" data-testid="fresh-key">
          <p className={s.hint} style={{ margin: '0 0 6px' }}>Ключ «{fresh.item.name}». Скопируйте сейчас — больше он не покажется.</p>
          <div className={s.actions}>
            <code className="ak-value">{fresh.key}</code>
            <button type="button" className={s.btnSm} onClick={copy}>{copied ? 'Скопировано' : 'Копировать'}</button>
            <button type="button" className={s.btnSmGhost} onClick={() => setFresh(null)}>Скрыть</button>
          </div>
        </div>
      )}
      {items === null ? <p className={s.muted}>Загружаем…</p> : items.length === 0 ? <p className={s.empty}>Ключей пока нет.</p> : (
        <div className={s.tableWrap}>
          <table className={s.table} aria-label="Список ключей">
            <thead><tr><th>Название</th><th>Ключ</th><th>Создан</th><th>Последний запрос</th><th>Состояние</th><th /></tr></thead>
            <tbody>
              {items.map((k) => (
                <tr key={k.id} data-key-id={k.id} data-revoked={k.revoked_at ? '1' : '0'}>
                  <td>{k.name}</td>
                  <td><code>{k.prefix}…</code></td>
                  <td>{when(k.created_at)}</td>
                  <td>{when(k.last_used_at)}</td>
                  <td>{k.revoked_at ? <span className={s.badge}>отозван {when(k.revoked_at)}</span> : <span className={s.badgeActive ?? s.badge}>действует</span>}</td>
                  <td>{!k.revoked_at && <button type="button" className={s.btnSmDanger} onClick={() => revoke(k)} aria-label={`Отозвать ключ ${k.name}`}>Отозвать</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
