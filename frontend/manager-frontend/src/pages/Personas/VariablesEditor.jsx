import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, TriangleAlert, X } from 'lucide-react';
import { putSection } from '../../api/personas';
import { IconAction } from '@/components/IconAction/IconAction';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  stickyLastCol,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import VersionsTable, { useVersions } from './Versions';
import { EditorBar, SaveBar } from './EditorBar';
import { drafts } from './drafts';
import { SECTION_LABELS, docFromRows, rowErrors, rowsFromDoc, usages } from './variables';

const DRAFT_DELAY_MS = 600;
const BUILTINS = { name: 'имя личности' };
const CHAT_VARIABLES = { city: 'город лида', site: 'сайт знакомств лида' };

const HEAD = 'h-9 px-3 text-xs font-medium text-muted-foreground';
// Таблица идёт во всю ширину блока личности и отделена линиями, без своей рамки.
const EDGE = '[&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4';
const CELL = 'p-3 align-top whitespace-normal [overflow-wrap:anywhere]';

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
  const keyInputs = useRef([]);
  const focusRow = useRef(null);

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
  }, [persona.id, serverText]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(timer.current), []);

  // Новая строка получает фокус в поле имени — сразу можно печатать.
  useEffect(() => {
    if (focusRow.current == null) return;
    keyInputs.current[focusRow.current]?.focus();
    focusRow.current = null;
  }, [rows]);

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
  const addRow = (key = '') => {
    focusRow.current = rows.length;
    update([...rows, { key, value: '', note: '' }]);
  };
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
    <div className="flex flex-1 flex-col gap-4">
      <EditorBar
        summary={`${defined.size} переменн. · в текстах используется ${[...used.keys()].length}`}
        helpLabel="Переменные"
        help={
          <>
            Напишите <span className="font-mono">{'{site}'}</span> в любой вкладке — промпты, карточка, цели, сюжеты, день, биты —
            и задайте значение здесь. Бот увидит значение, в редакторах останется <span className="font-mono">{'{site}'}</span>.
            Имена — буквы (можно русские), цифры и «_». Незаданная <span className="font-mono">{'{…}'}</span> остаётся в тексте как есть.
            <span className="font-mono"> {'{city}'}</span> и <span className="font-mono">{'{site}'}</span> у каждого диалога свои — из
            города и сайта лида; значения здесь для них запасные.
          </>
        }
        draftAt={draftAt}
        dirty={dirty}
        versions={versions}
        onReset={reset}
      >
        <Button variant="outline" className="mr-1" onClick={() => addRow()}>
          <Plus aria-hidden="true" />
          Переменная
        </Button>
      </EditorBar>

      {missing.length > 0 && (
        <Alert variant="warning" className="py-2.5">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-row flex-wrap items-center gap-1.5 text-xs">
            <span>В текстах есть, но не заданы:</span>
            {missing.map((key) => (
              <Button
                key={key}
                variant="outline"
                size="xs"
                className="font-mono"
                title={`Используется: ${where(key).join(', ')}`}
                onClick={() => addRow(key)}
              >
                + {`{${key}}`}
              </Button>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <VersionsTable versions={versions.versions} loading={versions.loading} onRestore={versions.restore} />

      <div className="-mx-4 border-t">
        <Table className={cn(stickyLastCol, EDGE, 'min-w-[760px]')}>
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>Переменная</TableHead>
              <TableHead className={HEAD}>Значение</TableHead>
              <TableHead className={HEAD}>Пояснение</TableHead>
              <TableHead className={HEAD}>Где используется</TableHead>
              <TableHead className={cn(HEAD, 'w-0')}><span className="sr-only">Действия</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(BUILTINS).map(([key, label]) => (
              <TableRow key={`builtin-${key}`} className="text-muted-foreground">
                <TableCell className={cn(CELL, 'font-mono')}>{`{${key}}`}</TableCell>
                <TableCell className={CELL}>{persona.name}</TableCell>
                <TableCell className={cn(CELL, 'text-muted-foreground')}>{label} — встроенная, меняется переименованием</TableCell>
                <TableCell className={cn(CELL, 'text-muted-foreground')}>{where(key).join(', ') || '—'}</TableCell>
                <TableCell className={CELL}></TableCell>
              </TableRow>
            ))}
            {Object.entries(CHAT_VARIABLES).map(([key, label]) => {
              const fallback = rows.find((r) => String(r.key).trim() === key);
              return (
                <TableRow key={`chat-${key}`} className="text-muted-foreground">
                  <TableCell className={cn(CELL, 'font-mono')}>{`{${key}}`}</TableCell>
                  <TableCell className={CELL}>из карточки лида</TableCell>
                  <TableCell className={cn(CELL, 'text-muted-foreground')}>
                    {label}; у лида пусто — {fallback?.value ? `«${fallback.value}» из строки ниже` : 'добавьте строку ниже с запасным значением'}
                  </TableCell>
                  <TableCell className={cn(CELL, 'text-muted-foreground')}>{where(key).join(', ') || '—'}</TableCell>
                  <TableCell className={CELL}></TableCell>
                </TableRow>
              );
            })}
            {rows.map((row, i) => {
              const key = String(row.key).trim();
              const places = key ? where(key) : [];
              return (
                <TableRow key={i}>
                  <TableCell className={CELL}>
                    <span className="inline-flex items-center gap-0.5">
                      <span className="text-muted-foreground">{'{'}</span>
                      <Input
                        ref={(el) => { keyInputs.current[i] = el; }}
                        className="w-36 font-mono text-xs"
                        value={row.key}
                        placeholder="site"
                        aria-invalid={errors[i] ? true : undefined}
                        onChange={(e) => setCell(i, 'key', e.target.value)}
                      />
                      <span className="text-muted-foreground">{'}'}</span>
                    </span>
                    <span className="mt-1 block min-h-4 text-xs text-destructive">{errors[i] || ''}</span>
                  </TableCell>
                  <TableCell className={CELL}>
                    <Input
                      className="min-w-40"
                      value={row.value}
                      placeholder="значение"
                      onChange={(e) => setCell(i, 'value', e.target.value)}
                    />
                  </TableCell>
                  <TableCell className={CELL}>
                    <Input
                      className="min-w-40"
                      value={row.note}
                      placeholder="для себя"
                      onChange={(e) => setCell(i, 'note', e.target.value)}
                    />
                  </TableCell>
                  <TableCell className={cn(CELL, 'pt-4', !places.length && 'text-muted-foreground')}>{places.join(', ') || 'нигде'}</TableCell>
                  <TableCell className={CELL}>
                    <IconAction icon={X} label="Удалить переменную" tone="danger" onClick={() => removeRow(i)} />
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className={cn(CELL, 'text-muted-foreground')}>
                  Переменных пока нет — нажмите «Переменная» или добавьте из списка незаданных выше.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <SaveBar
        error={invalid ? 'Исправьте имена переменных' : null}
        status={flash}
        note={note}
        onNote={setNote}
        onSave={save}
        disabled={!dirty || busy || invalid}
        busy={busy}
        label="Сохранить переменные"
      />
    </div>
  );
}
