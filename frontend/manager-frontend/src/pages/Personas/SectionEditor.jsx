import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPersona, putSection } from '../../api/personas';
import { Copy, FileJson, FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import VersionsTable, { useVersions } from './Versions';
import { EditorBar, SaveBar } from './EditorBar';
import DocEditor from './DocEditor';
import { drafts } from './drafts';

const DRAFT_DELAY_MS = 600;
const pretty = (value) => JSON.stringify(value ?? {}, null, 2);

/** Пусто: нет документа, пустой массив или только служебные ключи (_заметки). */
export const isEmptyDoc = (doc) =>
  doc == null ||
  (Array.isArray(doc) ? doc.length === 0 : typeof doc === 'object' && Object.keys(doc).filter((k) => !k.startsWith('_')).length === 0);

/**
 * Пустой раздел: что в нём бывает и с чего начать — скопировать у другой
 * личности, у которой раздел заполнен, или набрать в JSON. Копия ложится в
 * черновик; сохраняет обычная кнопка.
 */
function EmptySection({ section, about, persona, personas, onCopy, onJson }) {
  const [sources, setSources] = useState(null);
  useEffect(() => {
    let alive = true;
    const others = (personas ?? []).filter((p) => p.id !== persona.id);
    Promise.all(others.map((p) => getPersona(p.id).catch(() => null)))
      .then((full) => {
        if (!alive) return;
        setSources(full.filter((p) => p && !isEmptyDoc(p.sections?.[section])));
      });
    return () => {
      alive = false;
    };
  }, [personas, persona.id, section]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center" data-testid="section-empty">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <FileQuestion className="size-5" aria-hidden="true" />
      </span>
      <div className="flex max-w-md flex-col gap-1">
        <p className="text-sm font-medium">Раздел пока пуст</p>
        <p className="text-sm text-muted-foreground">
          {section === 'beats' ? 'Пока пусто — биты берутся из сюжетов автоматически. Заполните, если нужен свой порядок шагов.' : about}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {sources === null ? (
          <Button type="button" size="sm" variant="outline" disabled>Ищу заполненные у других личностей…</Button>
        ) : (
          sources.map((p) => (
            <Button key={p.id} type="button" size="sm" onClick={() => onCopy(p)}>
              <Copy aria-hidden="true" />
              {`Скопировать у «${p.name}»`}
            </Button>
          ))
        )}
        <Button type="button" size="sm" variant="outline" onClick={onJson}>
          <FileJson aria-hidden="true" />
          Заполнить в JSON
        </Button>
      </div>
    </div>
  );
}

export default function SectionEditor({ persona, section, about = null, personas = [], onSaved, onError }) {
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
    <div className="flex flex-1 flex-col gap-3">
      <EditorBar
        leading={
          <Tabs value={mode} onValueChange={setMode}>
            <TabsList>
              <TabsTrigger value="form" className="px-3 text-xs">Форма</TabsTrigger>
              <TabsTrigger value="json" className="px-3 text-xs">JSON</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        summary={
          <>
            {(text.length / 1024).toFixed(1)} КБ
            {section === 'beats' && stored === null && ' · биты выводятся из сюжетов'}
          </>
        }
        draftAt={draftAt}
        dirty={dirty}
        versions={versions}
        onReset={reset}
      />

      {notes.length > 0 && (
        <details className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground [&_summary]:cursor-pointer [&_summary]:select-none [&_summary]:text-foreground">
          <summary>Заметки автора — {notes.length}</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 leading-snug">
            {notes.map(([k, v]) => (
              <li key={k}>
                <span className="font-mono">{k}</span> — {v}
              </li>
            ))}
          </ul>
        </details>
      )}

      <VersionsTable versions={versions.versions} loading={versions.loading} onRestore={versions.restore} />

      {mode === 'form' && parsed.ok && isEmptyDoc(parsed.doc) ? (
        <EmptySection
          section={section}
          about={about}
          persona={persona}
          personas={personas}
          onJson={() => setMode('json')}
          onCopy={(from) => {
            edit(pretty(from.sections[section]));
            setFlash(`Скопировано у «${from.name}» — проверьте и сохраните`);
          }}
        />
      ) : mode === 'json' || !parsed.ok ? (
        <Textarea
          className="field-sizing-fixed min-h-[60vh] resize-y overflow-x-auto font-mono text-xs leading-normal whitespace-pre [overflow-wrap:normal]"
          spellCheck={false}
          value={text}
          onChange={(e) => edit(e.target.value)}
        />
      ) : Array.isArray(parsed.doc) ? (
        <div className="min-w-0 max-h-[62vh] overflow-y-auto pr-1.5 [scrollbar-gutter:stable]">
          <DocEditor doc={{ beats: parsed.doc }} onChange={(next) => edit(pretty(next.beats))} />
        </div>
      ) : (
        <DocEditor doc={parsed.doc} onChange={(next) => edit(pretty(next))} />
      )}

      <SaveBar
        error={parsed.ok ? null : `JSON не разбирается: ${parsed.error}`}
        status={flash}
        note={note}
        onNote={setNote}
        onSave={save}
        disabled={!dirty || !parsed.ok || busy}
        busy={busy}
        label="Сохранить секцию"
      />
    </div>
  );
}
