import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { putSection } from '../../api/personas';
import VersionsTable, { ago, useVersions } from './Versions';
import { drafts } from './drafts';
import { SECTION_LABELS, docFromRows, rowErrors, rowsFromDoc, usages } from './variables';
import s from '../../styles/AdminPage.module.scss';
import p from './Personas.module.scss';

const DRAFT_DELAY_MS = 600;
const BUILTINS = { name: 'имя личности' };
const CHAT_VARIABLES = { city: 'город лида', site: 'сайт знакомств лида' };

export default function VariablesEditor({ persona, onSaved, onError }) {
  const server = useMemo(() => persona.sections.variables ?? {}, [persona.sections.variables]);
  const serverText = useMemo(() => JSON.stringify(server), [server]);

  const [rows, setRows] = useState(() => rowsFromDoc(server));
  const [draftAt, setDraftAt] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const timer = useRef(null);
  const lastId = useRef(null);

  const versions = useVersions(persona.id, 'variables', {
    onRestored: () => {
      drafts.clear(persona.id, 'variables');
      onSaved();
    },
    onError,
  });

  useEffect(() => {
    const d = drafts.read(persona.id, 'variables');
    let fromDraft = null;
    try {
      fromDraft = d ? JSON.parse(d.text) : null;
    } catch {
      fromDraft = null;
    }
    if (Array.isArray(fromDraft) && JSON.stringify(docFromRows(fromDraft)) !== serverText) {
      try {
        setRows(fromDraft);
        setDraftAt(d.savedAt);
      } catch {
        drafts.clear(persona.id, 'variables');
        setRows(rowsFromDoc(server));
        setDraftAt(null);
      }
    } else {
      if (d) drafts.clear(persona.id, 'variables');
      setRows(rowsFromDoc(server));
      setDraftAt(null);
    }
    if (lastId.current !== persona.id) {
      lastId.current = persona.id;
      setNote('');
      setFlash(null);
      versions.hide();
    }
  }, [persona.id, serverText]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const doc = useMemo(() => docFromRows(rows), [rows]);
  const dirty = JSON.stringify(doc) !== serverText;
  const errors = useMemo(() => rowErrors(rows, BUILTINS), [rows]);
  const invalid = errors.some(Boolean);

  const used = useMemo(() => usages(persona.sections), [persona.sections]);
  const defined = new Set(rows.map((r) => String(r.key).trim()).filter(Boolean));
  const missing = [...used.keys()].filter((key) => !defined.has(key) && !(key in BUILTINS) && !(key in CHAT_VARIABLES)).sort();

  const update = (next) => {
    setFlash(null);
    setRows(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (JSON.stringify(docFromRows(next)) === serverText) {
        drafts.clear(persona.id, 'variables');
        setDraftAt(null);
      } else {
        drafts.write(persona.id, 'variables', JSON.stringify(next));
        setDraftAt(Date.now());
      }
    }, DRAFT_DELAY_MS);
  };

  const setCell = (i, field, value) => update(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  const addRow = (key = '') => update([...rows, { key, value: '', note: '' }]);
  const removeRow = (i) => update(rows.filter((_, j) => j !== i));

  const reset = () => {
    clearTimeout(timer.current);
    drafts.clear(persona.id, 'variables');
    setRows(rowsFromDoc(server));
    setDraftAt(null);
    setFlash(null);
  };

  const save = useCallback(async () => {
    if (!dirty || busy || invalid) return;
    setBusy(true);
    try {
      const r = await putSection(persona.id, 'variables', doc, note.trim() || undefined);
      drafts.clear(persona.id, 'variables');
      setDraftAt(null);
      setNote('');
      setFlash(r.unchanged ? 'Ничего не изменилось' : 'Сохранено — значения подставятся со следующего ответа');
      onSaved();
    } catch (e) {
      onError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }, [dirty, busy, invalid, doc, note, persona.id, onSaved, onError]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const where = (key) => [...(used.get(key) ?? [])].map((section) => SECTION_LABELS[section] ?? section);

  return (
    <div className={p.prompts}>
      <div className={p.sectionBar}>
        <span className={s.muted}>
          {defined.size} переменн. · в текстах используется {[...used.keys()].length}
        </span>
        <div className={s.actions}>
          <button className={s.btnSm} onClick={() => addRow()}>+ Переменная</button>
          <button className={s.btnSm} onClick={versions.toggle}>
            {versions.open ? 'Скрыть историю' : 'История версий'}
          </button>
          <button className={s.btnSm} disabled={!dirty} onClick={reset}>Отменить правки</button>
        </div>
      </div>

      <p className={s.hint}>
        Напишите <span className={s.mono}>{'{site}'}</span> в любой вкладке — промпты, карточка, цели, сюжеты, день, биты —
        и задайте значение здесь. Бот увидит значение, в редакторах останется <span className={s.mono}>{'{site}'}</span>.
        Имена — буквы (можно русские), цифры и «_». Незаданная <span className={s.mono}>{'{…}'}</span> остаётся в тексте как есть.
        <span className={s.mono}> {'{city}'}</span> и <span className={s.mono}>{'{site}'}</span> у каждого диалога свои — из
        города и сайта лида; значения здесь для них запасные.
      </p>

      {draftAt && dirty && (
        <p className={p.draftNote}>
          Черновик сохранён в браузере ({ago(draftAt)}) — правки не потеряются при перезагрузке.
        </p>
      )}

      {missing.length > 0 && (
        <div className={p.varMissing}>
          <span>В текстах есть, но не заданы:</span>
          {missing.map((key) => (
            <button key={key} className={s.btnSm} title={`Используется: ${where(key).join(', ')}`} onClick={() => addRow(key)}>
              + {`{${key}}`}
            </button>
          ))}
        </div>
      )}

      <VersionsTable versions={versions.versions} onRestore={versions.restore} />

      <div className={s.tableWrap}>
        <table className={`${s.table} ${p.varTable}`}>
          <thead>
            <tr><th>Переменная</th><th>Значение</th><th>Пояснение</th><th>Где используется</th><th></th></tr>
          </thead>
          <tbody>
            {Object.entries(BUILTINS).map(([key, label]) => (
              <tr key={`builtin-${key}`} className={p.varBuiltin}>
                <td className={s.mono}>{`{${key}}`}</td>
                <td>{persona.name}</td>
                <td className={s.muted}>{label} — встроенная, меняется переименованием</td>
                <td className={s.muted}>{where(key).join(', ') || '—'}</td>
                <td></td>
              </tr>
            ))}
            {Object.entries(CHAT_VARIABLES).map(([key, label]) => {
              const fallback = rows.find((r) => String(r.key).trim() === key);
              return (
                <tr key={`chat-${key}`} className={p.varBuiltin}>
                  <td className={s.mono}>{`{${key}}`}</td>
                  <td>из карточки лида</td>
                  <td className={s.muted}>
                    {label}; у лида пусто — {fallback?.value ? `«${fallback.value}» из строки ниже` : 'добавьте строку ниже с запасным значением'}
                  </td>
                  <td className={s.muted}>{where(key).join(', ') || '—'}</td>
                  <td></td>
                </tr>
              );
            })}
            {rows.map((row, i) => {
              const key = String(row.key).trim();
              const places = key ? where(key) : [];
              return (
                <tr key={i}>
                  <td>
                    <span className={p.varKey}>
                      <span className={s.muted}>{'{'}</span>
                      <input
                        className={`${s.field} ${s.mono}`}
                        value={row.key}
                        placeholder="site"
                        onChange={(e) => setCell(i, 'key', e.target.value)}
                      />
                      <span className={s.muted}>{'}'}</span>
                    </span>
                    {errors[i] && <span className={p.varError}>{errors[i]}</span>}
                  </td>
                  <td>
                    <input
                      className={`${s.field} ${p.varValue}`}
                      value={row.value}
                      placeholder="значение"
                      onChange={(e) => setCell(i, 'value', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className={`${s.field} ${p.varValue}`}
                      value={row.note}
                      placeholder="для себя"
                      onChange={(e) => setCell(i, 'note', e.target.value)}
                    />
                  </td>
                  <td className={places.length ? '' : s.muted}>{places.join(', ') || 'нигде'}</td>
                  <td>
                    <button className={s.btnSmDanger} title="Удалить переменную" onClick={() => removeRow(i)}>✕</button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className={s.muted}>
                  Переменных пока нет — нажмите «+ Переменная» или добавьте из списка незаданных выше.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={p.stickyBar}>
        {invalid && <span className={s.error}>Исправьте имена переменных</span>}
        {flash && <span className={s.ok}>{flash}</span>}
        <input
          className={s.field}
          style={{ maxWidth: 240 }}
          placeholder="подпись к версии"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className={s.btnPrimary} disabled={!dirty || busy || invalid} onClick={save} title="Ctrl+S">
          {busy ? 'Сохранение…' : 'Сохранить переменные'}
        </button>
      </div>
    </div>
  );
}
