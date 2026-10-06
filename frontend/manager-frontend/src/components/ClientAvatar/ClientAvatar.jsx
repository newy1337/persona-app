import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { getInitials } from '../../utils/avatar';
import { withToken } from '../../utils/chat';

/**
 * Обычный <div><img onError /></div>, без Radix Avatar: в jsdom событие load
 * никогда не приходит, и тесты ждут именно инициалы либо картинку. Размер и
 * радиус задаёт вызывающая сторона через className, фон — через --av-bg.
 */
export default function ClientAvatar({ src, name, className = '', style }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const showPhoto = Boolean(src) && !broken;
  return (
    <div
      className={cn(
        'flex items-center justify-center overflow-hidden bg-(--av-bg) text-[11px] font-bold text-white',
        className,
      )}
      style={style}
    >
      {showPhoto ? (
        <img
          className="block size-full object-cover"
          src={withToken(src)}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        getInitials(name || '—')
      )}
    </div>
  );
}

export const ACTIVITY_LABEL = {
  typing: 'печатает',
  voice: 'записывает голосовое',
  video_note: 'записывает кружок',
  photo: 'отправляет фото',
  file: 'отправляет файл',
};
