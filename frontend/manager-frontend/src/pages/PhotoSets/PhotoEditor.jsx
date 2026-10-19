import { useState } from 'react';
import { photoUrl, updateSetPhoto } from '../../api/photoSets';
import s from '../../styles/AdminPage.module.scss';
import p from './PhotoSets.module.scss';

export function tagsText(tags) {
  return (tags ?? []).join(', ');
}

export function parseTagsText(text) {
  return [...new Set(String(text).split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))];
}

export const TAKEN_HINT = 'ГГГГ, ГГГГ-ММ или ГГГГ-ММ-ДД';

/** Карточка снимка: что на нём, где и когда снято, что важно не перепутать. */
export default function PhotoEditor({ photo, canEdit, onClose, onSaved, onDelete, onCover }) {
  const [f, setF] = useState({
    description: photo.description ?? '',
    place: photo.place ?? '',
    taken_on: photo.taken_on ?? '',
    details: photo.details ?? '',
    tags: tagsText(photo.tags),
    auto_send: photo.auto_send,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setF((v) => ({ ...v, ...patch }));

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await updateSetPhoto(photo.id, {
        description: f.description,
        place: f.place.trim() || null,
        taken_on: f.taken_on.trim() || null,
        details: f.details,
        tags: parseTagsText(f.tags),
        auto_send: f.auto_send,
      });
      onSaved(saved);
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.overlay} onClick={onClose}>
      <form className={`${s.modal} ${p.editor}`} onClick={(e) => e.stopPropagation()} onSubmit={save} aria-label="Карточка снимка">
        <h3 className={s.modalTitle}>Фото #{photo.id}</h3>
        <div className={p.editorBody}>
          <img className={p.preview} src={photoUrl(photo.id, true)} alt="" />
          <div className={p.fields}>
            <label className={s.label}>
              Что изображено
              <textarea className={`${s.field} ${p.textarea}`} disabled={!canEdit} value={f.description} maxLength={1000} onChange={(e) => set({ description: e.target.value })} />
            </label>
            <label className={s.label}>
              Где снято
              <input className={s.field} disabled={!canEdit} value={f.place} maxLength={200} onChange={(e) => set({ place: e.target.value })} placeholder="Неизвестно" />
            </label>
            <label className={s.label}>
              Когда снято
              <input className={s.field} disabled={!canEdit} value={f.taken_on} maxLength={10} onChange={(e) => set({ taken_on: e.target.value })} placeholder="Дата неизвестна" title={TAKEN_HINT} />
            </label>
            <label className={s.label}>
              Важные детали
              <textarea className={`${s.field} ${p.textarea}`} disabled={!canEdit} value={f.details} maxLength={1000} onChange={(e) => set({ details: e.target.value })} />
            </label>
            <label className={s.label}>
              Теги через запятую
              <input className={s.field} disabled={!canEdit} value={f.tags} onChange={(e) => set({ tags: e.target.value })} />
            </label>
            <label className={s.check} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <input type="checkbox" disabled={!canEdit} checked={f.auto_send} onChange={(e) => set({ auto_send: e.target.checked })} />
              Бот может отправлять сам
            </label>
          </div>
        </div>
        {error && <p className={s.error} role="alert">{error}</p>}
        <div className={s.modalActions}>
          {canEdit && onDelete && <button type="button" className={s.btnDanger} disabled={busy} onClick={() => onDelete(photo)}>Убрать из образа</button>}
          {canEdit && onCover && <button type="button" className={s.btn} disabled={busy} onClick={() => onCover(photo)}>Сделать обложкой</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className={s.btn} onClick={onClose}>{canEdit ? 'Отмена' : 'Закрыть'}</button>
          {canEdit && <button type="submit" className={s.btnPrimary} disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>}
        </div>
      </form>
    </div>
  );
}
