import { useCallback, useEffect, useState } from 'react';
import Header from '../../components/Header/Header';
import { getSettings, updateSettings } from '../../api/settings';
import s from '../../styles/AdminPage.module.scss';
import p from './Settings.module.scss';

export const MAX_TRIGGERS = 200;

/** Список без пустых строк и дублей (регистр, ё/е и пробелы не считаются). */
export function cleanTriggers(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const text = String(item ?? '').replace(/\s+/g, ' ').trim();
    const key = text.toLowerCase().replace(/ё/g, 'е');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.slice(0, MAX_TRIGGERS);
}

export function TriggersEditor({ initial, onSave }) {
  const [rows, setRows] = useState(initial.length ? initial : ['']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    setRows(initial.length ? initial : ['']);
  }, [initial]);

  const cleaned = cleanTriggers(rows);
  const dirty = JSON.stringify(cleaned) !== JSON.stringify(initial);

  const change = (i, value) => setRows((r) => r.map((x, j) => (j === i ? value : x)));
  const remove = (i) => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : ['']));
  const add = () => setRows((r) => [...r, '']);

  async function save(e) {
    e.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(cleaned);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={p.editor} onSubmit={save} aria-label="Стоп-фразы">
      <ol className={p.list}>
        {rows.map((value, i) => (
          <li key={i} className={p.row}>
            <input
              className={s.field}
              value={value}
              placeholder="например: позови менеджера"
              maxLength={200}
              disabled={busy}
              aria-label={`Стоп-фраза ${i + 1}`}
              onChange={(e) => change(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && i === rows.length - 1 && value.trim()) {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className={s.btnSmGhost} disabled={busy} onClick={() => remove(i)} aria-label={`Удалить стоп-фразу ${i + 1}`}>
              ✕
            </button>
          </li>
        ))}
      </ol>
      <div className={s.actions}>
        <button type="button" className={s.btnSm} disabled={busy || rows.length >= MAX_TRIGGERS} onClick={add}>
          + Добавить фразу
        </button>
        <button type="submit" className={s.btnPrimary} disabled={busy || !dirty}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <span className={s.muted} role="status">
          {error ? '' : dirty ? 'есть несохранённые изменения' : savedAt ? 'сохранено' : `${cleaned.length} фраз`}
        </span>
      </div>
      {error && <p className={s.error} role="alert">{error}</p>}
    </form>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    getSettings().then(setSettings).catch((e) => setError(e.detail || e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const triggers = settings?.handoff_triggers ?? [];

  return (
    <div className="app">
      <Header />
      <main className="main">
        <div className="container">
        <div className={s.head}>
          <h2 className={s.title}>Настройки</h2>
        </div>
        {error && <p className={s.error}>{error}</p>}

        <section className={p.section}>
          <h3 className={p.sectionTitle}>Стоп-фразы: передать менеджеру</h3>
          <p className={p.hint}>
            Если клиент написал что-то из этого списка, бот сразу замолкает, чат уходит в очередь
            «ждут менеджера» с пометкой «Стоп-фраза клиента». Фраза ищется внутри сообщения,
            регистр, буква ё и лишние пробелы не важны. Вернуть бота — кнопкой «Продолжить» в диалоге.
          </p>
          {settings ? (
            <TriggersEditor
              initial={triggers}
              onSave={async (list) => setSettings(await updateSettings({ handoff_triggers: list }))}
            />
          ) : (
            !error && <p className={s.muted}>Загружаем…</p>
          )}
        </section>
        </div>
      </main>
    </div>
  );
}
