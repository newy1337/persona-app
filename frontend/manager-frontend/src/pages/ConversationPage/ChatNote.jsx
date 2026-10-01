import { useEffect, useRef, useState } from 'react';
import styles from './ConversationPage.module.scss';


const when = (ts) => (ts ? new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

export default function ChatNote({ note, noteBy, noteAt, onSave }) {
  const [text, setText] = useState(note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(Boolean(note));
  const saved = useRef(note ?? '');

  useEffect(() => {
    const incoming = note ?? '';
    if (incoming === saved.current) return;
    saved.current = incoming;
    setText(incoming);
    if (incoming) setOpen(true);
  }, [note]);

  const dirty = text !== (note ?? '');

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(text);
      saved.current = text.trim();
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className={styles.summarySection}>
        <button className={styles.noteAdd} onClick={() => setOpen(true)} data-testid="note-add">
          + Заметка о диалоге
        </button>
      </div>
    );
  }

  return (
    <div className={styles.summarySection}>
      <div className={styles.summaryHeader}>
        <span className={styles.summaryTitle}>Заметка</span>
        {noteAt && <span className={styles.summaryTag}>{noteBy ? `${noteBy}, ` : ''}{when(noteAt)}</span>}
      </div>
      <div className={styles.cardBody}>
        <textarea
          className={styles.noteBox}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Что помнить про этот диалог. Бот это не читает."
          rows={4}
          maxLength={4000}
          data-testid="note-text"
        />
        {error && <p className={styles.noteError}>{error}</p>}
        <div className={styles.noteActions}>
          <button className={styles.noteSave} onClick={save} disabled={busy || !dirty} data-testid="note-save">
            {busy ? 'Сохраняю…' : dirty ? 'Сохранить' : 'Сохранено'}
          </button>
          {text && (
            <button
              className={styles.noteClear}
              onClick={() => setText('')}
              disabled={busy}
              data-testid="note-clear"
              title="Очистить и сохранить пустую — заметка удалится"
            >
              Очистить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
