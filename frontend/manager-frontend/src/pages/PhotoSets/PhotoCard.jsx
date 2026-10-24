import { photoUrl } from '../../api/photoSets';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

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
    <article
      className={cn('flex flex-col overflow-hidden rounded-lg border bg-card', picked && 'border-primary ring-1 ring-primary')}
      data-photo-id={photo.id}
    >
      <button type="button" className="block cursor-pointer" onClick={() => onOpen?.(photo)} aria-label={photo.description || `Фото #${photo.id}`}>
        <img className="block aspect-square w-full bg-muted object-cover" src={photoUrl(photo.id, true)} alt="" loading="lazy" />
      </button>
      <div className="flex flex-col gap-1 px-2.5 pt-2 pb-2.5 text-xs leading-snug">
        <span className={photo.description ? 'text-foreground' : 'text-muted-foreground italic'}>{photo.description || 'Без описания'}</span>
        {facts && <span className="text-muted-foreground">{facts}</span>}
        {photo.details && <span className="text-muted-foreground">{photo.details}</span>}
        <div className="mt-0.5 flex flex-wrap gap-1">
          {withSent && (photo.sent_at
            ? <Badge variant="success">Отправляли {fmtDate(photo.sent_at)}</Badge>
            : <Badge variant="outline">Ещё не отправляли</Badge>)}
          {!photo.reviewed && <Badge variant="warning">Проверить описание</Badge>}
          {!photo.auto_send && <Badge variant="outline" className="text-muted-foreground">Только вручную</Badge>}
          {photo.tags.map((t) => <Badge key={t} variant="outline">#{t}</Badge>)}
        </div>
      </div>
    </article>
  );
}
