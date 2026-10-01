import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { putSection } from '../../api/personas';
import VersionsTable, { ago, useVersions } from './Versions';
import DocEditor from './DocEditor';
import { drafts } from './drafts';
import s from '../../styles/AdminPage.module.scss';
import p from './Personas.module.scss';

const DRAFT_DELAY_MS = 600;
const pretty = (value) => JSON.stringify(value ?? {}, null, 2);

export default function SectionEditor({ persona, section, onSaved, onError }) {
  const stored = persona.sections[section];
  const server = useMemo(() => pretty(stored), [stored]);

  const [text, setText] = useState(server);
  const [draftAt, setDraftAt] = useState(null);
  const [mode, setMode] = useState('form');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const timer = useRef(null);
  const lastKey = useRef('');

  const versions = useVersions(persona.id, section, {
    onRestored: () => {
      drafts.clear(persona.id, section);
      onSaved();
    },
    onError,
  });

  useEffect(() => {
    const d = drafts.read(persona.id, section);
    if (d && d.text !== server) {
      setText(d.text);
      setDraftAt(d.savedAt);
    } else {
      if (d) drafts.clear(persona.id, section);
      setText(server);
      setDraftAt(null);
    }
    const key = `${persona.id}:${section}`;
    if (lastKey.current !== key) {
      lastKey.current = key;
      setNote('');
      setFlash(null);
      versions.hide();
    }
  }, [persona.id, section, server]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(timer.current), []);

  const parsed = useMemo(() => {
    try {
      return { ok: true, doc: JSON.parse(text) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, [text]);

  const dirty = text !== server;

  const edit = useCallback(
    (next) => {
      setText(next);
      setFlash(null);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (next === server) {
          drafts.clear(persona.id, section);
          setDraftAt(null);
        } else {
          drafts.write(persona.id, section, next);
          setDraftAt(Date.now());
        }
      }, DRAFT_DELAY_MS);
    },
    [persona.id, section, server],
  );

  const reset = () => {
    clearTimeout(timer.current);
    drafts.clear(persona.id, section);
    setText(server);
    setDraftAt(null);
    setFlash(null);
  };

  const save = useCallback(async () => {
    if (!parsed.ok || !dirty || busy) return;
    setBusy(true);
    try {
      const r = await putSection(persona.id, section, parsed.doc, note.trim() || undefined);
      drafts.clear(persona.id, section);
      setDraftAt(null);
      setNote('');
      setFlash(r.unchanged ? 'Ничего не изменилось' : 'Сохранено — прежняя версия в истории');
      onSaved();
    } catch (e) {
      onError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }, [parsed, dirty, busy, persona.id, section, note, onSaved, onError]);

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

  const notes = Object.entries(stored ?? {}).filter(([k, v]) => k.startsWith('_') && typeof v === 'string');

  return (
    <div className={p.section}>
      <div className={p.sectionBar}>
        <div className={p.modes}>
          <button className={`${p.modeBtn} ${mode === 'form' ? p.modeBtnActive : ''}`} onClick={() => setMode('form')}>Форма</button>
          <button className={`${p.modeBtn} ${mode === 'json' ? p.modeBtnActive : ''}`} onClick={() => setMode('json')}>JSON</button>
        </div>
        <span className={s.muted}>
          {(text.length / 1024).toFixed(1)} КБ
          {section === 'beats' && stored === null && ' · биты выводятся из сюжетов'}
        </span>
        <div className={s.actions}>
          <button className={s.btnSm} onClick={versions.toggle}>
            {versions.open ? 'Скрыть историю' : 'История версий'}
          </button>
          <button className={s.btnSm} disabled={!dirty} onClick={reset}>Отменить правки</button>
        </div>
      </div>

      {draftAt && dirty && (
        <p className={p.draftNote}>
          Черновик сохранён в браузере ({ago(draftAt)}) — правки не потеряются при перезагрузке.
        </p>
      )}

      {notes.length > 0 && (
        <details className={p.notes}>
          <summary>Заметки автора — {notes.length}</summary>
          <ul>
            {notes.map(([k, v]) => (
              <li key={k}>
                <span className={s.mono}>{k}</span> — {v}
              </li>
            ))}
          </ul>
        </details>
      )}

      <VersionsTable versions={versions.versions} onRestore={versions.restore} />

      {mode === 'json' || !parsed.ok ? (
        <textarea
          className={`${s.field} ${p.json}`}
          spellCheck={false}
          value={text}
          onChange={(e) => edit(e.target.value)}
        />
      ) : Array.isArray(parsed.doc) ? (
        <div className={p.docBody}>
          <DocEditor doc={{ beats: parsed.doc }} onChange={(next) => edit(pretty(next.beats))} />
        </div>
      ) : (
        <DocEditor doc={parsed.doc} onChange={(next) => edit(pretty(next))} />
      )}

      <div className={p.stickyBar}>
        {!parsed.ok && <span className={s.error}>JSON не разбирается: {parsed.error}</span>}
        {flash && !dirty && <span className={s.ok}>{flash}</span>}
        <input
          className={s.field}
          style={{ maxWidth: 240 }}
          placeholder="подпись к версии"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className={s.btnPrimary} disabled={!dirty || !parsed.ok || busy} onClick={save} title="Ctrl+S">
          {busy ? 'Сохранение…' : 'Сохранить секцию'}
        </button>
      </div>
    </div>
  );
}
