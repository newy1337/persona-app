import { useEffect, useMemo, useState } from 'react';
import { PanelUX } from '../../ui/PanelUX';
import { sendSupportReport } from '../../api/support';
import s from '../../styles/AdminPage.module.scss';
import v from './SupportDialog.module.scss';

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Отбирает только картинки допустимого типа и размера; остальное — в причину отказа. */
export function pickScreenshots(current, incoming) {
  const out = [...current];
  const rejected = [];
  for (const f of incoming) {
    if (out.length >= MAX_FILES) { rejected.push(`${f.name}: больше ${MAX_FILES} файлов`); continue; }
    if (!TYPES.includes(f.type)) { rejected.push(`${f.name}: только png, jpeg, webp`); continue; }
    if (f.size > MAX_FILE_BYTES) { rejected.push(`${f.name}: больше 5 МБ`); continue; }
    out.push(f);
  }
  return { files: out, rejected };
}

export default function SupportDialog({ onClose }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const add = (list) => {
    const { files: next, rejected } = pickScreenshots(files, [...(list ?? [])]);
    setFiles(next);
    setError(rejected.join('; '));
  };

  async function submit(e) {
    e.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setError('');
    try {
      await sendSupportReport({ text: text.trim(), page: window.location.pathname, files });
      setDone(true);
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(PanelUX.readableError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelUX.Modal
      title="Написать в поддержку"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className={s.btn} onClick={onClose} disabled={busy}>Отмена</button>
          <button type="submit" form="support-form" className={s.btnPrimary} disabled={busy || !text.trim() || done}>
            {busy ? 'Отправляем…' : done ? 'Отправлено' : 'Отправить'}
          </button>
        </>
      }
    >
      <form id="support-form" className={v.form} onSubmit={submit} aria-label="Обращение в поддержку">
        <p className={v.hint}>Опишите, что пошло не так, и приложите скриншоты. Сообщение уйдёт команде поддержки с вашим именем и адресом страницы.</p>
        <textarea
          className={v.text}
          value={text}
          maxLength={4000}
          rows={6}
          placeholder="Что случилось, в каком диалоге, что ожидали увидеть"
          disabled={busy || done}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
            if (pasted.length) add(pasted);
          }}
        />
        <div className={v.filesRow}>
          <label className={s.btnSm}>
            + Скриншот
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden disabled={busy || done} onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          </label>
          <span className={s.muted}>до {MAX_FILES} файлов по 5 МБ, можно вставить из буфера</span>
        </div>
        {files.length > 0 && (
          <ul className={v.previews}>
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className={v.preview}>
                <img src={previews[i]} alt={f.name} />
                <button type="button" aria-label={`Убрать ${f.name}`} disabled={busy} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className={s.error} role="alert">{error}</p>}
        {done && <p className={s.ok} role="status">Отправлено, спасибо. Поддержка ответит в рабочем чате.</p>}
      </form>
    </PanelUX.Modal>
  );
}
