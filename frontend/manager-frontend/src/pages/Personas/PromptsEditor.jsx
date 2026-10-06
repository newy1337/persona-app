import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { putSection } from '../../api/personas';
import { Badge } from '@/components/ui/badge';
import { Download, RotateCcw, Upload } from 'lucide-react';
import { IconAction } from '@/components/IconAction/IconAction';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import VersionsTable, { useVersions } from './Versions';
import { EditorBar, SaveBar } from './EditorBar';
import { buildPromptsFile, promptsFileName, readPromptsFile } from './promptsFile';
import { saveJsonFile } from './files';
import { drafts } from './drafts';

const DRAFT_DELAY_MS = 600;
const SHORT = new Set(['opener', 'intro']);

export default function PromptsEditor({ persona, defaults, onSaved, onError }) {
  const server = persona.sections.prompts ?? {};
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [persona.id, serverText]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!defaults) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <p className="text-sm text-muted-foreground">Загружаю тексты…</p>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const changed = defaults.keys.filter((k) => (draft[k] ?? '') !== (defaults.defaults[k] ?? '')).length;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <EditorBar
        summary={`${defaults.keys.length} текстов · ${changed > 0 ? `${changed} отличается от кода` : 'как в коде'}`}
        hint={
          <>
            Правка действует со следующего ответа, перезапуск не нужен.{' '}
            <span className="font-mono">{'{name}'}</span> заменяется именем личности, свои{' '}
            <span className="font-mono">{'{site}'}</span> и другие задаются на вкладке «Переменные».
          </>
        }
        draftAt={draftAt}
        dirty={dirty}
        versions={versions}
        onReset={reset}
      >
        <IconAction icon={Download} label="Выгрузить в файл" hint="Выгрузить в файл: скачать тексты одним файлом" onClick={exportFile} />
        <IconAction
          icon={Upload}
          label="Загрузить из файла"
          hint="Загрузить из файла — применит обычное сохранение"
          onClick={() => filePicker.current?.click()}
        />
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
      </EditorBar>

      <VersionsTable versions={versions.versions} loading={versions.loading} onRestore={versions.restore} />

      {defaults.keys.map((key) => {
        const label = defaults.labels[key];
        const value = draft[key] ?? '';
        const same = value === defaults.defaults[key];
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                {label.title}
                <Badge variant="outline" className={cn('h-5 font-normal text-muted-foreground', same && 'invisible')}>изменён</Badge>
              </span>
              <div className="flex items-center gap-1">
                <span className="min-w-16 text-right text-xs text-muted-foreground tabular-nums">
                  {value.length} симв.
                </span>
                <IconAction
                  icon={RotateCcw}
                  label="Текст из кода"
                  hint="Подставить в поле текст, зашитый в коде"
                  disabled={same}
                  onClick={() => set(key, defaults.defaults[key])}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{label.hint}</p>
            <Textarea
              className="field-sizing-fixed resize-y leading-relaxed"
              rows={SHORT.has(key) ? 2 : 12}
              spellCheck={false}
              value={value}
              onChange={(e) => set(key, e.target.value)}
            />
          </div>
        );
      })}

      <SaveBar
        status={flash}
        note={note}
        onNote={setNote}
        onSave={save}
        disabled={!dirty || busy}
        busy={busy}
        label="Сохранить промпты"
      />
    </div>
  );
}
