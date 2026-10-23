import { useEffect, useId, useRef, useState } from 'react';
import s from '../../styles/AdminPage.module.scss';
import styles from './ActionMenu.module.scss';
import { ChevronDownIcon } from '../../assets/icons';

/**
 * Меню «Ещё» для редких действий строки: главные кнопки остаются на виду,
 * остальное прячется за одной кнопкой и не растягивает строку.
 * items: [{ label, onSelect, danger, disabled, title }] — null/false пропускаются.
 */
export default function ActionMenu({ items, label = 'Ещё', small = true, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const id = useId();
  const list = items.filter(Boolean);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!list.length) return null;
  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={`${small ? s.btnSm : s.btn} ${styles.trigger} ${open ? s.btnSelected : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronDownIcon width="12" height="12" strokeWidth="2" className={`${styles.chevron} ${open ? styles.chevronUp : ''}`} />
      </button>
      {open && (
        <div id={id} className={styles.menu} role="menu">
          {list.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`${styles.item} ${item.danger ? styles.itemDanger : ''}`}
              disabled={item.disabled}
              title={item.title}
              onClick={() => { setOpen(false); item.onSelect(); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
