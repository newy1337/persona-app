import { useEffect, useRef, useState } from 'react';
import { downloadChats } from '../../api/conversations';
import styles from './ConversationsTable.module.scss';

/** Сколько диалогов за раз выгружает сервер: текстом и с медиа. */
export const EXPORT_LIMITS = { txt: 1000, html_zip: 300 };

const word = (n) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'диалог';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'диалога';
  return 'диалогов';
};

/** «Выгрузить (N)»: диалоги, отобранные фильтрами, текстом или с медиа. */
export default function ExportButton({ chatIds }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!chatIds.length) return null;
  const n = chatIds.length;

  async function run(format) {
    setOpen(false);
    setBusy(true);
    setError('');
    try {
      await downloadChats(chatIds, format);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const option = (format, label) => {
    const over = n > EXPORT_LIMITS[format];
    return (
      <button
        type="button"
        role="menuitem"
        className={styles.exportOption}
        disabled={over}
        title={over ? `За раз — не больше ${EXPORT_LIMITS[format]}; сузьте фильтр` : undefined}
        onClick={() => run(format)}
      >
        {label}
      </button>
    );
  };

  return (
    <span className={styles.exportWrap} ref={ref}>
      <button
        type="button"
        className={styles.exportBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        data-testid="export-dialogs"
      >
        {busy ? 'Готовим файл…' : `Выгрузить ${n} ${word(n)}`}
      </button>
      {open && (
        <span className={styles.exportMenu} role="menu">
          {option('txt', 'Текстом (.txt)')}
          {option('html_zip', 'С фото и голосовыми (.zip)')}
        </span>
      )}
      {error && <span className={styles.exportError} role="alert">{error}</span>}
    </span>
  );
}
