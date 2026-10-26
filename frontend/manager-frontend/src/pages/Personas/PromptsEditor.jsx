import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { putSection } from '../../api/personas';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Download, RotateCcw, Upload } from 'lucide-react';
import { HelpHint } from '@/components/HelpHint/HelpHint';
import { IconAction } from '@/components/IconAction/IconAction';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { HighlightTextarea, unknownVariables } from './HighlightTextarea';
import { BUILTINS, CHAT_VARIABLES } from './variables';
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
  // Раскрытые тексты: по умолчанию все свёрнуты — видно список целиком, а не стену полей.
  const [open, setOpen] = useState(() => new Set());
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
  // Известные переменные: встроенные, из чата лида и заданные на вкладке «Переменные».
  const known = new Set([
    ...Object.keys(BUILTINS),
    ...Object.keys(CHAT_VARIABLES),
    ...Object.keys(persona.sections.variables ?? {}).filter((k) => !k.startsWith('_')),
  ]);
  const allOpen = open.size === defaults.keys.length;
  const toggle = (key) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex flex-1 flex-col gap-4">
      <EditorBar
        summary={`${defaults.keys.length} текстов · ${changed > 0 ? `${changed} отличается от кода` : 'как в коде'}`}
        helpLabel="Промпты"
        help={
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
        <Button type="button" variant="ghost" size="xs" onClick={() => setOpen(allOpen ? new Set() : new Set(defaults.keys))}>
          {allOpen ? 'Свернуть все' : 'Развернуть все'}
        </Button>
        <IconAction icon={Download} label="Выгрузить в файл" hint="Выгрузить в файл: скачать тексты одним файлом" onClick={exportFile} />
        <IconAction icon={Upload} label="Загрузить из файла" hint="Загрузить из файла — применит обычное сохранение" onClick={() => filePicker.current?.click()} />
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

      <div className="flex flex-col divide-y rounded-lg border bg-card" data-testid="prompt-list">
        {defaults.keys.map((key) => {
          const label = defaults.labels[key];
          const value = draft[key] ?? '';
          const same = value === defaults.defaults[key];
          const expanded = open.has(key);
          const unknown = unknownVariables(value, known);
          const preview = value.trim().split('\n')[0] || 'пусто';
          return (
            <section key={key} className="flex flex-col" data-prompt={key}>
              <div className="flex min-h-11 items-center gap-2 px-3">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? 'Свернуть' : 'Развернуть'}: ${label.title}`}
                  className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  onClick={() => toggle(key)}
                >
                  <ChevronRight aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
                  <span className="shrink-0 text-sm font-medium">{label.title}</span>
                  {!same && <Badge variant="outline" className="h-5 shrink-0 font-normal text-muted-foreground">изменён</Badge>}
                  {unknown.length > 0 && (
                    <Badge variant="destructive" className="h-5 shrink-0 font-normal" title={`Нет таких переменных: ${unknown.map((u) => `{${u}}`).join(', ')}`}>
                      {`нет переменной {${unknown[0]}}${unknown.length > 1 ? ` +${unknown.length - 1}` : ''}`}
                    </Badge>
                  )}
                  {!expanded && <span className="min-w-0 truncate text-xs text-muted-foreground">{preview}</span>}
                </button>
                {label.hint && <HelpHint label={label.title}>{label.hint}</HelpHint>}
                <span className="min-w-16 text-right text-xs text-muted-foreground tabular-nums">{value.length} симв.</span>
                <IconAction icon={RotateCcw} label="Текст из кода" hint="Подставить в поле текст, зашитый в коде" disabled={same} onClick={() => set(key, defaults.defaults[key])} />
              </div>
              {expanded && (
                <div className="flex flex-col gap-1.5 px-3 pb-3">
                  <HighlightTextarea
                    aria-label={label.title}
                    known={known}
                    className="field-sizing-fixed resize-y leading-relaxed"
                    rows={SHORT.has(key) ? 2 : 12}
                    spellCheck={false}
                    value={value}
                    onChange={(e) => set(key, e.target.value)}
                  />
                  {unknown.length > 0 && (
                    <p className="text-xs text-destructive" role="alert">
                      {`Нет таких переменных: ${unknown.map((u) => `{${u}}`).join(', ')} — задайте их во вкладке «Переменные» или исправьте написание.`}
                    </p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

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
