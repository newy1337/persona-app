import { useEffect, useState } from 'react';
import { PanelUX } from '../../ui/PanelUX';
import { createSeries, deleteSeries, updateSeries } from '../../api/photoSets';
import { TAKEN_HINT } from './PhotoEditor';
import s from '../../styles/AdminPage.module.scss';
import p from './PhotoSets.module.scss';

/** Сколько снимков нужно, чтобы бот мог отправить серию альбомом. */
export const SERIES_MIN = 2;
export const ALBUM_MAX = 10;

export function seriesHint(x) {
  if (!x.auto_send) return 'только вручную';
  const ready = x.ready ?? x.photos;
  if (ready < SERIES_MIN)
    return x.photos > ready
      ? `боту можно отправлять только ${ready} из ${x.photos} фото — нужно хотя бы ${SERIES_MIN}`
      : `добавьте ещё ${SERIES_MIN - ready} фото`;
  if (ready > ALBUM_MAX) return `бот отправит первые ${ALBUM_MAX}`;
  return 'бот может отправить альбомом';
}

function SeriesEditor({ series, canEdit, onClose, onSaved, onDeleted }) {
  const [f, setF] = useState({
    title: series.title,
    description: series.description ?? '',
    place: series.place ?? '',
    taken_on: series.taken_on ?? '',
    auto_send: series.auto_send,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setF((v) => ({ ...v, ...patch }));

  async function save(e) {
    e.preventDefault();
    if (busy || !f.title.trim()) return;
    setBusy(true);
    setError('');
    try {
      onSaved(await updateSeries(series.id, {
        title: f.title.trim(),
        description: f.description,
        place: f.place.trim() || null,
        taken_on: f.taken_on.trim() || null,
        auto_send: f.auto_send,
      }));
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!await PanelUX.confirm({ title: `Удалить серию «${series.title}»?`, message: 'Снимки останутся в образе, просто без серии.', confirmLabel: 'Удалить', danger: true })) return;
    try {
      await deleteSeries(series.id);
      onDeleted();
    } catch (err) {
      setError(err.detail || err.message);
    }
  }

  return (
    <div className={s.overlay} onClick={onClose}>
      <form className={s.modal} onClick={(e) => e.stopPropagation()} onSubmit={save} aria-label="Серия">
        <h3 className={s.modalTitle}>Серия «{series.title}»</h3>
        <p className={s.hint} style={{ marginTop: 0 }}>
          Бот видит серию целиком и может отправить её одним альбомом (до {ALBUM_MAX} фото), когда разговор зайдёт на эту тему.
          Альбом — одна отправка в лимитах образа. Что на каждом снимке — берётся из описаний фото.
        </p>
        <div className={p.fields}>
          <label className={s.label}>
            Название
            <input className={s.field} disabled={!canEdit} value={f.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className={s.label}>
            О чём серия
            <textarea className={`${s.field} ${p.textarea}`} disabled={!canEdit} value={f.description} maxLength={1000} placeholder="Неделя в Грузии с подругой, горы и много хинкали" onChange={(e) => set({ description: e.target.value })} />
          </label>
          <label className={s.label}>
            Где снято
            <input className={s.field} disabled={!canEdit} value={f.place} maxLength={200} placeholder="Неизвестно" onChange={(e) => set({ place: e.target.value })} />
          </label>
          <label className={s.label}>
            Когда снято
            <input className={s.field} disabled={!canEdit} value={f.taken_on} maxLength={10} placeholder="Дата неизвестна" title={TAKEN_HINT} onChange={(e) => set({ taken_on: e.target.value })} />
          </label>
          <label className={s.check} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <input type="checkbox" disabled={!canEdit} checked={f.auto_send} onChange={(e) => set({ auto_send: e.target.checked })} />
            Бот может отправлять серию сам
          </label>
        </div>
        {error && <p className={s.error} role="alert">{error}</p>}
        <div className={s.modalActions}>
          {canEdit && <button type="button" className={s.btnDanger} disabled={busy} onClick={remove}>Удалить серию</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className={s.btn} onClick={onClose}>{canEdit ? 'Отмена' : 'Закрыть'}</button>
          {canEdit && <button type="submit" className={s.btnPrimary} disabled={busy || !f.title.trim()}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>}
        </div>
      </form>
    </div>
  );
}

/**
 * Серии образа: «Путешествие», «Новый год». Клик по серии — показать её
 * снимки; «изменить» — описание серии для бота. Фото в серию добавляются из
 * карточки снимка.
 */
export default function SeriesPanel({ setId, series, canEdit, value, onChange, onChanged }) {
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setOpen(null); setTitle(''); setError(''); }, [setId]);

  async function create(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setError('');
    try {
      const created = await createSeries(setId, { title: title.trim() });
      setTitle('');
      onChanged();
      setOpen(created);
    } catch (err) {
      setError(err.detail || err.message);
    }
  }

  if (!canEdit && !series.length) return null;
  return (
    <div className={p.series} aria-label="Серии образа" data-testid="photo-series">
      <div className={p.toolbar}>
        <strong style={{ fontSize: 14 }}>Серии</strong>
        <span className={s.hint} style={{ margin: 0 }}>бот может отправить серию целиком, одним альбомом</span>
      </div>
      <div className={p.tags} role="group" aria-label="Серии">
        <button type="button" className={value ? p.tag : p.tagActive} onClick={() => onChange(null)}>все фото</button>
        {series.map((x) => (
          <span key={x.id} className={p.seriesChip}>
            <button type="button" className={value === x.id ? p.tagActive : p.tag} onClick={() => onChange(value === x.id ? null : x.id)} title={seriesHint(x)}>
              {x.title} · {x.photos}
            </button>
            <button type="button" className={p.seriesEdit} onClick={() => setOpen(x)} aria-label={`Изменить серию ${x.title}`}>✎</button>
          </span>
        ))}
        {canEdit && (
          <form onSubmit={create} style={{ display: 'flex', gap: 6 }}>
            <input className={s.field} style={{ padding: '2px 8px', minHeight: 0, maxWidth: 180 }} placeholder="Новая серия" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label="Название новой серии" />
            <button type="submit" className={s.btnSm} disabled={!title.trim()}>Создать</button>
          </form>
        )}
      </div>
      {value && (() => {
        const cur = series.find((x) => x.id === value);
        return cur ? <p className={s.hint} style={{ margin: 0 }}>{seriesHint(cur)}. Добавить фото в серию — откройте снимок и выберите серию.</p> : null;
      })()}
      {error && <p className={s.error} role="alert">{error}</p>}
      {open && (
        <SeriesEditor
          series={open}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); onChanged(); }}
          onDeleted={() => { setOpen(null); if (value === open.id) onChange(null); onChanged(); }}
        />
      )}
    </div>
  );
}
