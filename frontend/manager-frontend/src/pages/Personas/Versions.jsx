import { PanelUX } from '../../ui/PanelUX';
import { useCallback, useState } from 'react';
import { getVersions, restoreVersion } from '../../api/personas';
import s from '../../styles/AdminPage.module.scss';

export function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ago(ms) {
  const sec = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec} с назад`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`;
}

export function useVersions(personaId, section, { onRestored, onError }) {
  const [versions, setVersions] = useState(null);

  const toggle = useCallback(async () => {
    if (versions) {
      setVersions(null);
      return;
    }
    try {
      setVersions((await getVersions(personaId, section)).items);
    } catch (e) {
      onError(e.detail || e.message);
    }
  }, [versions, personaId, section, onError]);

  const restore = useCallback(
    async (versionId) => {
      if (!await PanelUX.confirm('Вернуть эту версию? Текущий документ тоже уйдёт в историю.')) return;
      try {
        await restoreVersion(personaId, section, versionId);
        setVersions(null);
        onRestored();
      } catch (e) {
        onError(e.detail || e.message);
      }
    },
    [personaId, section, onRestored, onError],
  );

  const hide = useCallback(() => setVersions(null), []);
  return { versions, open: versions !== null, toggle, restore, hide };
}

export default function VersionsTable({ versions, onRestore }) {
  if (!versions) return null;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr><th>Когда</th><th>Кто</th><th>Подпись</th><th>Размер</th><th></th></tr>
        </thead>
        <tbody>
          {versions.length === 0 && <tr><td colSpan={5} className={s.muted}>Правок ещё не было</td></tr>}
          {versions.map((v) => (
            <tr key={v.id}>
              <td className={s.muted}>{fmtTs(v.created_at)}</td>
              <td>{v.saved_by ?? '—'}</td>
              <td className={s.muted}>{v.note ?? ''}</td>
              <td className={s.muted}>{(v.bytes / 1024).toFixed(1)} КБ</td>
              <td><button className={s.btnSm} onClick={() => onRestore(v.id)}>Вернуть</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
