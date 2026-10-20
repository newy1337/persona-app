import { useCallback, useEffect, useState } from 'react';
import Header from '../../components/Header/Header';
import { PanelUX as ux } from '../../ui/PanelUX';
import { api } from '../../api/client';
import { declineBuffered, getBuffer, takeBuffered } from '../../api/buffer';
import { httpHref } from '../../utils/safeUrl';
import s from '../../styles/AdminPage.module.scss';

const when = (ts) => (ts ? new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

/** Окно отклонения: причина по желанию, лид удаляется, слепок остаётся в архиве. */
function DeclineModal({ item, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    setBusy(true); setError('');
    try { await onConfirm(reason.trim()); }
    catch (e) { setError(ux.readableError(e)); setBusy(false); }
  }
  return (
    <ux.Modal title={`Отклонить @${item.username}?`} onClose={onCancel} busy={busy} footer={<>
      <button type="button" className={s.btn} disabled={busy} onClick={onCancel}>Отмена</button>
      <button type="button" className={s.btnDanger} disabled={busy} onClick={confirm}>{busy ? 'Отклоняем…' : 'Отклонить'}</button>
    </>}>
      <p className={s.hint} style={{ marginTop: 0 }}>Лид удалится из буфера. Данные сохранятся в архиве отклонённых: если этот ник придёт снова, будет видно, что его уже отклоняли.</p>
      <label className={s.label}>
        Причина (необязательно)
        <input className={s.field} value={reason} maxLength={500} autoFocus onChange={(e) => setReason(e.target.value)} aria-label="Причина отклонения" />
      </label>
      {error && <p className={s.error} role="alert">{error}</p>}
    </ux.Modal>
  );
}

export function BufferTable({ items, busy, onTake, onDecline }) {
  if (!items.length) return <p className={s.empty}>Буфер пуст.</p>;
  return (
    <div className={s.tableWrap}>
      <table className={s.table} aria-label="Буфер">
        <thead><tr><th>Ник и собеседник</th><th>Откуда</th><th>Получен</th><th>История</th><th /></tr></thead>
        <tbody>
          {items.map((x) => (
            <tr key={x.id} data-buffer-id={x.id}>
              <td>
                <a href={`https://t.me/${x.username}`} target="_blank" rel="noreferrer"><strong>@{x.username}</strong></a>
                <div className={s.muted}>{[x.first_name, x.age ? `${x.age} лет` : null, x.city].filter(Boolean).join(' · ') || '—'}</div>
                {httpHref(x.profile_url) && <div className={s.muted}><a href={httpHref(x.profile_url)} target="_blank" rel="noreferrer">профиль</a></div>}
                {x.declined_before && (
                  <div className={s.error} style={{ margin: '4px 0 0' }} data-testid="declined-before">
                    Уже отклоняли{x.declined_before.count > 1 ? ` ${x.declined_before.count} раза` : ''}: {when(x.declined_before.last_at)}{x.declined_before.last_reason ? ` · ${x.declined_before.last_reason}` : ''}
                  </div>
                )}
              </td>
              <td className={s.muted}>
                <div>Регион {x.region_code ?? '—'} · донор {x.donor ?? '—'}</div>
                <div>{[`источник ${x.source}`, x.person ? `личность ${x.person}` : null].filter(Boolean).join(' · ')}</div>
                {(x.account || x.external_id) && <div>{[x.account ? `аккаунт ${x.account}` : null, x.external_id ? `ID ${x.external_id}` : null].filter(Boolean).join(' · ')}</div>}
                {x.reassigned && <div><span className={s.badge}>перезабив</span></div>}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>{when(x.buffered_at)}</td>
              <td>{x.last_messages ? <details><summary>история</summary><p style={{ whiteSpace: 'pre-wrap', maxWidth: 360 }}>{x.last_messages}</p></details> : <span className={s.muted}>—</span>}</td>
              <td>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
                  <button type="button" className={s.btnPrimary} disabled={busy === x.id} onClick={() => onTake(x)}>Взять в работу</button>
                  <button type="button" className={s.btnSmDanger} disabled={busy === x.id} onClick={() => onDecline(x)}>Отклонить</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Buffer() {
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [declining, setDeclining] = useState(null);
  const [region, setRegion] = useState('');
  const [me, setMe] = useState(null);

  const load = useCallback(() => getBuffer(region).then(setData).catch((e) => setError(ux.readableError(e))).finally(() => setLoading(false)), [region]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/auth/me').then(setMe).catch(() => setMe(null)); }, []);

  async function take(item) {
    setBusy(item.id); setError('');
    try { setData(await takeBuffered(item.id)); ux.toast?.(`@${item.username} — в ваших лидах`); }
    catch (e) { setError(ux.readableError(e)); }
    finally { setBusy(null); }
  }

  return (
    <div className="app">
      <Header />
      <main className="main">
        <div className="container">
          <div className={s.head}>
            <div>
              <h2 className={s.title}>Буфер</h2>
              <span className={s.muted}>{loading ? 'загружаем…' : `в буфере: ${data.total}`}</span>
            </div>
            {me?.role === 'admin' && (
              <input className={s.field} placeholder="Регион, например 001" value={region} maxLength={4} inputMode="numeric"
                onChange={(e) => setRegion(e.target.value.replace(/\D/g, ''))} aria-label="Регион" style={{ maxWidth: 200 }} />
            )}
          </div>
          <p className={s.hint}>Входящие лиды только с ником, без телефона. Возьмите в работу — лид появится у вас в «Лидах», или отклоните.</p>
          {error && <p className={s.error} role="alert">{error}</p>}
          {!loading && <BufferTable items={data.items} busy={busy} onTake={take} onDecline={setDeclining} />}
        </div>
      </main>
      {declining && (
        <DeclineModal item={declining} onCancel={() => setDeclining(null)}
          onConfirm={async (reason) => { setData(await declineBuffered(declining.id, reason)); setDeclining(null); }} />
      )}
    </div>
  );
}
