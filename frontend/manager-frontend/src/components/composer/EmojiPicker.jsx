import { useEffect, useRef } from 'react';
import styles from './Composer.module.scss';

const GROUPS = [
  ['Лица', ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '🙂', '😉', '😊', '😍', '🥰', '😘', '😗', '😜', '🤪', '🤨', '🧐', '😎', '🥳', '😏', '😒', '😔', '😞', '😢', '😭', '😤', '😠', '🤯', '😳', '🥺', '😱', '😴', '🤔', '🤗', '🤭', '🙄', '😬', '😶', '🙃']],
  ['Жесты', ['👍', '👎', '👌', '✌', '🤞', '🤝', '👏', '🙏', '💪', '🙌', '👋', '🤷', '🤦', '☝', '👀']],
  ['Сердца', ['❤', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '❤‍🔥', '💕', '💖', '💘', '💝']],
  ['Разное', ['🔥', '✨', '⭐', '🎉', '🎁', '☕', '🍕', '🍻', '🌸', '🌞', '🌙', '🌧', '⚡', '✅', '❌', '❗', '❓', '💯', '👻', '🙈']],
];

function useDismiss(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return ref;
}

export default function EmojiPicker({ onPick, onClose, only = null, title = 'Эмодзи', className = '', style }) {
  const ref = useDismiss(onClose);
  const groups = only ? [[title, only]] : GROUPS;

  return (
    <div className={`${styles.picker} ${className}`} style={style} ref={ref}>
      {groups.map(([name, list]) => (
        <div key={name} className={styles.pickerGroup}>
          <span className={styles.pickerTitle}>{name}</span>
          <div className={styles.pickerGrid}>
            {list.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={styles.pickerItem}
                onClick={() => onPick(emoji)}
                title={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
