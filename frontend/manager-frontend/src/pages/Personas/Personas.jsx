import { PanelUX } from '../../ui/PanelUX';
import { useCallback, useEffect, useRef, useState } from 'react';
import Header from '../../components/Header/Header';
import {
  createPersona,
  deletePersona,
  duplicatePersona,
  exportPersona,
  getPersona,
  getPersonas,
  getModelOptions,
  getPromptDefaults,
  importPersona,
  setDefaultPersona,
  updatePersona,
} from '../../api/personas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import PromptsEditor from './PromptsEditor';
import RhythmEditor from './RhythmEditor';
import VariablesEditor from './VariablesEditor';
import SectionEditor from './SectionEditor';
import { personaFileName, readPersonaFile } from './personaFile';
import { saveJsonFile } from './files';
import { drafts } from './drafts';

const TABS = [
  { key: 'prompts', label: 'Промпты' },
  { key: 'rhythm', label: 'Ритм' },
  { key: 'persona', label: 'Карточка' },
  { key: 'goals', label: 'Цели' },
  { key: 'storylines', label: 'Сюжеты' },
  { key: 'dayConfig', label: 'День' },
  { key: 'beats', label: 'Биты' },
  { key: 'variables', label: 'Переменные' },
];

function CreateDialog({ open, personas, onDone, onCancel }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Новая личность</DialogTitle>
          <DialogDescription>
            Кем говорит бот. Документы можно скопировать у существующей личности.
          </DialogDescription>
        </DialogHeader>
        <CreateForm personas={personas} onDone={onDone} onCancel={onCancel} />
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ personas, onDone, onCancel }) {
  const [f, setF] = useState({ name: '', slug: '', copy_from: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy || !f.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createPersona({
        name: f.name.trim(),
        slug: f.slug.trim() || undefined,
        copy_from: f.copy_from ? Number(f.copy_from) : undefined,
      });
      onDone(created.id);
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="flex flex-col gap-3 px-6 py-4">
        <Field label="Имя">
          <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Идентификатор (латиницей)">
          <Input placeholder="соберём из имени" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />
        </Field>
        <Field label="Скопировать документы у">
          <NativeSelect value={f.copy_from} onChange={(e) => setF({ ...f, copy_from: e.target.value })}>
            <option value="">— пустая личность —</option>
            {personas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </NativeSelect>
        </Field>
        <p className="min-h-4 text-xs text-destructive" role="status">{error || ''}</p>
      </div>
      <DialogFooter className="border-t px-6 py-4">
        <Button type="button" variant="outline" onClick={onCancel}>Отмена</Button>
        <Button type="submit" disabled={busy || !f.name.trim()}>{busy ? 'Создание…' : 'Создать'}</Button>
      </DialogFooter>
    </form>
  );
}

const SECTION_KEYS = TABS.map((t) => t.key);

function ModelSelect({ label, hint, value, options, fallback, onChange }) {
  const fallbackLabel = options.find((o) => o.id === fallback)?.label ?? fallback;
  return (
    <Field label={label} hint={hint} className="min-w-60 flex-1 sm:max-w-sm">
      <NativeSelect value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">по умолчанию — {fallbackLabel}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </NativeSelect>
    </Field>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1" role="status" aria-label="Загружаю личности">
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex min-h-[60vh] flex-col gap-4" role="status" aria-label="Загружаю личность">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export default function Personas() {
  const [items, setItems] = useState([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [selected, setSelected] = useState(null);
  const [persona, setPersona] = useState(null);
  const [defaults, setDefaults] = useState(null);
  // undefined — ещё грузятся (скелет), null — не удалось получить (ряд спрятан).
  const [models, setModels] = useState(undefined);
  const [tab, setTab] = useState('prompts');
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [flash, setFlash] = useState(null);
  const filePicker = useRef(null);
  const [drafted, setDrafted] = useState([]);
  const refreshDrafts = useCallback(() => {
    setDrafted(items.map((x) => ({ id: x.id, sections: drafts.sectionsOf(x.id, SECTION_KEYS) })));
  }, [items]);
  useEffect(refreshDrafts, [refreshDrafts, tab, persona]);

  const loadList = useCallback(async () => {
    try {
      const list = await getPersonas();
      setItems(list.items);
      return list.items;
    } finally {
      setListLoaded(true);
    }
  }, []);

  const loadOne = useCallback(async (id) => {
    setPersona(await getPersona(id));
  }, []);

  useEffect(() => {
    Promise.all([loadList(), getPromptDefaults(), getModelOptions().catch(() => null)])
      .then(([list, d, m]) => {
        setDefaults(d);
        setModels(m);
        if (list.length) setSelected((cur) => cur ?? list[0].id);
      })
      .catch((e) => {
        setModels((cur) => (cur === undefined ? null : cur));
        setError(e.detail || e.message);
      });
  }, [loadList]);

  useEffect(() => {
    if (selected == null) return;
    loadOne(selected).catch((e) => setError(e.detail || e.message));
  }, [selected, loadOne]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await loadList();
      if (selected != null) await loadOne(selected);
    } catch (e) {
      setError(e.detail || e.message);
    }
  }, [loadList, loadOne, selected]);

  async function run(fn) {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e.detail || e.message);
    }
  }

  async function rename() {
    const name = window.prompt('Имя личности (оно же имя в разговоре):', persona.name);
    if (name == null || !name.trim() || name === persona.name) return;
    setRenaming(true);
    try {
      await run(() => updatePersona(persona.id, { name: name.trim() }));
    } finally {
      setRenaming(false);
    }
  }

  async function exportFile() {
    setError(null);
    try {
      const doc = await exportPersona(persona.id);
      saveJsonFile(personaFileName(persona), doc);
      setFlash(`Выгружено в ${personaFileName(persona)} — ${Object.keys(doc.sections).length} секций`);
    } catch (e) {
      setError(e.detail || e.message);
    }
  }

  async function importFile(file) {
    if (!file) return;
    setError(null);
    setFlash(null);
    try {
      const parsed = readPersonaFile(await file.text(), SECTION_KEYS);
      const names = Object.keys(parsed.sections);
      const from = parsed.from ? ` (из «${parsed.from}»)` : '';
      const question = `Заменить у «${persona.name}» ${names.length} секций${from}: ${names.join(', ')}?`;
      const undo = 'Прежние документы уйдут в историю версий — откатить можно кнопкой «Вернуть».';
      if (!await PanelUX.confirm([question, undo].join('\n'))) return;
      const r = await importPersona(persona.id, parsed.sections, `файл ${file.name}`);
      for (const name of r.applied) drafts.clear(persona.id, name);
      await refresh();
      const skipped = parsed.skipped.length ? `; не взяли: ${parsed.skipped.join(', ')}` : '';
      const same = r.unchanged.length ? `, без изменений ${r.unchanged.length}` : '';
      setFlash(`Из файла ${file.name}: обновлено ${r.applied.length} секц.${same}${skipped}`);
    } catch (e) {
      setError(`${file.name}: ${e.detail || e.message}`);
    }
  }

  async function duplicate() {
    setError(null);
    try {
      const copy = await duplicatePersona(persona.id);
      await loadList();
      setSelected(copy.id);
    } catch (e) {
      setError(e.detail || e.message);
    }
  }

  async function remove() {
    if (!await PanelUX.confirm(`Удалить личность «${persona.name}»? Документы и история версий будут стёрты.`)) return;
    run(async () => {
      await deletePersona(persona.id);
      const list = await loadList();
      setSelected(list[0]?.id ?? null);
      setPersona(list.length ? null : null);
    });
  }

  const draftSections = (id) => drafted.find((d) => d.id === id)?.sections ?? [];
  const detailLoading = !persona && (!listLoaded || selected != null);

  return (
    <div className="app">
      <Header />
      <main className="main">
        <div className="container">
          <div className="my-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Личности</h2>
            <Button disabled={creating} onClick={() => setCreating(true)}>+ Новая личность</Button>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Кем говорит бот. Аккаунт ссылается на личность идентификатором (<span className="font-mono">persona_id</span>),
            одна личность может стоять на нескольких аккаунтах. Правки действуют со следующего ответа.
          </p>
          <CreateDialog
            open={creating}
            personas={items}
            onCancel={() => setCreating(false)}
            onDone={async (id) => { setCreating(false); await loadList(); setSelected(id); }}
          />
          <p
            role="status"
            className={cn('my-3 min-h-5 text-sm', error ? 'text-destructive' : 'text-success-foreground')}
          >
            {error || flash || ''}
          </p>

          <div className="grid items-start gap-4 pb-6 lg:grid-cols-[240px_minmax(0,1fr)]">
            <Card className="gap-1 p-2 lg:sticky lg:top-[calc(var(--header-h)+12px)]">
              {!listLoaded && items.length === 0 ? (
                <ListSkeleton />
              ) : (
                <div className="flex gap-1 max-lg:overflow-x-auto lg:flex-col">
                  {items.map((x) => {
                    const active = x.id === selected;
                    return (
                      <Button
                        key={x.id}
                        variant="ghost"
                        aria-current={active ? 'true' : undefined}
                        data-active={active || undefined}
                        className="h-auto min-w-40 flex-col items-start justify-start gap-1 px-3 py-2 text-left font-normal whitespace-normal data-[active]:bg-accent lg:w-full"
                        onClick={() => setSelected(x.id)}
                      >
                        <span className="text-sm font-semibold">{x.name}</span>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="font-mono">{x.slug}</span>
                          {x.is_default && <Badge className="h-5">основная</Badge>}
                          {!x.enabled && <Badge variant="secondary" className="h-5">выключена</Badge>}
                          {x.accounts > 0 && <span className="tabular-nums">{x.accounts} акк.</span>}
                          {draftSections(x.id).length > 0 && (
                            <span className="text-warning-foreground" title="есть несохранённые правки">● черновик</span>
                          )}
                        </span>
                      </Button>
                    );
                  })}
                  {items.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Личностей нет</p>}
                </div>
              )}
            </Card>

            <Card className="min-w-0 gap-4 p-4">
              {!persona ? (
                detailLoading ? (
                  <DetailSkeleton />
                ) : (
                  <p className="min-h-[60vh] text-sm text-muted-foreground">Выберите личность слева</p>
                )
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="flex flex-wrap items-baseline gap-2 text-base font-semibold">
                        {persona.name} <span className="font-mono text-xs font-normal text-muted-foreground">{persona.slug}</span>
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                        {persona.card_lines} строк карточки · {persona.examples} примеров тона ·{' '}
                        {persona.storylines} сюжетов · промптов изменено {persona.edited_prompts} ·{' '}
                        {persona.accounts} аккаунт(ов)
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" disabled={renaming} onClick={rename}>Переименовать</Button>
                      <Button variant="outline" size="sm" title="Копия со всеми документами и промптами" onClick={duplicate}>
                        Дублировать
                      </Button>
                      <Button variant="outline" size="sm" title="Скачать личность одним файлом: все секции сразу" onClick={exportFile}>
                        Выгрузить всё
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        title="Взять секции из файла — прежние уйдут в историю версий"
                        onClick={() => filePicker.current?.click()}
                      >
                        Загрузить всё
                      </Button>
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
                      {!persona.is_default && (
                        <Button variant="outline" size="sm" onClick={() => run(() => setDefaultPersona(persona.id))}>Сделать основной</Button>
                      )}
                      {!persona.is_default && (
                        <Button variant="outline" size="sm" onClick={() => run(() => updatePersona(persona.id, { enabled: !persona.enabled }))}>
                          {persona.enabled ? 'Выключить' : 'Включить'}
                        </Button>
                      )}
                      {!persona.is_default && (
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={remove}>
                          Удалить
                        </Button>
                      )}
                    </div>
                  </div>

                  {models === undefined ? (
                    <div className="flex flex-wrap gap-4" role="status" aria-label="Загружаю модели">
                      <Skeleton className="h-20 min-w-60 flex-1 sm:max-w-sm" />
                      <Skeleton className="h-20 min-w-60 flex-1 sm:max-w-sm" />
                    </div>
                  ) : models ? (
                    <div className="flex flex-wrap gap-4">
                      <ModelSelect
                        label="Модель ответов"
                        hint="пишет реплики клиенту"
                        value={persona.generator_model}
                        options={models.generator}
                        fallback={models.defaults.generator}
                        onChange={(v) => run(() => updatePersona(persona.id, { generator_model: v }))}
                      />
                      <ModelSelect
                        label="Модель судей"
                        hint="план диалога и проверка ответа — два вызова на реплику"
                        value={persona.judge_model}
                        options={models.judge}
                        fallback={models.defaults.judge}
                        onChange={(v) => run(() => updatePersona(persona.id, { judge_model: v }))}
                      />
                    </div>
                  ) : null}

                  <Tabs value={tab} onValueChange={setTab}>
                    <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0 [scrollbar-width:none]">
                      {TABS.map((t) => (
                        <TabsTrigger
                          key={t.key}
                          value={t.key}
                          className="-mb-px h-9 flex-none rounded-none border-0 border-b-2 border-transparent px-3 text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                        >
                          {t.label}
                          <span className="inline-block w-2.5 text-left text-xs text-warning-foreground" aria-hidden={!draftSections(persona.id).includes(t.key)}>
                            {draftSections(persona.id).includes(t.key) ? '●' : ''}
                          </span>
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>

                  <div className="min-h-[60vh]">
                    {tab === 'prompts' ? (
                      <PromptsEditor persona={persona} defaults={defaults} onSaved={refresh} onError={setError} />
                    ) : tab === 'rhythm' ? (
                      <RhythmEditor persona={persona} onSaved={refresh} onError={setError} />
                    ) : tab === 'variables' ? (
                      <VariablesEditor persona={persona} onSaved={refresh} onError={setError} />
                    ) : (
                      <SectionEditor persona={persona} section={tab} onSaved={refresh} onError={setError} />
                    )}
                  </div>
                </>
              )}
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
