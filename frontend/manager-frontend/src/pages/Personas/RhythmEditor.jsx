import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRhythmDefaults, putSection } from '../../api/personas';
import VersionsTable, { ago, useVersions } from './Versions';
import { drafts } from './drafts';
import { TIMEZONES, rhythmSummary } from './rhythm';
import s from '../../styles/AdminPage.module.scss';
import p from './Personas.module.scss';

const DRAFT_DELAY_MS = 600;

function Num({ label, hint, value, onChange, min = 0, max = 1440, step = 1, unit }) {
  return (
    <label className={p.rhythmField}>
      <span className={p.rhythmLabel}>{label}</span>
      <span className={p.rhythmInput}>
        <input
          className={s.field}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
        {unit && <span className={s.muted}>{unit}</span>}
      </span>
      {hint && <span className={p.rhythmHint}>{hint}</span>}
    </label>
  );
}

function Toggle({ checked, onChange, children }) {
  return (
    <label className={s.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function Time({ label, value, onChange }) {
  return (
    <label className={p.rhythmField}>
      <span className={p.rhythmLabel}>{label}</span>
      <input className={s.field} type="time" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function RhythmEditor({ persona, onSaved, onError }) {
  const server = useMemo(() => persona.sections.rhythm ?? {}, [persona.sections.rhythm]);
  const serverText = useMemo(() => JSON.stringify(server), [server]);

  const [draft, setDraft] = useState(server);
  const [draftAt, setDraftAt] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const timer = useRef(null);
  const lastId = useRef(null);

  const versions = useVersions(persona.id, 'rhythm', {
    onRestored: () => {
      drafts.clear(persona.id, 'rhythm');
      onSaved();
    },
    onError,
  });

  useEffect(() => {
    const d = drafts.read(persona.id, 'rhythm');
    if (d && d.text !== serverText) {
      try {
        setDraft(JSON.parse(d.text));
        setDraftAt(d.savedAt);
      } catch {
        drafts.clear(persona.id, 'rhythm');
        setDraft(server);
        setDraftAt(null);
      }
    } else {
      if (d) drafts.clear(persona.id, 'rhythm');
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

  const keepDraft = (next) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (JSON.stringify(next) === serverText) {
        drafts.clear(persona.id, 'rhythm');
        setDraftAt(null);
      } else {
        drafts.write(persona.id, 'rhythm', JSON.stringify(next));
        setDraftAt(Date.now());
      }
    }, DRAFT_DELAY_MS);
  };

  const set = (path, value) => {
    setFlash(null);
    setDraft((cur) => {
      const next = structuredClone(cur);
      let node = next;
      for (const key of path.slice(0, -1)) node = node[key] ??= {};
      node[path[path.length - 1]] = value;
      keepDraft(next);
      return next;
    });
  };

  async function applyDefaults() {
    try {
      const { defaults } = await getRhythmDefaults();
      setFlash('Подставлены цифры по умолчанию — проверьте и сохраните');
      setDraft(defaults);
      keepDraft(defaults);
    } catch (e) {
      onError(e.detail || e.message);
    }
  }

  const reset = () => {
    clearTimeout(timer.current);
    drafts.clear(persona.id, 'rhythm');
    setDraft(server);
    setDraftAt(null);
    setFlash(null);
  };

  const save = useCallback(async () => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const r = await putSection(persona.id, 'rhythm', draft, note.trim() || undefined);
      drafts.clear(persona.id, 'rhythm');
      setDraftAt(null);
      setNote('');
      setFlash(r.unchanged ? 'Ничего не изменилось' : 'Сохранено — прежний ритм в истории');
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

  const rd = draft.reply_delay ?? {};
  const as = draft.after_silence ?? {};
  const morning = draft.morning ?? {};
  const goodnight = draft.goodnight ?? {};

  return (
    <div className={p.prompts}>
      <div className={p.sectionBar}>
        <span className={s.muted}>{rhythmSummary(draft)}</span>
        <div className={s.actions}>
          <button className={s.btnSm} onClick={applyDefaults} title="Подставить цифры по умолчанию — сохранит обычная кнопка">
            Как по умолчанию
          </button>
          <button className={s.btnSm} onClick={versions.toggle}>
            {versions.open ? 'Скрыть историю' : 'История версий'}
          </button>
          <button className={s.btnSm} disabled={!dirty} onClick={reset}>Отменить правки</button>
        </div>
      </div>

      <p className={s.hint}>
        Правка действует со следующего сообщения, перезапуск не нужен. Окна утра и прощания — по часам выбранного
        пояса; утро и прощание слушаются общего выключателя инициативы в настройках.
      </p>

      {draftAt && dirty && (
        <p className={p.draftNote}>
          Черновик сохранён в браузере ({ago(draftAt)}) — правки не потеряются при перезагрузке.
        </p>
      )}

      <VersionsTable versions={versions.versions} onRestore={versions.restore} />

      <div className={p.rhythmGrid}>
        <section className={p.rhythmCard}>
          <header className={p.rhythmHead}>
            <span className={p.promptTitle}>Задержка ответа</span>
            <Toggle checked={rd.enabled !== false} onChange={(v) => set(['reply_delay', 'enabled'], v)}>включена</Toggle>
          </header>
          <p className={p.promptHint}>Сначала отвечает быстро, дальше — как занятой человек.</p>
          <Num
            label="Разогрев"
            unit="мин"
            hint="от его первого сообщения"
            value={rd.warmup_minutes}
            onChange={(v) => set(['reply_delay', 'warmup_minutes'], v)}
          />
          <div className={p.rhythmPair}>
            <Num label="В разогреве от" unit="мин" value={rd.warmup_min_minutes} onChange={(v) => set(['reply_delay', 'warmup_min_minutes'], v)} />
            <Num label="до" unit="мин" value={rd.warmup_max_minutes} onChange={(v) => set(['reply_delay', 'warmup_max_minutes'], v)} />
          </div>
          <div className={p.rhythmPair}>
            <Num label="Потом от" unit="мин" value={rd.min_minutes} onChange={(v) => set(['reply_delay', 'min_minutes'], v)} />
            <Num label="до" unit="мин" value={rd.max_minutes} onChange={(v) => set(['reply_delay', 'max_minutes'], v)} />
          </div>
          <Num
            label="Пауза в потоке"
            unit="сек"
            max={600}
            hint="пишет несколько сообщений подряд — ответ ждёт, пока замолчит, и уходит одним"
            value={rd.burst_seconds}
            onChange={(v) => set(['reply_delay', 'burst_seconds'], v)}
          />
        </section>

        <section className={p.rhythmCard}>
          <header className={p.rhythmHead}>
            <span className={p.promptTitle}>После молчания</span>
            <Toggle checked={as.enabled !== false} onChange={(v) => set(['after_silence', 'enabled'], v)}>включено</Toggle>
          </header>
          <p className={p.promptHint}>
            Бот написал, а собеседник молчал дольше порога — отвечает не сразу. Ночь и разговор, закрытый «спокойной ночи»,
            молчанием не считаются. Следующий ответ — снова обычный.
          </p>
          <Num label="Молчал дольше" unit="ч" max={72} step={0.5} value={as.silence_hours} onChange={(v) => set(['after_silence', 'silence_hours'], v)} />
          <div className={p.rhythmPair}>
            <Num label="Ответ через от" unit="ч" max={48} step={0.5} value={as.min_hours} onChange={(v) => set(['after_silence', 'min_hours'], v)} />
            <Num label="до" unit="ч" max={48} step={0.5} value={as.max_hours} onChange={(v) => set(['after_silence', 'max_hours'], v)} />
          </div>
        </section>

        <section className={p.rhythmCard}>
          <header className={p.rhythmHead}>
            <span className={p.promptTitle}>Утреннее сообщение</span>
            <Toggle checked={morning.enabled !== false} onChange={(v) => set(['morning', 'enabled'], v)}>включено</Toggle>
          </header>
          <p className={p.promptHint}>
            Одно в день, в случайную минуту окна — у каждого собеседника свою. Написал первым этим утром — она просто
            ответит на его сообщение. Текст — промпт «Утреннее сообщение».
          </p>
          <div className={p.rhythmPair}>
            <Time label="С" value={morning.from} onChange={(v) => set(['morning', 'from'], v)} />
            <Time label="До" value={morning.to} onChange={(v) => set(['morning', 'to'], v)} />
          </div>
        </section>

        <section className={p.rhythmCard}>
          <header className={p.rhythmHead}>
            <span className={p.promptTitle}>Прощание на ночь</span>
            <Toggle checked={goodnight.enabled !== false} onChange={(v) => set(['goodnight', 'enabled'], v)}>включено</Toggle>
          </header>
          <p className={p.promptHint}>
            Если сегодня общались и разговор затих. Попрощался первым — ответит взаимно, своё прощание не шлёт.
            «До» раньше «с» — окно через полночь. Текст — промпт «Прощание на ночь».
          </p>
          <div className={p.rhythmPair}>
            <Time label="С" value={goodnight.from} onChange={(v) => set(['goodnight', 'from'], v)} />
            <Time label="До" value={goodnight.to} onChange={(v) => set(['goodnight', 'to'], v)} />
          </div>
        </section>

        <section className={p.rhythmCard}>
          <header className={p.rhythmHead}>
            <span className={p.promptTitle}>«Печатает…»</span>
            <Toggle checked={draft.typing?.enabled !== false} onChange={(v) => set(['typing', 'enabled'], v)}>включено</Toggle>
          </header>
          <p className={p.promptHint}>
            Перед каждой частью ответа — статус набора на время, зависящее от длины. Набор идёт заходами с короткими
            паузами, как у человека, который печатает, задумывается и дописывает.
          </p>
          <Num
            label="Скорость набора"
            unit="зн/с"
            max={100}
            value={draft.typing?.chars_per_second}
            onChange={(v) => set(['typing', 'chars_per_second'], v)}
          />
          <Num
            label="Не короче"
            unit="сек"
            max={60}
            step={0.5}
            value={draft.typing?.min_seconds}
            onChange={(v) => set(['typing', 'min_seconds'], v)}
          />
          <div className={p.rhythmPair}>
            <Num label="Между частями от" unit="сек" max={60} step={0.5} value={draft.typing?.part_pause_min} onChange={(v) => set(['typing', 'part_pause_min'], v)} />
            <Num label="до" unit="сек" max={60} step={0.5} value={draft.typing?.part_pause_max} onChange={(v) => set(['typing', 'part_pause_max'], v)} />
          </div>
        </section>

        <section className={p.rhythmCard}>
          <header className={p.rhythmHead}>
            <span className={p.promptTitle}>Старые сообщения</span>
            <Toggle checked={draft.late_messages?.enabled !== false} onChange={(v) => set(['late_messages', 'enabled'], v)}>
              отвечать
            </Toggle>
          </header>
          <p className={p.promptHint}>
            Пришли, пока аккаунт был не в сети или без ответа, — например, при входе в аккаунт. Ответ не как на свежее:
            через «ответ через» из «После молчания», не ночью, и она коротко извиняется за паузу.
          </p>
          <Num
            label="Старое — старше"
            unit="ч"
            max={336}
            value={draft.late_messages?.stale_after_hours}
            onChange={(v) => set(['late_messages', 'stale_after_hours'], v)}
          />
          <Num
            label="Не отвечать — старше"
            unit="дн"
            max={365}
            value={draft.late_messages?.max_age_days}
            onChange={(v) => set(['late_messages', 'max_age_days'], v)}
          />
        </section>

        <section className={p.rhythmCard}>
          <header className={p.rhythmHead}>
            <span className={p.promptTitle}>Общее</span>
          </header>
          <label className={p.rhythmField}>
            <span className={p.rhythmLabel}>Часовой пояс окон</span>
            <select className={s.select} value={draft.timezone} onChange={(e) => set(['timezone'], e.target.value)}>
              {!TIMEZONES.some((t) => t.id === draft.timezone) && <option value={draft.timezone}>{draft.timezone}</option>}
              {TIMEZONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <Num
            label="Не писать утро и прощание молчащим дольше"
            unit="дн"
            max={60}
            value={draft.skip_if_silent_days}
            onChange={(v) => set(['skip_if_silent_days'], v)}
          />
          <Num
            label="Сама пишет подряд, пока он не ответил (утро, прощание, «куда пропал»)"
            unit="сообщ."
            max={5}
            value={draft.max_unanswered}
            onChange={(v) => set(['max_unanswered'], v)}
          />
        </section>
      </div>

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
          {busy ? 'Сохранение…' : 'Сохранить ритм'}
        </button>
      </div>
    </div>
  );
}
