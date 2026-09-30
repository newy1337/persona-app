import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { putSection } from '../../api/personas';
import VersionsTable, { ago, useVersions } from './Versions';
import { buildPromptsFile, promptsFileName, readPromptsFile } from './promptsFile';
import { saveJsonFile } from './files';
import { drafts } from './drafts';
import s from '../../styles/AdminPage.module.scss';
import p from './Personas.module.scss';

const DRAFT_DELAY_MS = 600;
const SHORT = new Set(['opener', 'intro']);

export default function PromptsEditor({ persona, defaults, onSaved, onError }) {
  const server = persona.sections.prompts ?? {};
  const serverText = useMemo(() => JSON.stringify(server), [server]);

  const [draft, setDraft] = useState(server);
  const [draftAt, setDraftAt] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const timer = useRef(null);
  const lastId = useRef(null);
  const filePicker = useRef(null);

  const versions = useVersions(persona.id, 'prompts', { onRestored: onSaved, onError });

  useEffect(() => {
    const d = drafts.read(persona.id, 'prompts');
    if (d && d.text !== serverText) {
      try {
        setDraft(JSON.parse(d.text));
        setDraftAt(d.savedAt);
      } catch {
        drafts.clear(persona.id, 'prompts');
        setDraft(server);
        setDraftAt(null);
      }
    } else {
      if (d) drafts.clear(persona.id, 'prompts');
      setDraft(server);
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

  const dirty = JSON.stringify(draft) !== serverText;

  const set = (key, value) => {
    setFlash(null);
    setDraft((v) => {
      const next = { ...v, [key]: value };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (JSON.stringify(next) === serverText) {
          drafts.clear(persona.id, 'prompts');
          setDraftAt(null);
        } else {
          drafts.write(persona.id, 'prompts', JSON.stringify(next));
          setDraftAt(Date.now());
        }
      }, DRAFT_DELAY_MS);
      return next;
    });
  };

  const reset = () => {
    clearTimeout(timer.current);
    drafts.clear(persona.id, 'prompts');
    setDraft(server);
    setDraftAt(null);
    setFlash(null);
  };

  function exportFile() {
    setFlash(null);
    const doc = buildPromptsFile(persona, server, defaults.keys);
    saveJsonFile(promptsFileName(persona), doc);
    setFlash(`Выгружено в ${promptsFileName(persona)}`);
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const parsed = readPromptsFile(await file.text(), defaults.keys);
      const next = { ...server, ...parsed.prompts };
      clearTimeout(timer.current);
      setDraft(next);
      if (JSON.stringify(next) === serverText) {
        drafts.clear(persona.id, 'prompts');
        setDraftAt(null);
      } else {
        drafts.write(persona.id, 'prompts', JSON.stringify(next));
        setDraftAt(Date.now());
      }
      const count = Object.keys(parsed.prompts).length;
      const from = parsed.from && parsed.from !== persona.name ? ` от «${parsed.from}»` : '';
      const skipped = parsed.skipped.length ? `; не взяли: ${parsed.skipped.join(', ')}` : '';
      setFlash(`Из файла${from}: ${count} текст(ов)${skipped} — проверьте и сохраните`);
    } catch (e) {
      onError(`${file.name}: ${e.message}`);
    }
  }

  const save = useCallback(async () => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const r = await putSection(persona.id, 'prompts', draft, note.trim() || undefined);
      drafts.clear(persona.id, 'prompts');
      setDraftAt(null);
      setNote('');
      setFlash(r.unchanged ? 'Ничего не изменилось' : 'Сохранено — прежние тексты в истории');
      onSaved();
    } catch (e) {
      onError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }, [dirty, busy, draft, note, persona.id, onSaved, onError]);

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

  if (!defaults) return <p className={s.empty}>Загружаю тексты…</p>;

  const changed = defaults.keys.filter((k) => (draft[k] ?? '') !== (defaults.defaults[k] ?? '')).length;

  return (
    <div className={p.prompts}>
      <div className={p.sectionBar}>
        <span className={s.muted}>
          {defaults.keys.length} текстов · {changed > 0 ? `${changed} отличается от кода` : 'как в коде'}
        </span>
        <div className={s.actions}>
          <button className={s.btnSm} title="Скачать тексты одним файлом" onClick={exportFile}>
            Выгрузить в файл
          </button>
          <button
            className={s.btnSm}
            title="Взять тексты из файла — применит обычное сохранение"
            onClick={() => filePicker.current?.click()}
          >
            Загрузить из файла
          </button>
          <input
            ref={filePicker}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void importFile(file);
            }}
          />
          <button className={s.btnSm} onClick={versions.toggle}>
            {versions.open ? 'Скрыть историю' : 'История версий'}
          </button>
          <button className={s.btnSm} disabled={!dirty} onClick={reset}>Отменить правки</button>
        </div>
      </div>

      <p className={s.hint}>
        Правка действует со следующего ответа, перезапуск не нужен.{' '}
        <span className={s.mono}>{'{name}'}</span> заменяется именем личности, свои{' '}
        <span className={s.mono}>{'{site}'}</span> и другие задаются на вкладке «Переменные».
      </p>

      {draftAt && dirty && (
        <p className={p.draftNote}>
          Черновик сохранён в браузере ({ago(draftAt)}) — правки не потеряются при перезагрузке.
        </p>
      )}

      <VersionsTable versions={versions.versions} onRestore={versions.restore} />

      {defaults.keys.map((key) => {
        const label = defaults.labels[key];
        const value = draft[key] ?? '';
        const same = value === defaults.defaults[key];
        return (
          <div key={key} className={p.promptBlock}>
            <div className={p.promptHead}>
              <span className={p.promptTitle}>
                {label.title}
                {!same && <span className={p.promptOwn}>изменён</span>}
              </span>
              <div className={s.actions}>
                <span className={s.muted} style={{ fontSize: 11 }}>{value.length} симв.</span>
                <button
                  className={s.btnSm}
                  disabled={same}
                  title="Подставить в поле текст, зашитый в коде"
                  onClick={() => set(key, defaults.defaults[key])}
                >
                  Текст из кода
                </button>
              </div>
            </div>
            <p className={p.promptHint}>{label.hint}</p>
            <textarea
              className={`${s.field} ${p.promptText}`}
              rows={SHORT.has(key) ? 2 : 12}
              spellCheck={false}
              value={value}
              onChange={(e) => set(key, e.target.value)}
            />
          </div>
        );
      })}

      <div className={p.stickyBar}>
        {flash && <span className={s.ok}>{flash}</span>}
        <input
          className={s.field}
          style={{ maxWidth: 240 }}
          placeholder="подпись к версии"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className={s.btnPrimary} disabled={!dirty || busy} onClick={save} title="Ctrl+S">
          {busy ? 'Сохранение…' : 'Сохранить промпты'}
        </button>
      </div>
    </div>
  );
}
