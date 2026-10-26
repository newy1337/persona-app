import { PanelUX } from '../../ui/PanelUX';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { BookOpen, Braces, CalendarDays, Cpu, Copy, Flag, IdCard, ListChecks, MessageSquareText, MoreHorizontal, Pencil, Plus, Timer } from 'lucide-react';
import { useRouteBusy } from '@/components/AppLayout/routeBusy';
import { IconAction } from '@/components/IconAction/IconAction';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogError,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import PromptsEditor from './PromptsEditor';
import RhythmEditor from './RhythmEditor';
import VariablesEditor from './VariablesEditor';
import SectionEditor from './SectionEditor';
import { personaFileName, readPersonaFile } from './personaFile';
import { saveJsonFile } from './files';
import { drafts } from './drafts';

// Разделы личности — меню слева, по группам, с пояснением «что здесь».
// «Модели» — не документ: выбор нейросетей личности (раньше стоял в шапке).
const TABS = [
  { key: 'prompts', icon: MessageSquareText, label: 'Промпты', about: 'Инструкции: как отвечать, утро, прощание, вброс', group: 'Как говорит' },
  { key: 'persona', icon: IdCard, label: 'Карточка', about: 'Кто она: имя, возраст, город, характер', group: 'Как говорит' },
  { key: 'variables', icon: Braces, label: 'Переменные', about: 'Подстановки в промптах — {name}, {city}…', group: 'Как говорит' },
  { key: 'goals', icon: Flag, label: 'Цели', about: 'Что узнать у собеседника и к какому дню', group: 'Как ведёт разговор' },
  { key: 'storylines', icon: BookOpen, label: 'Сюжеты', about: 'Её жизнь по линиям: что рассказывать и когда', group: 'Как ведёт разговор' },
  { key: 'beats', icon: ListChecks, label: 'Биты', about: 'Ключевые шаги сценария по дням', group: 'Как ведёт разговор' },
  { key: 'dayConfig', icon: CalendarDays, label: 'День', about: 'Из чего собирается её день и настроение', group: 'Как ведёт разговор' },
  { key: 'rhythm', icon: Timer, label: 'Ритм', about: 'Как быстро отвечает и когда пишет сама', group: 'Поведение' },
  { key: 'models', icon: Cpu, label: 'Модели', about: 'Какие нейросети пишут ответы и проверяют их', group: 'Поведение' },
];
const GROUPS = [...new Set(TABS.map((t) => t.group))];

/** Раздел пуст: документа нет или в нём только служебные ключи (_заметки). */
const isEmptyDoc = (doc) =>
  doc == null || (typeof doc === 'object' && Object.keys(doc).filter((k) => !k.startsWith('_')).length === 0);

/** Короткая пометка у раздела в меню: сколько заполнено или «пусто». */
function sectionMeta(persona, key) {
  if (key === 'models') return persona.generator_model || persona.judge_model ? 'свои' : 'по умолчанию';
  if (key === 'prompts') return persona.edited_prompts ? `изменено ${persona.edited_prompts}` : 'по умолчанию';
  if (key === 'persona' && persona.card_lines) return `${persona.card_lines} строк`;
  if (key === 'storylines' && persona.storylines) return `${persona.storylines}`;
  if (key === 'rhythm') return isEmptyDoc(persona.sections?.rhythm) ? 'по умолчанию' : 'свой';
  return isEmptyDoc(persona.sections?.[key]) ? 'пусто' : null;
}

function CreateDialog({ open, personas, onDone, onCancel }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent portal={false} showCloseButton={false} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Новая личность</DialogTitle>
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
    <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Имя">
          <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Идентификатор (латиницей)">
          <Input placeholder="соберём из имени" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />
        </Field>
        <Field label="Скопировать документы у" className="col-span-full">
          <NativeSelect value={f.copy_from} onChange={(e) => setF({ ...f, copy_from: e.target.value })}>
            <option value="">— пустая личность —</option>
            {personas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </NativeSelect>
        </Field>
      </div>
      <DialogError role="status">{error || ''}</DialogError>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Отмена</Button>
        <Button type="submit" disabled={busy || !f.name.trim()}>{busy ? 'Создание…' : 'Создать'}</Button>
      </DialogFooter>
    </form>
  );
}

// Документы личности (их черновики, выгрузка и загрузка); «Модели» — не документ.
const SECTION_KEYS = TABS.map((t) => t.key).filter((k) => k !== 'models');

// Каркас списка и карточки личности общий для скелета и для данных: одни и
// те же классы задают отступы и высоты строк, поэтому при появлении данных
// ничего не сдвигается.
const LIST_BOX = 'flex gap-0.5 max-lg:overflow-x-auto lg:flex-col';
const LIST_ROW = 'min-w-40 flex-col items-start gap-0.5 rounded-md px-3 py-2 lg:w-full';
const LIST_META = 'flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs';
const DETAIL_BOX = 'flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4';
const HEAD_BOX = 'flex flex-wrap items-start justify-between gap-3';
const HEAD_ACTIONS = 'flex items-center gap-1';
const MODELS_BOX = 'flex flex-wrap gap-4';
const MODEL_FIELD = 'min-w-60 flex-1 sm:max-w-sm';
// Вкладки секций — обычный список shadcn Tabs; на узком экране лента прокручивается.
const TABS_LIST = 'max-w-full justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'flex-none gap-1 px-3';
// Место под точку черновика занято всегда — вкладка не меняет ширину.
const TAB_DOT = 'size-1.5 shrink-0 rounded-full';
// Редактор растягивается на высоту блока: полоса сохранения стоит у нижнего края.
const BODY_BOX = 'flex min-h-[60vh] flex-col';
// Метка без рамки: точка статуса и нейтральный текст.
const PLAIN_BADGE = 'h-5 border-transparent px-0 font-normal text-muted-foreground';

const MODEL_FIELDS = [
  { key: 'generator', column: 'generator_model', label: 'Модель ответов' },
  { key: 'judge', column: 'judge_model', label: 'Модель судей' },
];

function ModelSelect({ label, value, options, fallback, onChange }) {
  const fallbackLabel = options.find((o) => o.id === fallback)?.label ?? fallback;
  return (
    <Field label={label} className={MODEL_FIELD}>
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
    <div className={LIST_BOX} role="status" aria-label="Загружаю личности">
      {[0, 1, 2].map((i) => (
        <div key={i} className={cn('flex shrink-0', LIST_ROW)}>
          <span className="flex h-5 items-center"><Skeleton className="h-4 w-24" /></span>
          <span className={LIST_META}><Skeleton className="h-3 w-32" /></span>
        </div>
      ))}
    </div>
  );
}

// Те же Field с настоящей подписью — высота ряда совпадает с готовым.
function ModelsSkeleton() {
  return (
    <div className={MODELS_BOX} role="status" aria-label="Загружаю модели">
      {MODEL_FIELDS.map((m) => (
        <Field key={m.key} label={m.label} className={MODEL_FIELD}>
          <Skeleton className="h-8 w-full" />
        </Field>
      ))}
    </div>
  );
}

function DetailSkeleton({ models }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Загружаю личность">
      <div className={HEAD_BOX}>
        <div className="min-w-0">
          <div className="flex h-6 items-center"><Skeleton className="h-4 w-40" /></div>
          <div className="mt-1 flex h-4 items-center"><Skeleton className="h-3 w-80 max-w-full" /></div>
        </div>
        <div className={HEAD_ACTIONS}>
          {[0, 1, 2].map((i) => <Skeleton key={i} className="size-8" />)}
        </div>
      </div>
      {models !== null && <ModelsSkeleton />}
      <div className="flex flex-col gap-2">
        <div className={cn('inline-flex h-8 w-fit items-center rounded-lg bg-muted p-[3px]', TABS_LIST)}>
          {TABS.map((t) => (
            <div key={t.key} className={cn('flex h-full items-center', TAB)}>
              <Skeleton className="h-4 w-14 bg-background" />
              <span className={TAB_DOT} />
            </div>
          ))}
        </div>
      </div>
      <div className={cn('gap-4', BODY_BOX)}>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}

export default function Personas() {
  const [items, setItems] = useState([]);
  const [listLoaded, setListLoaded] = useState(false);
  // Первая загрузка закончилась (удачно или нет): до этого карточка личности
  // держит скелет, а не подменяется строкой «Выберите личность слева».
  const [booted, setBooted] = useState(false);
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
      })
      .finally(() => setBooted(true));
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
    const name = await PanelUX.prompt({ title: 'Переименовать личность', message: 'Имя личности — оно же имя в разговоре.', value: persona.name, confirmLabel: 'Переименовать' });
    if (!name || name === persona.name) return;
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
  const detailLoading = !persona && (!booted || selected != null);
  useRouteBusy(!booted);

  return (
    <div className="container pb-8">
      <PageHeader title="Личности">
        <Button variant="outline" disabled={creating} onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          Новая личность
        </Button>
      </PageHeader>
      <CreateDialog
        open={creating}
        personas={items}
        onCancel={() => setCreating(false)}
        onDone={async (id) => { setCreating(false); await loadList(); setSelected(id); }}
      />

      <div className="flex flex-col gap-4">
        <div role="status" className="flex min-h-4 flex-col gap-1 text-xs">
          {error && <p className="text-destructive">{error}</p>}
          {flash && <p className="text-muted-foreground">{flash}</p>}
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[224px_minmax(0,1fr)]">
          <nav aria-label="Личности" className="lg:sticky lg:top-[calc(var(--header-h)+12px)]">
            {!listLoaded && items.length === 0 ? (
              <ListSkeleton />
            ) : (
              <div className={LIST_BOX}>
                {items.map((x) => {
                  const active = x.id === selected;
                  return (
                    <Button
                      key={x.id}
                      variant="ghost"
                      aria-current={active ? 'true' : undefined}
                      data-active={active || undefined}
                      className={cn('h-auto justify-start text-left font-normal whitespace-normal data-[active]:bg-accent', LIST_ROW)}
                      onClick={() => setSelected(x.id)}
                    >
                      <span className="flex h-5 items-center text-sm font-medium">{x.name}</span>
                      <span className={cn(LIST_META, 'text-muted-foreground')}>
                        <span className="font-mono">{x.slug}</span>
                        {x.is_default && <span>основная</span>}
                        {!x.enabled && <span>выключена</span>}
                        {x.accounts > 0 && <span className="tabular-nums">{x.accounts} акк.</span>}
                        {draftSections(x.id).length > 0 && (
                          <Badge variant="warning" className={PLAIN_BADGE} title="есть несохранённые правки">черновик</Badge>
                        )}
                      </span>
                    </Button>
                  );
                })}
                {items.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Личностей нет</p>}
              </div>
            )}
          </nav>

          <div className={DETAIL_BOX}>
            {!persona ? (
              detailLoading ? (
                <DetailSkeleton models={models} />
              ) : (
                <p className={cn(BODY_BOX, 'text-sm text-muted-foreground')}>Выберите личность слева</p>
              )
            ) : (
              <>
                <div className={HEAD_BOX}>
                  <div className="min-w-0">
                    <h2 className="flex min-h-6 flex-wrap items-center gap-2 text-base font-semibold">
                      {persona.name}
                      <span className="font-mono text-xs font-normal text-muted-foreground">{persona.slug}</span>
                      {persona.is_default && <Badge variant="secondary" className="h-5 font-normal">основная</Badge>}
                      {!persona.enabled && <Badge variant="outline" className="h-5 font-normal text-muted-foreground">выключена</Badge>}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {persona.card_lines} строк карточки · {persona.examples} примеров тона ·{' '}
                      {persona.storylines} сюжетов · промптов изменено {persona.edited_prompts} ·{' '}
                      {persona.accounts} аккаунт(ов)
                    </p>
                  </div>
                  <div className={HEAD_ACTIONS}>
                    <IconAction icon={Pencil} label="Переименовать" disabled={renaming} onClick={rename} />
                    <IconAction icon={Copy} label="Дублировать" hint="Дублировать: копия со всеми документами и промптами" onClick={duplicate} />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconAction icon={MoreHorizontal} label="Ещё" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-48">
                        <DropdownMenuItem title="Скачать личность одним файлом: все секции сразу" onSelect={exportFile}>
                          Выгрузить всё
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          title="Взять секции из файла — прежние уйдут в историю версий"
                          onSelect={() => filePicker.current?.click()}
                        >
                          Загрузить всё
                        </DropdownMenuItem>
                        {!persona.is_default && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => run(() => setDefaultPersona(persona.id))}>
                              Сделать основной
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => run(() => updatePersona(persona.id, { enabled: !persona.enabled }))}>
                              {persona.enabled ? 'Выключить' : 'Включить'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={remove}>
                              Удалить
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                  </div>
                </div>

                <div className="grid items-start gap-6 xl:grid-cols-[208px_minmax(0,1fr)]">
                  {/* Пункт — одна строка: иконка, название, пометка. Что в разделе — в шапке справа. */}
                  <nav
                    role="tablist"
                    aria-orientation="vertical"
                    aria-label="Разделы личности"
                    className="flex gap-1 max-xl:overflow-x-auto max-xl:pb-1 xl:sticky xl:top-[calc(var(--header-h)+12px)] xl:flex-col xl:gap-0"
                  >
                    {GROUPS.map((group, gi) => (
                      <div key={group} className={cn('contents xl:flex xl:flex-col xl:gap-0.5', gi > 0 && 'xl:mt-3 xl:border-t xl:pt-3')}>
                        <p className="hidden px-3 pb-1 text-[11px] text-muted-foreground/80 xl:block">{group}</p>
                        {TABS.filter((t) => t.group === group).map((t) => {
                          const active = tab === t.key;
                          const hasDraft = draftSections(persona.id).includes(t.key);
                          const meta = sectionMeta(persona, t.key);
                          const Icon = t.icon;
                          return (
                            <button
                              key={t.key}
                              type="button"
                              role="tab"
                              aria-selected={active}
                              data-section={t.key}
                              title={t.about}
                              onMouseDown={(e) => { if (e.button === 0) setTab(t.key); }}
                              onClick={() => setTab(t.key)}
                              className={cn(
                                'relative flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-sm whitespace-nowrap outline-none hover:bg-accent/70 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                                active ? 'bg-accent font-medium text-foreground' : 'text-foreground/80',
                              )}
                            >
                              {active && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 hidden w-0.5 rounded-full bg-primary xl:block" />}
                              <Icon aria-hidden="true" className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                              <span>{t.label}</span>
                              <span className={cn(TAB_DOT, hasDraft && 'bg-warning-foreground')} title={hasDraft ? 'есть несохранённые правки' : undefined} aria-hidden="true" />
                              {meta && (
                                <span className={cn('ml-auto hidden text-[11px] font-normal tabular-nums xl:inline', meta === 'пусто' ? 'text-warning-foreground' : 'text-muted-foreground')}>{meta}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </nav>

                  <div className="flex min-w-0 flex-col gap-3" role="tabpanel" aria-label={TABS.find((t) => t.key === tab)?.label}>
                    <header className="flex flex-col gap-0.5 border-b pb-3">
                      <h3 className="text-base font-semibold">{TABS.find((t) => t.key === tab)?.label}</h3>
                      <p className="text-sm text-muted-foreground">{TABS.find((t) => t.key === tab)?.about}</p>
                    </header>
                    <div className={BODY_BOX}>
                      {tab === 'models' ? (
                        models === undefined ? (
                          <ModelsSkeleton />
                        ) : models ? (
                          <div className="flex flex-col gap-4">
                            <div className={MODELS_BOX}>
                              {MODEL_FIELDS.map((m) => (
                                <ModelSelect
                                  key={m.key}
                                  label={m.label}
                                  value={persona[m.column]}
                                  options={models[m.key]}
                                  fallback={models.defaults[m.key]}
                                  onChange={(v) => run(() => updatePersona(persona.id, { [m.column]: v }))}
                                />
                              ))}
                            </div>
                            <p className="max-w-2xl text-sm text-muted-foreground">
                              Модель ответов пишет сообщения от лица личности. Модель судей проверяет черновик и разбирает разговор перед ответом.
                              «По умолчанию» — модель из общих настроек; выбор сохраняется сразу.
                            </p>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">Список моделей недоступен.</p>
                        )
                      ) : tab === 'prompts' ? (
                        <PromptsEditor persona={persona} defaults={defaults} onSaved={refresh} onError={setError} />
                      ) : tab === 'rhythm' ? (
                        <RhythmEditor persona={persona} onSaved={refresh} onError={setError} />
                      ) : tab === 'variables' ? (
                        <VariablesEditor persona={persona} onSaved={refresh} onError={setError} />
                      ) : (
                        <SectionEditor persona={persona} section={tab} onSaved={refresh} onError={setError} />
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
