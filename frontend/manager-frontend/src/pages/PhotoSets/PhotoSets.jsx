import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from '../../components/Header/Header';
import { PanelUX } from '../../ui/PanelUX';
import {
  createPhotoSet,
  deletePhotoSet,
  deleteSetPhoto,
  getPhotoSets,
  getSetPhotos,
  photoUrl,
  updatePhotoSet,
  uploadSetPhoto,
} from '../../api/photoSets';
import PhotoCard from './PhotoCard';
import PhotoEditor from './PhotoEditor';
import s from '../../styles/AdminPage.module.scss';
import p from './PhotoSets.module.scss';

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
    <form onSubmit={save} aria-label="Настройки образа">
      <div className={p.settings}>
        <label className={s.label}>
          Название
          <input className={s.field} disabled={!canEdit} value={f.name} maxLength={120} onChange={(e) => set_({ name: e.target.value })} />
        </label>
        <label className={s.label}>
          Кто отправляет
          <select className={s.select} disabled={!canEdit || !f.auto_send} value={f.send_mode} onChange={(e) => set_({ send_mode: e.target.value })}>
            {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={s.label}>
          Интервал между фото, мин
          <input className={s.field} type="number" min={0} disabled={!canEdit} value={f.min_interval_min} onChange={(e) => set_({ min_interval_min: e.target.value })} />
        </label>
        <label className={s.label}>
          Не больше фото в день на диалог
          <input className={s.field} type="number" min={0} max={20} disabled={!canEdit} value={f.max_per_day} onChange={(e) => set_({ max_per_day: e.target.value })} />
        </label>
        <label className={s.check} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <input type="checkbox" disabled={!canEdit} checked={f.auto_send} onChange={(e) => set_({ auto_send: e.target.checked })} />
          Автоматическая отправка
        </label>
        <label className={s.check} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <input type="checkbox" disabled={!canEdit} checked={f.no_repeat} onChange={(e) => set_({ no_repeat: e.target.checked })} />
          Не повторять показанные снимки
        </label>
      </div>
      <p className={s.hint}>Это ограничения сверху: бот не обязан отправлять фото, если они не к месту. Менеджер может отправить снимок вручную при любых настройках.</p>
      {error && <p className={s.error} role="alert">{error}</p>}
      {canEdit && <button type="submit" className={s.btnPrimary} disabled={!dirty || busy}>{busy ? 'Сохраняем…' : 'Сохранить настройки'}</button>}
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
      className={over ? p.dropActive : p.drop}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
    >
      <p style={{ margin: '0 0 8px' }}>Перетащите снимки сюда или</p>
      <label className={s.btnPrimary} style={{ display: 'inline-flex', cursor: 'pointer' }}>
        Выбрать файлы
        <input type="file" accept="image/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      </label>
      {progress && (
        <p className={s.hint} role="status" style={{ marginTop: 8 }}>
          {progress.done < progress.total
            ? `Загружаем и описываем ${progress.done + 1} из ${progress.total}…`
            : `Готово: ${progress.total - progress.errors.length - progress.duplicates} новых${progress.duplicates ? `, ${progress.duplicates} уже были в образе` : ''}. Проверьте описания.`}
          {progress.errors.map((e) => <span key={e} className={s.error} style={{ display: 'block' }}>{e}</span>)}
        </p>
      )}
    </div>
  );
}

export function PhotoGrid({ photos, onOpen, withSent = false, picked = null }) {
  if (!photos.length) return <p className={s.empty}>Снимков нет.</p>;
  return (
    <div className={p.grid}>
      {photos.map((ph) => <PhotoCard key={ph.id} photo={ph} onOpen={onOpen} withSent={withSent} picked={picked === ph.id} />)}
    </div>
  );
}

export function TagFilter({ tags, value, onChange }) {
  if (!tags.length) return null;
  return (
    <div className={p.tags} role="group" aria-label="Теги">
      <button type="button" className={value ? p.tag : p.tagActive} onClick={() => onChange('')}>все</button>
      {tags.map((t) => <button type="button" key={t} className={value === t ? p.tagActive : p.tag} onClick={() => onChange(value === t ? '' : t)}>#{t}</button>)}
    </div>
  );
}

export default function PhotoSets() {
  const [data, setData] = useState({ items: [], can_edit: false, can_manage: false });
  const [current, setCurrent] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');

  const loadSets = useCallback(() => getPhotoSets().then(setData).catch((e) => setError(e.detail || e.message)), []);
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
      const created = await createPhotoSet(newName.trim());
      setNewName('');
      await loadSets();
      setCurrent(created.id);
    } catch (err) {
      setError(err.detail || err.message);
    }
  }

  async function remove() {
    if (!set) return;
    if (!await PanelUX.confirm({ title: 'Удалить образ?', message: `«${set.name}» снимется со всех ${set.accounts} аккаунтов. Отметки о том, какие фото уже видели собеседники, сохранятся.`, confirmLabel: 'Удалить', danger: true })) return;
    try {
      await deletePhotoSet(set.id);
      setCurrent(null);
      loadSets();
    } catch (err) {
      setError(err.detail || err.message);
    }
  }

  async function removePhoto(ph) {
    if (!await PanelUX.confirm({ title: 'Убрать снимок?', message: 'Бот и менеджеры больше не смогут его отправить. В уже отправленных диалогах он останется.', confirmLabel: 'Убрать', danger: true })) return;
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
    <div className="app">
      <Header />
      <main className="main">
        <div className="container">
          <div className={s.head}>
            <h2 className={s.title}>Образы</h2>
            {data.can_manage && (
              <form onSubmit={create} style={{ display: 'flex', gap: 8 }}>
                <input className={s.field} placeholder="Аня — образ 1" value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} aria-label="Название нового образа" />
                <button type="submit" className={s.btnPrimary} disabled={!newName.trim()}>Создать образ</button>
              </form>
            )}
          </div>
          <p className={s.hint} style={{ marginTop: 0 }}>Образ — общий набор фотографий с описаниями. Назначается аккаунтам во вкладке «Аккаунты»; новые снимки сразу доступны всем назначенным аккаунтам.</p>
          {error && <p className={s.error} role="alert">{error}</p>}

          {!data.items.length && <p className={s.empty}>{data.can_manage ? 'Образов пока нет. Создайте первый.' : 'Вашим аккаунтам пока не назначен ни один образ.'}</p>}
          <div className={p.sets}>
            {data.items.map((x) => (
              <button type="button" key={x.id} className={`${p.setCard} ${x.id === current ? p.setCardActive : ''}`} onClick={() => setCurrent(x.id)} aria-pressed={x.id === current}>
                {x.cover_photo_id ? <img className={p.cover} src={photoUrl(x.cover_photo_id, true)} alt="" /> : <span className={p.coverEmpty}>Нет обложки</span>}
                <span className={p.setName}>{x.name}</span>
                <span className={p.setMeta}>
                  {x.photos} фото · {x.accounts} акк. · {x.auto_send ? (x.send_mode === 'request' ? 'по просьбе' : 'автоотправка') : 'вручную'}
                  {x.needs_review > 0 && <span className={p.review}> · {x.needs_review} проверить</span>}
                </span>
              </button>
            ))}
          </div>

          {set && (
            <section className={p.panel} aria-label={`Образ ${set.name}`}>
              <SetSettings set={set} canEdit={data.can_edit} onSaved={() => loadSets()} />
              {!data.can_edit && <p className={s.hint}>Просмотр: менять общий набор можно только с отдельным правом — правка сразу видна на всех его аккаунтах.</p>}
              {data.can_edit && <Uploader setId={set.id} onUploaded={() => { loadPhotos(); loadSets(); }} />}
              <div className={p.toolbar}>
                <input className={`${s.field} ${p.search}`} placeholder="Поиск по описанию, месту, деталям" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по снимкам" />
                {data.can_manage && <button type="button" className={s.btnSmDanger} onClick={remove}>Удалить образ</button>}
              </div>
              <TagFilter tags={tags} value={tag} onChange={setTag} />
              <PhotoGrid photos={shown} onOpen={setOpen} />
            </section>
          )}
        </div>
      </main>
      {open && (
        <PhotoEditor
          photo={open}
          canEdit={data.can_edit}
          onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); loadPhotos(); loadSets(); }}
          onDelete={removePhoto}
          onCover={makeCover}
        />
      )}
    </div>
  );
}
