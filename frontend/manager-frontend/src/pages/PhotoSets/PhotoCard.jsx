import { photoUrl } from '../../api/photoSets';
import p from './PhotoSets.module.scss';

export function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Снимок с описанием под ним; withSent — отметка, видел ли его собеседник. */
export default function PhotoCard({ photo, onOpen, picked = false, withSent = false }) {
  const facts = [photo.place, photo.taken_label].filter(Boolean).join(' · ');
  return (
    <article className={`${p.photo} ${picked ? p.photoPicked : ''}`} data-photo-id={photo.id}>
      <button type="button" className={p.photoButton} onClick={() => onOpen?.(photo)} aria-label={photo.description || `Фото #${photo.id}`}>
        <img className={p.thumb} src={photoUrl(photo.id, true)} alt="" loading="lazy" />
      </button>
      <div className={p.caption}>
        <span className={photo.description ? p.desc : p.descEmpty}>{photo.description || 'Без описания'}</span>
        {facts && <span className={p.facts}>{facts}</span>}
        {photo.details && <span className={p.facts}>{photo.details}</span>}
        <div className={p.badges}>
          {withSent && (photo.sent_at
            ? <span className={p.flagSent}>Отправляли {fmtDate(photo.sent_at)}</span>
            : <span className={p.flag}>Ещё не отправляли</span>)}
          {!photo.reviewed && <span className={p.flagWarn} title="Описание предложено системой">Проверить описание</span>}
          {!photo.auto_send && <span className={p.flagOff}>Только вручную</span>}
          {photo.tags.map((t) => <span key={t} className={p.flag}>#{t}</span>)}
        </div>
      </div>
    </article>
  );
}
