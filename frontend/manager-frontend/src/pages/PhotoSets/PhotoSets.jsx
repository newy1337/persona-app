import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelUX } from '../../ui/PanelUX';
import {
  bindMyPhotoSet,
  createPhotoSet,
  deletePhotoSet,
  deleteSetPhoto,
  getMyPhotoSets,
  getPhotoSets,
  getSetPhotos,
  photoUrl,
  updatePhotoSet,
  uploadSetPhoto,
} from '../../api/photoSets';
import PhotoCard from './PhotoCard';
import PhotoEditor from './PhotoEditor';
import { cn } from '@/lib/utils';
import { useRouteBusy } from '@/components/AppLayout/routeBusy';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import { NativeSelect } from '@/components/ui/native-select';

const MODE_LABEL = { request: 'Только по просьбе', initiative: 'По просьбе и по своей инициативе' };

function SetSettings({ set, canEdit, onSaved }) {
  const [f, setF] = useState(set);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setF(set), [set]);
  const set_ = (patch) => setF((v) => ({ ...v, ...patch }));
  const dirty = ['name', 'auto_send', 'send_mode', 'min_interval_min', 'max_per_day', 'no_repeat'].some((k) => f[k] !== set[k]);

  async function save(e) {
    e.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setError('');
    try {
      onSaved(await updatePhotoSet(set.id, {
        name: f.name.trim(),
        auto_send: f.auto_send,
        send_mode: f.send_mode,
        min_interval_min: Number(f.min_interval_min) || 0,
        max_per_day: Number(f.max_per_day) || 0,
        no_repeat: f.no_repeat,
      }));
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} aria-label="Настройки образа" className="grid gap-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] items-end gap-3">
        <Field label="Название">
          <Input disabled={!canEdit} value={f.name} maxLength={120} onChange={(e) => set_({ name: e.target.value })} />
        </Field>
        <Field label="Кто отправляет">
          <NativeSelect disabled={!canEdit || !f.auto_send} value={f.send_mode} onChange={(e) => set_({ send_mode: e.target.value })}>
            {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Интервал между фото, мин">
          <Input type="number" min={0} disabled={!canEdit} value={f.min_interval_min} onChange={(e) => set_({ min_interval_min: e.target.value })} />
        </Field>
        <Field label="Не больше фото в день на диалог">
          <Input type="number" min={0} max={20} disabled={!canEdit} value={f.max_per_day} onChange={(e) => set_({ max_per_day: e.target.value })} />
        </Field>
        <Label className="h-8 cursor-pointer font-normal">
          <NativeCheckbox disabled={!canEdit} checked={f.auto_send} onChange={(e) => set_({ auto_send: e.target.checked })} />
          Автоматическая отправка
        </Label>
        <Label className="h-8 cursor-pointer font-normal">
          <NativeCheckbox disabled={!canEdit} checked={f.no_repeat} onChange={(e) => set_({ no_repeat: e.target.checked })} />
          Не повторять показанные снимки
        </Label>
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      {canEdit && <div><Button type="submit" disabled={!dirty || busy}>{busy ? 'Сохраняем…' : 'Сохранить настройки'}</Button></div>}
    </form>
  );
}

function Uploader({ setId, onUploaded }) {
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState(null);

  async function upload(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (!list.length) return;
    const report = { done: 0, total: list.length, duplicates: 0, errors: [] };
    setProgress({ ...report });
    for (const file of list) {
      try {
        const r = await uploadSetPhoto(setId, file);
        if (r.duplicate) report.duplicates += 1;
      } catch (e) {
        report.errors.push(`${file.name}: ${e.detail || e.message}`);
      }
      report.done += 1;
      setProgress({ ...report });
      onUploaded();
    }
  }

  return (
    <div
      className={cn('rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground transition-colors', over && 'border-primary text-foreground')}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
    >
      <p className="mb-2">Перетащите снимки сюда или</p>
      <label className={cn(buttonVariants(), 'cursor-pointer')}>
        Выбрать файлы
        <input type="file" accept="image/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      </label>
      {progress && (
        <p className="mt-2 text-xs" role="status">
          {progress.done < progress.total
            ? `${progress.done + 1} из ${progress.total}…`
            : `Загружено: ${progress.total - progress.errors.length - progress.duplicates}${progress.duplicates ? `, повторов: ${progress.duplicates}` : ''}`}
          {progress.errors.map((e) => <span key={e} className="block text-destructive">{e}</span>)}
        </p>
      )}
    </div>
  );
}

function chatsWord(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'диалог';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'диалога';
  return 'диалогов';
}

/** Почему образ нельзя удалить — или null, если можно. */
function removeBlocker(set) {
  if (set.assigned_to?.length)
    return `Назначен: ${[...new Set(set.assigned_to.map((a) => a.username))].join(', ')}`;
  if (set.active_chats > 0)
    return `Идёт ${set.active_chats} ${chatsWord(set.active_chats)}`;
  return null;
}

export function PhotoGrid({ photos, onOpen, withSent = false, picked = null }) {
  if (!photos.length) return <p className="text-sm text-muted-foreground">Снимков нет.</p>;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
      {photos.map((ph) => <PhotoCard key={ph.id} photo={ph} onOpen={onOpen} withSent={withSent} picked={picked === ph.id} />)}
    </div>
  );
}

export function TagFilter({ tags, value, onChange }) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Теги">
      <Button type="button" size="xs" variant={value ? 'outline' : 'secondary'} aria-pressed={!value} onClick={() => onChange('')}>все</Button>
      {tags.map((t) => <Button type="button" key={t} size="xs" variant={value === t ? 'secondary' : 'outline'} aria-pressed={value === t} onClick={() => onChange(value === t ? '' : t)}>#{t}</Button>)}
    </div>
  );
}

/**
 * Мои образы: хед назначил их моей учётке, а к личностям привязываю я. У
 * личности один действующий образ: новый образ на ту же личность получает
 * новых собеседников, начатые диалоги остаются на прежнем.
 */
export function MyPhotoSets({ onChanged = () => {} }) {
  const [mine, setMine] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { getMyPhotoSets().then(setMine).catch(() => setMine(null)); }, []);
  if (!mine?.sets?.length) return null;

  async function bind(set, slug) {
    const taken = slug ? mine.sets.find((x) => x.persona_slug === slug && x.set_id !== set.set_id) : null;
    if (taken && !await PanelUX.confirm({
      title: `«${set.set_name}» на личность ${mine.personas.find((p_) => p_.slug === slug)?.name ?? slug}?`,
      message: `Новые собеседники получат «${set.set_name}». Начатые диалоги останутся на «${taken.set_name}», он уйдёт в запас.`,
      confirmLabel: 'Привязать',
    })) return;
    setBusy(set.set_id);
    setError('');
    try { setMine(await bindMyPhotoSet(set.set_id, slug)); onChanged(); }
    catch (e) { setError(e.detail || e.message); }
    finally { setBusy(null); }
  }

  return (
    <Card className="mb-5 gap-3 p-4" aria-label="Мои образы" data-testid="my-photo-sets">
      <h2 className="text-base font-semibold">Мои образы</h2>
      <p className="text-sm text-muted-foreground">
        Привяжите образ к личности — фото из него будут уходить новым собеседникам ваших аккаунтов этой личности.
        У личности один действующий образ; начатые диалоги остаются на своём.
      </p>
      {!mine.personas.length && <p className="text-sm text-muted-foreground">У вас нет аккаунтов — привязать не к чему.</p>}
      {mine.sets.map((x) => (
        <label key={x.set_id} className="grid max-w-[640px] grid-cols-[minmax(140px,1fr)_minmax(200px,2fr)] items-center gap-3 text-sm">
          <span className="font-medium">{x.set_name}</span>
          <NativeSelect value={x.persona_slug ?? ''} disabled={busy === x.set_id} onChange={(e) => bind(x, e.target.value)} aria-label={`Личность для образа ${x.set_name}`}>
            <option value="">— в запасе, фото не уходят —</option>
            {mine.personas.map((p_) => <option key={p_.slug} value={p_.slug}>{p_.name} · аккаунтов: {p_.accounts}</option>)}
          </NativeSelect>
        </label>
      ))}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </Card>
  );
}

export default function PhotoSets() {
  const [data, setData] = useState({ items: [], can_create: false, region_code: null });
  const [newRegion, setNewRegion] = useState('');
  const [current, setCurrent] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [loaded, setLoaded] = useState(false);
  useRouteBusy(!loaded);

  const loadSets = useCallback(() => getPhotoSets().then(setData).catch((e) => setError(e.detail || e.message)).finally(() => setLoaded(true)), []);
  const loadPhotos = useCallback(() => {
    if (!current) return;
    getSetPhotos(current).then((r) => setPhotos(r.items ?? [])).catch((e) => setError(e.detail || e.message));
  }, [current]);

  useEffect(() => { loadSets(); }, [loadSets]);
  useEffect(() => {
    if (!current && data.items.length) setCurrent(data.items[0].id);
  }, [data.items, current]);
  useEffect(() => { setPhotos([]); setTag(''); setQ(''); loadPhotos(); }, [loadPhotos]);

  const set = data.items.find((x) => x.id === current) ?? null;
  // У хеда регион есть всегда; создавать без своего региона может только администратор.
  const admin = data.can_create && !data.region_code;
  const blocker = set ? removeBlocker(set) : null;
  const tags = useMemo(() => [...new Set(photos.flatMap((ph) => ph.tags))].sort(), [photos]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return photos.filter((ph) => (!tag || ph.tags.includes(tag)) &&
      (!needle || [ph.description, ph.place ?? '', ph.details, ph.tags.join(' ')].join(' ').toLowerCase().includes(needle)));
  }, [photos, q, tag]);

  async function create(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const created = await createPhotoSet(newName.trim(), admin ? newRegion.trim() : undefined);
      setNewName('');
      await loadSets();
      setCurrent(created.id);
    } catch (err) {
      setError(err.detail || err.message);
    }
  }

  async function remove() {
    if (!set) return;
    if (!await PanelUX.confirm({ title: 'Удалить образ?', message: `«${set.name}»${set.chats ? ` · закрытых диалогов на нём: ${set.chats}` : ''}`, confirmLabel: 'Удалить', danger: true })) return;
    try {
      await deletePhotoSet(set.id);
      setCurrent(null);
      loadSets();
    } catch (err) {
      setError(err.detail || err.message);
    }
  }

  async function removePhoto(ph) {
    if (!await PanelUX.confirm({ title: 'Убрать снимок?', message: '', confirmLabel: 'Убрать', danger: true })) return;
    try {
      await deleteSetPhoto(ph.id);
      setOpen(null);
      loadPhotos();
      loadSets();
    } catch (err) {
      setError(err.detail || err.message);
    }
  }

  async function makeCover(ph) {
    try {
      await updatePhotoSet(ph.set_id, { cover_photo_id: ph.id });
      setOpen(null);
      loadSets();
    } catch (err) {
      setError(err.detail || err.message);
    }
  }

  return (
    <div className="container">
      <PageHeader title="Образы">
        {data.can_create && (
          <form onSubmit={create} className="flex flex-wrap items-center gap-2">
            <Input className="w-56" placeholder="Аня — образ 1" value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} aria-label="Название нового образа" />
            {admin && <Input className="w-28" placeholder="Регион" value={newRegion} maxLength={32} onChange={(e) => setNewRegion(e.target.value)} aria-label="Регион нового образа" />}
            <Button type="submit" disabled={!newName.trim() || (admin && !newRegion.trim())}>Создать образ</Button>
          </form>
        )}
      </PageHeader>
      {error && <p className="mb-3 text-sm text-destructive" role="alert">{error}</p>}
      <MyPhotoSets onChanged={loadSets} />

      {!data.items.length && <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">Образов нет</p>}
      <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {data.items.map((x) => (
          <button
            type="button"
            key={x.id}
            className={cn('flex flex-col gap-1.5 overflow-hidden rounded-lg border bg-card pb-3 text-left transition-colors hover:border-ring', x.id === current && 'border-primary ring-1 ring-primary')}
            onClick={() => setCurrent(x.id)}
            aria-pressed={x.id === current}
          >
            {x.cover_photo_id
              ? <img className="aspect-[4/3] w-full bg-muted object-cover" src={photoUrl(x.cover_photo_id, true)} alt="" />
              : <span className="grid aspect-[4/3] w-full place-items-center bg-muted text-xs text-muted-foreground">Нет обложки</span>}
            <span className="px-3 text-sm font-medium">{x.name}</span>
            <span className="px-3 text-xs text-muted-foreground">
              {admin && x.region_code ? `${x.region_code} · ` : ''}{x.photos} фото · {x.active_chats} {chatsWord(x.active_chats)} · {x.auto_send ? (x.send_mode === 'request' ? 'по просьбе' : 'автоотправка') : 'вручную'}
              {x.assigned_to?.length > 0 && <> · {x.assigned_to.map((a) => `${a.username} (${a.persona || 'в запасе'})`).join(', ')}</>}
              {x.needs_review > 0 && <span className="text-warning-foreground"> · {x.needs_review} проверить</span>}
            </span>
          </button>
        ))}
      </div>

      {set && (
        <Card className="gap-4 p-4" aria-label={`Образ ${set.name}`}>
          <SetSettings set={set} canEdit={set.can_edit} onSaved={() => loadSets()} />
          {set.can_edit && <Uploader setId={set.id} onUploaded={() => { loadPhotos(); loadSets(); }} />}
          <div className="flex flex-wrap items-center gap-2">
            <Input className="min-w-[220px] flex-1" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по снимкам" />
            {set.can_edit && <Button type="button" variant="ghost" className="text-destructive" onClick={remove} disabled={Boolean(blocker)} title={blocker ?? undefined}>Удалить образ</Button>}
          </div>
          <TagFilter tags={tags} value={tag} onChange={setTag} />
          <PhotoGrid photos={shown} onOpen={setOpen} />
        </Card>
      )}
      {open && (
        <PhotoEditor
          photo={open}
          canEdit={Boolean(set?.can_edit)}
          onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); loadPhotos(); loadSets(); }}
          onDelete={removePhoto}
          onCover={makeCover}
        />
      )}
    </div>
  );
}
