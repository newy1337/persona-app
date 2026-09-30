import { useEffect, useState } from 'react';
import { getInitials } from '../../utils/avatar';
import { withToken } from '../../utils/chat';
import styles from './ClientAvatar.module.scss';

export default function ClientAvatar({ src, name, className = '', style }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const showPhoto = Boolean(src) && !broken;
  return (
    <div className={`${className} ${styles.wrap}`} style={style}>
      {showPhoto ? (
        <img className={styles.photo} src={withToken(src)} alt="" loading="lazy" onError={() => setBroken(true)} />
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
