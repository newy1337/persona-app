import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRhythmDefaults, putSection } from '../../api/personas';
import { RotateCcw } from 'lucide-react';
import { IconAction } from '@/components/IconAction/IconAction';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import VersionsTable, { useVersions } from './Versions';
import { EditorBar, SaveBar } from './EditorBar';
import { drafts } from './drafts';
import { TIMEZONES, rhythmSummary } from './rhythm';

const DRAFT_DELAY_MS = 600;

function Num({ label, hint, value, onChange, min = 0, max = 1440, step = 1, unit }) {
  return (
    <Field label={label} hint={hint}>
      <span className="flex items-center gap-1.5">
        <Input
          type="number"
          className="max-w-30 tabular-nums"
          min={min}
          max={max}
          step={step}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </span>
    </Field>
  );
}

function Toggle({ checked, onChange, children }) {
  return (
    <Label className="gap-1.5 text-xs font-normal text-muted-foreground">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {children}
    </Label>
  );
}

function Time({ label, value, onChange }) {
  return (
    <Field label={label}>
      <Input type="time" className="tabular-nums" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

// Блок настроек — раздел с линией сверху: рамка в рамке блока личности не нужна.
function Block({ title, toggle, hint, children }) {
  return (
    <section className="flex flex-col gap-2.5 border-t pt-4">
      <header className="flex min-h-5 items-center justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        {toggle}
      </header>
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

const Pair = ({ children }) => <div className="grid grid-cols-2 gap-2.5">{children}</div>;

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
    <div className="flex flex-1 flex-col gap-4">
      <EditorBar
        summary={rhythmSummary(draft)}
        hint="Правка действует со следующего сообщения, перезапуск не нужен. Окна утра и прощания — по часам выбранного пояса; утро и прощание слушаются общего выключателя инициативы в настройках."
        draftAt={draftAt}
        dirty={dirty}
        versions={versions}
        onReset={reset}
      >
        <IconAction
          icon={RotateCcw}
          label="Как по умолчанию"
          hint="Как по умолчанию: подставить цифры — сохранит обычная кнопка"
          onClick={applyDefaults}
        />
      </EditorBar>

      <VersionsTable versions={versions.versions} loading={versions.loading} onRestore={versions.restore} />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-x-8 gap-y-6">
        <Block
          title="Задержка ответа"
          toggle={<Toggle checked={rd.enabled !== false} onChange={(v) => set(['reply_delay', 'enabled'], v)}>включена</Toggle>}
          hint="Сначала отвечает быстро, дальше — как занятой человек."
        >
          <Num
            label="Разогрев"
            unit="мин"
            hint="от его первого сообщения"
            value={rd.warmup_minutes}
            onChange={(v) => set(['reply_delay', 'warmup_minutes'], v)}
          />
          <Pair>
            <Num label="В разогреве от" unit="мин" value={rd.warmup_min_minutes} onChange={(v) => set(['reply_delay', 'warmup_min_minutes'], v)} />
            <Num label="до" unit="мин" value={rd.warmup_max_minutes} onChange={(v) => set(['reply_delay', 'warmup_max_minutes'], v)} />
          </Pair>
          <Pair>
            <Num label="Потом от" unit="мин" value={rd.min_minutes} onChange={(v) => set(['reply_delay', 'min_minutes'], v)} />
            <Num label="до" unit="мин" value={rd.max_minutes} onChange={(v) => set(['reply_delay', 'max_minutes'], v)} />
          </Pair>
          <Num
            label="Пауза в потоке"
            unit="сек"
            max={600}
            hint="пишет несколько сообщений подряд — ответ ждёт, пока замолчит, и уходит одним"
            value={rd.burst_seconds}
            onChange={(v) => set(['reply_delay', 'burst_seconds'], v)}
          />
        </Block>

        <Block
          title="После молчания"
          toggle={<Toggle checked={as.enabled !== false} onChange={(v) => set(['after_silence', 'enabled'], v)}>включено</Toggle>}
          hint="Бот написал, а собеседник молчал дольше порога — отвечает не сразу. Ночь и разговор, закрытый «спокойной ночи», молчанием не считаются. Следующий ответ — снова обычный."
        >
          <Num label="Молчал дольше" unit="ч" max={72} step={0.5} value={as.silence_hours} onChange={(v) => set(['after_silence', 'silence_hours'], v)} />
          <Pair>
            <Num label="Ответ через от" unit="ч" max={48} step={0.5} value={as.min_hours} onChange={(v) => set(['after_silence', 'min_hours'], v)} />
            <Num label="до" unit="ч" max={48} step={0.5} value={as.max_hours} onChange={(v) => set(['after_silence', 'max_hours'], v)} />
          </Pair>
        </Block>

        <Block
          title="Утреннее сообщение"
          toggle={<Toggle checked={morning.enabled !== false} onChange={(v) => set(['morning', 'enabled'], v)}>включено</Toggle>}
          hint="Одно в день, в случайную минуту окна — у каждого собеседника свою. Написал первым этим утром — она просто ответит на его сообщение. Текст — промпт «Утреннее сообщение»."
        >
          <Pair>
            <Time label="С" value={morning.from} onChange={(v) => set(['morning', 'from'], v)} />
            <Time label="До" value={morning.to} onChange={(v) => set(['morning', 'to'], v)} />
          </Pair>
        </Block>

        <Block
          title="Прощание на ночь"
          toggle={<Toggle checked={goodnight.enabled !== false} onChange={(v) => set(['goodnight', 'enabled'], v)}>включено</Toggle>}
          hint="Если сегодня общались и разговор затих. Попрощался первым — ответит взаимно, своё прощание не шлёт. «До» раньше «с» — окно через полночь. Текст — промпт «Прощание на ночь»."
        >
          <Pair>
            <Time label="С" value={goodnight.from} onChange={(v) => set(['goodnight', 'from'], v)} />
            <Time label="До" value={goodnight.to} onChange={(v) => set(['goodnight', 'to'], v)} />
          </Pair>
        </Block>

        <Block
          title="«Печатает…»"
          toggle={<Toggle checked={draft.typing?.enabled !== false} onChange={(v) => set(['typing', 'enabled'], v)}>включено</Toggle>}
          hint="Перед каждой частью ответа — статус набора на время, зависящее от длины. Набор идёт заходами с короткими паузами, как у человека, который печатает, задумывается и дописывает."
        >
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
          <Pair>
            <Num label="Между частями от" unit="сек" max={60} step={0.5} value={draft.typing?.part_pause_min} onChange={(v) => set(['typing', 'part_pause_min'], v)} />
            <Num label="до" unit="сек" max={60} step={0.5} value={draft.typing?.part_pause_max} onChange={(v) => set(['typing', 'part_pause_max'], v)} />
          </Pair>
        </Block>

        <Block
          title="Старые сообщения"
          toggle={
            <Toggle checked={draft.late_messages?.enabled !== false} onChange={(v) => set(['late_messages', 'enabled'], v)}>
              отвечать
            </Toggle>
          }
          hint="Пришли, пока аккаунт был не в сети или без ответа, — например, при входе в аккаунт. Ответ не как на свежее: через «ответ через» из «После молчания», не ночью, и она коротко извиняется за паузу."
        >
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
        </Block>

        <Block title="Общее">
          <Field label="Часовой пояс окон">
            <NativeSelect value={draft.timezone ?? ''} onChange={(e) => set(['timezone'], e.target.value)}>
              {!TIMEZONES.some((t) => t.id === draft.timezone) && <option value={draft.timezone ?? ''}>{draft.timezone}</option>}
              {TIMEZONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </NativeSelect>
          </Field>
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
        </Block>
      </div>

      <SaveBar
        status={flash}
        note={note}
        onNote={setNote}
        onSave={save}
        disabled={!dirty || busy}
        busy={busy}
        label="Сохранить ритм"
      />
    </div>
  );
}
