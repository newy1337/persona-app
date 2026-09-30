import { useEffect, useRef, useState } from 'react';
import s from './EditableValue.module.scss';

export default function EditableValue({ value, display, placeholder = '—', title, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    if (!editing) setText(value ?? '');
  }, [value, editing]);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  async function save() {
    if (busy) return;
    if (String(text).trim() === String(value ?? '').trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(String(text).trim());
      setEditing(false);
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={s.view}
        title={title ?? 'Нажмите, чтобы поправить — бот узнает это как факт'}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        <span className={value ? s.value : s.empty}>{display ?? (value || placeholder)}</span>
        <span className={s.pen} aria-hidden="true">✎</span>
      </button>
    );
  }

  return (
    <span className={s.edit} onClick={(e) => e.stopPropagation()}>
      <input
        ref={input}
        className={s.input}
        value={text}
        disabled={busy}
        placeholder="пусто — снять"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') {
            setEditing(false);
            setError(null);
          }
        }}
        onBlur={() => void save()}
      />
      {error && <span className={s.error}>{error}</span>}
    </span>
  );
}
