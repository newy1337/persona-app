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
import PromptsEditor from './PromptsEditor';
import RhythmEditor from './RhythmEditor';
import VariablesEditor from './VariablesEditor';
import SectionEditor from './SectionEditor';
import { personaFileName, readPersonaFile } from './personaFile';
import { saveJsonFile } from './files';
import { drafts } from './drafts';
import s from '../../styles/AdminPage.module.scss';
import p from './Personas.module.scss';

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
    <form className={s.form} onSubmit={submit}>
      <label className={s.label}>
        Имя
        <input className={s.field} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <label className={s.label}>
        Идентификатор (латиницей)
        <input className={s.field} placeholder="соберём из имени" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />
      </label>
      <label className={s.label}>
        Скопировать документы у
        <select className={s.select} value={f.copy_from} onChange={(e) => setF({ ...f, copy_from: e.target.value })}>
          <option value="">— пустая личность —</option>
          {personas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      {error && <p className={`${s.error} ${s.formFull}`} style={{ justifyContent: 'flex-start' }}>{error}</p>}
      <div className={s.formFull}>
        <button type="button" className={s.btn} onClick={onCancel}>Отмена</button>
        <button type="submit" className={s.btnPrimary} disabled={busy || !f.name.trim()}>{busy ? 'Создание…' : 'Создать'}</button>
      </div>
    </form>
  );
}

const SECTION_KEYS = TABS.map((t) => t.key);

function ModelSelect({ label, hint, value, options, fallback, onChange }) {
  const fallbackLabel = options.find((o) => o.id === fallback)?.label ?? fallback;
  return (
    <label className={p.modelField}>
      <span className={p.modelLabel}>{label}</span>
      <select
        className={s.select}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">по умолчанию — {fallbackLabel}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <span className={p.modelHint}>{hint}</span>
    </label>
  );
}

export default function Personas() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [persona, setPersona] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [models, setModels] = useState(null);
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
    const list = await getPersonas();
    setItems(list.items);
    return list.items;
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
      .catch((e) => setError(e.detail || e.message));
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

  return (
    <div className="app">
      <Header />
      <main className="main">
        <div className="container">
          <div className={s.head}>
            <h2 className={s.title}>Личности</h2>
            {!creating && <button className={s.btnPrimary} onClick={() => setCreating(true)}>+ Новая личность</button>}
          </div>
          <p className={s.hint}>
            Кем говорит бот. Аккаунт ссылается на личность идентификатором (<span className={s.mono}>persona_id</span>),
            одна личность может стоять на нескольких аккаунтах. Правки действуют со следующего ответа.
          </p>
          {creating && (
            <CreateForm
              personas={items}
              onCancel={() => setCreating(false)}
              onDone={async (id) => { setCreating(false); await loadList(); setSelected(id); }}
            />
          )}
          {error && <p className={s.error}>{error}</p>}
          {flash && <p className={s.ok} style={{ margin: '0 0 12px', fontSize: 13 }}>{flash}</p>}

          <div className={p.layout}>
            <aside className={p.list}>
              {items.map((x) => (
                <button
                  key={x.id}
                  className={`${p.listItem} ${x.id === selected ? p.listItemActive : ''}`}
                  onClick={() => setSelected(x.id)}
                >
                  <span className={p.listName}>{x.name}</span>
                  <span className={p.listMeta}>
                    <span className={s.mono}>{x.slug}</span>
                    {x.is_default && <span className={s.badgeActive}>основная</span>}
                    {!x.enabled && <span className={s.badgeRetired}>выключена</span>}
                    {x.accounts > 0 && <span className={s.muted}>{x.accounts} акк.</span>}
                    {(drafted.find((d) => d.id === x.id)?.sections.length ?? 0) > 0 && (
                      <span className={p.draftMark} title="есть несохранённые правки">● черновик</span>
                    )}
                  </span>
                </button>
              ))}
              {items.length === 0 && <p className={s.empty}>Личностей нет</p>}
            </aside>

            <section className={p.detail}>
              {!persona ? (
                <p className={s.empty}>Выберите личность слева</p>
              ) : (
                <>
                  <div className={p.detailHead}>
                    <div>
                      <h3 className={p.detailName}>
                        {persona.name} <span className={s.mono} style={{ fontSize: 12 }}>{persona.slug}</span>
                      </h3>
                      <p className={s.muted} style={{ margin: '4px 0 0', fontSize: 12 }}>
                        {persona.card_lines} строк карточки · {persona.examples} примеров тона ·{' '}
                        {persona.storylines} сюжетов · промптов изменено {persona.edited_prompts} ·{' '}
                        {persona.accounts} аккаунт(ов)
                      </p>
                    </div>
                    <div className={s.actions}>
                      <button className={s.btnSm} disabled={renaming} onClick={rename}>Переименовать</button>
                      <button className={s.btnSm} title="Копия со всеми документами и промптами" onClick={duplicate}>
                        Дублировать
                      </button>
                      <button className={s.btnSm} title="Скачать личность одним файлом: все секции сразу" onClick={exportFile}>
                        Выгрузить всё
                      </button>
                      <button
                        className={s.btnSm}
                        title="Взять секции из файла — прежние уйдут в историю версий"
                        onClick={() => filePicker.current?.click()}
                      >
                        Загрузить всё
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
                      {!persona.is_default && (
                        <button className={s.btnSm} onClick={() => run(() => setDefaultPersona(persona.id))}>Сделать основной</button>
                      )}
                      {!persona.is_default && (
                        <button className={s.btnSm} onClick={() => run(() => updatePersona(persona.id, { enabled: !persona.enabled }))}>
                          {persona.enabled ? 'Выключить' : 'Включить'}
                        </button>
                      )}
                      {!persona.is_default && <button className={s.btnSmDanger} onClick={remove}>Удалить</button>}
                    </div>
                  </div>

                  {models && (
                    <div className={p.modelRow}>
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
                  )}

                  <div className={p.tabs}>
                    {TABS.map((t) => (
                      <button
                        key={t.key}
                        className={`${p.tab} ${tab === t.key ? p.tabActive : ''}`}
                        onClick={() => setTab(t.key)}
                      >
                        {t.label}
                        {(drafted.find((d) => d.id === persona.id)?.sections ?? []).includes(t.key) && (
                          <span className={p.draftMark}> ●</span>
                        )}
                      </button>
                    ))}
                  </div>

                  {tab === 'prompts' ? (
                    <PromptsEditor persona={persona} defaults={defaults} onSaved={refresh} onError={setError} />
                  ) : tab === 'rhythm' ? (
                    <RhythmEditor persona={persona} onSaved={refresh} onError={setError} />
                  ) : tab === 'variables' ? (
                    <VariablesEditor persona={persona} onSaved={refresh} onError={setError} />
                  ) : (
                    <SectionEditor persona={persona} section={tab} onSaved={refresh} onError={setError} />
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
