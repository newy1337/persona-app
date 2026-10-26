import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRhythmDefaults, putSection } from '../../api/personas';
import { History, Keyboard, MessageCircleMore, Moon, RotateCcw, Sun, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconAction } from '@/components/IconAction/IconAction';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import VersionsTable, { useVersions } from './Versions';
import { EditorBar, SaveBar } from './EditorBar';
import { drafts } from './drafts';
import { Labeled } from './help';
import { TIMEZONES, rhythmSummary } from './rhythm';

const DRAFT_DELAY_MS = 600;

// Ритм читается как текст: каждая настройка — предложение с полями внутри
// («Дальше — через [3]–[20] мин»), а не стена подписанных полей. Карточки
// идут сверху вниз; у карточки выключатель, выключенная приглушена и не
// редактируется. Задержку ответа поясняет полоса фаз, утро и прощание — сутки
// на шкале 0–24. «От» больше «до» — поле красное и рядом пояснение.

/** Число внутри предложения. label — имя поля для скринридера и тестов. */
function Num({ label, value, onChange, min = 0, max = 1440, step = 1, invalid = false, wide = false }) {
  return (
    <Input
      type="number"
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={cn('inline-flex h-8 px-2 text-center tabular-nums', wide ? 'w-20' : 'w-16')}
      min={min}
      max={max}
      step={step}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
    />
  );
}

const bad = (lo, hi) => lo !== '' && hi !== '' && lo != null && hi != null && Number(lo) > Number(hi);

/** «[1]–[2] мин»: пара от–до с проверкой порядка. */
function Range({ label, lo, hi, onLo, onHi, unit, step = 1, max }) {
  const wrong = bad(lo, hi);
  return (
    <span className="inline-flex items-center gap-1">
      <Num label={`${label}: от`} value={lo} onChange={onLo} step={step} max={max} invalid={wrong} />
      <span className="text-muted-foreground">–</span>
      <Num label={`${label}: до`} value={hi} onChange={onHi} step={step} max={max} invalid={wrong} />
      <span>{unit}</span>
      {wrong && <span className="text-xs text-destructive" role="alert">«от» больше «до»</span>}
    </span>
  );
}

function Time({ label, value, onChange }) {
  return <Input type="time" aria-label={label} className="inline-flex h-8 w-[104px] px-2 tabular-nums" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

/** Строка-предложение: текст и поля в одну строку, переносится целиком. */
const Line = ({ children, hint }) => (
  <div className="flex flex-col gap-0.5">
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm leading-8">{children}</p>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

function Card({ icon: Icon, title, help, summary, enabled, onToggle, toggleLabel = title, className, children }) {
  const off = enabled === false;
  return (
    <section className={cn('flex flex-col rounded-lg border bg-card', className)} aria-label={title} data-rhythm-card={title}>
      <header className="flex items-start gap-3 border-b px-4 py-3">
        <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-md', off ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary')}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <Labeled label={title} help={help} className="text-sm font-medium" />
          <p className="truncate text-xs text-muted-foreground" title={summary}>{off ? 'выключено' : summary}</p>
        </div>
        {onToggle && <Switch checked={!off} onCheckedChange={onToggle} aria-label={toggleLabel} className="mt-1.5" />}
      </header>
      <fieldset disabled={off} className={cn('flex flex-col gap-3 px-4 py-3', off && 'opacity-50')}>
        {children}
      </fieldset>
    </section>
  );
}

const span = (lo, hi, unit) => (lo === hi ? `${lo ?? '?'} ${unit}` : `${lo ?? '?'}–${hi ?? '?'} ${unit}`);

/** Полоса фаз задержки ответа: первые сообщения → разогрев → дальше. */
function Phases({ rd }) {
  const firstN = Number(rd.first_messages) || 0;
  const phases = [
    firstN > 0 && { key: 'first', title: `Первые ${firstN} сообщ.`, value: span(rd.first_min_minutes, rd.first_max_minutes, 'мин'), tone: 'bg-primary/15' },
    { key: 'warm', title: `Разогрев ${rd.warmup_minutes ?? '?'} мин`, value: span(rd.warmup_min_minutes, rd.warmup_max_minutes, 'мин'), tone: 'bg-primary/25' },
    { key: 'then', title: 'Дальше', value: span(rd.min_minutes, rd.max_minutes, 'мин'), tone: 'bg-primary/40' },
  ].filter(Boolean);
  return (
    <ol className="flex overflow-hidden rounded-md text-xs" aria-label="Фазы задержки ответа" data-testid="rhythm-phases">
      {phases.map((p, i) => (
        <li key={p.key} className={cn('flex min-w-0 flex-1 flex-col px-3 py-2', p.tone, i > 0 && 'border-l-2 border-card')}>
          <span className="truncate text-muted-foreground">{p.title}</span>
          <span className="font-medium tabular-nums">{`ответ через ${p.value}`}</span>
        </li>
      ))}
    </ol>
  );
}

const minutesOf = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Окно на шкале суток; «до» раньше «с» — через полночь, два куска. */
function windowParts(from, to) {
  const a = minutesOf(from);
  let b = minutesOf(to);
  if (a === null || b === null) return [];
  if (b === 0) b = 1440;
  return b > a ? [[a, b]] : [[a, 1440], [0, b]];
}

/** Сутки 0–24 с окнами утреннего сообщения и прощания. */
function DayStrip({ morning, goodnight }) {
  const bands = [
    morning.enabled !== false && { key: 'morning', label: 'утро', parts: windowParts(morning.from, morning.to), color: 'var(--series-4)' },
    goodnight.enabled !== false && { key: 'night', label: 'прощание', parts: windowParts(goodnight.from, goodnight.to), color: 'var(--series-1)' },
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-1" data-testid="rhythm-day">
      <div className="relative h-7 overflow-hidden rounded-md bg-muted/60">
        {bands.flatMap((b) =>
          b.parts.map(([lo, hi], i) => (
            <span
              key={`${b.key}-${i}`}
              className="absolute inset-y-0 flex items-center justify-center overflow-hidden text-[11px] font-medium text-white"
              style={{ left: `${(lo / 1440) * 100}%`, width: `${((hi - lo) / 1440) * 100}%`, background: b.color }}
              title={b.label}
            >
              {i === 0 && hi - lo >= 120 ? b.label : ''}
            </span>
          )),
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => <span key={h}>{h}</span>)}
      </div>
    </div>
  );
}

function InlineSwitch({ checked, onChange, label }) {
  return <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />;
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
  const typing = draft.typing ?? {};
  const late = draft.late_messages ?? {};
  const firstN = Number(rd.first_messages) || 0;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <EditorBar
        summary={rhythmSummary(draft)}
        helpLabel="Ритм"
        help="Правка действует со следующего сообщения, перезапуск не нужен. Окна утра и прощания — по часам выбранного пояса; утро и прощание слушаются общего выключателя инициативы в настройках."
        draftAt={draftAt}
        dirty={dirty}
        versions={versions}
        onReset={reset}
      >
        <IconAction icon={RotateCcw} label="Как по умолчанию" hint="Как по умолчанию: подставить цифры — сохранит обычная кнопка" onClick={applyDefaults} />
      </EditorBar>

      <VersionsTable versions={versions.versions} loading={versions.loading} onRestore={versions.restore} />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card
          icon={Timer}
          title="Скорость ответа"
          help="Сначала отвечает быстро, дальше — как занятой человек."
          summary={`сначала ${span(firstN > 0 ? rd.first_min_minutes : rd.warmup_min_minutes, firstN > 0 ? rd.first_max_minutes : rd.warmup_max_minutes, 'мин')}, дальше ${span(rd.min_minutes, rd.max_minutes, 'мин')}`}
          enabled={rd.enabled !== false}
          onToggle={(v) => set(['reply_delay', 'enabled'], v)}
          toggleLabel="Задержка ответа"
          className="lg:col-span-2"
        >
          <Phases rd={rd} />
          <Line hint="0 — первых сообщений нет, сразу разогрев">
            Первые <Num label="Сколько первых сообщений" value={rd.first_messages} max={500} onChange={(v) => set(['reply_delay', 'first_messages'], v)} /> сообщений — ответ через
            <Range label="Первые" lo={rd.first_min_minutes} hi={rd.first_max_minutes} step={0.5} unit="мин" onLo={(v) => set(['reply_delay', 'first_min_minutes'], v)} onHi={(v) => set(['reply_delay', 'first_max_minutes'], v)} />
          </Line>
          <Line>
            Разогрев <Num label="Разогрев, мин" value={rd.warmup_minutes} onChange={(v) => set(['reply_delay', 'warmup_minutes'], v)} /> мин {firstN > 0 ? 'после них' : 'от его первого сообщения'} — через
            <Range label="Разогрев" lo={rd.warmup_min_minutes} hi={rd.warmup_max_minutes} unit="мин" onLo={(v) => set(['reply_delay', 'warmup_min_minutes'], v)} onHi={(v) => set(['reply_delay', 'warmup_max_minutes'], v)} />
          </Line>
          <Line>
            Дальше — через
            <Range label="Дальше" lo={rd.min_minutes} hi={rd.max_minutes} unit="мин" onLo={(v) => set(['reply_delay', 'min_minutes'], v)} onHi={(v) => set(['reply_delay', 'max_minutes'], v)} />
          </Line>
          <Line hint="Ответ уходит одним сообщением, когда он замолчит.">
            Пишет несколько подряд — ждёт <Num label="Пауза в потоке, сек" value={rd.burst_seconds} max={600} onChange={(v) => set(['reply_delay', 'burst_seconds'], v)} /> сек тишины
          </Line>
        </Card>

        <Card
          icon={Moon}
          title="После молчания"
          help="Бот написал, а собеседник молчал дольше порога — отвечает не сразу. Ночь и разговор, закрытый «спокойной ночи», молчанием не считаются. Следующий ответ — снова обычный."
          summary={`молчал больше ${as.silence_hours ?? '?'} ч — ответ через ${span(as.min_hours, as.max_hours, 'ч')}`}
          enabled={as.enabled !== false}
          onToggle={(v) => set(['after_silence', 'enabled'], v)}
        >
          <Line hint="Ночь и разговор, закрытый «спокойной ночи», молчанием не считаются.">
            Если он молчал дольше <Num label="Молчал дольше, ч" value={as.silence_hours} max={72} step={0.5} onChange={(v) => set(['after_silence', 'silence_hours'], v)} /> ч — ответит через
            <Range label="После молчания" lo={as.min_hours} hi={as.max_hours} step={0.5} max={48} unit="ч" onLo={(v) => set(['after_silence', 'min_hours'], v)} onHi={(v) => set(['after_silence', 'max_hours'], v)} />
          </Line>
        </Card>

        <Card
          icon={Keyboard}
          title="«Печатает…»"
          help="Перед каждой частью ответа — статус набора на время, зависящее от длины. Набор идёт заходами с короткими паузами, как у человека, который печатает, задумывается и дописывает."
          summary={`${typing.chars_per_second ?? '?'} знаков в секунду, между частями ${span(typing.part_pause_min, typing.part_pause_max, 'сек')}`}
          enabled={typing.enabled !== false}
          onToggle={(v) => set(['typing', 'enabled'], v)}
        >
          <Line>
            Набирает <Num label="Скорость набора, зн/с" value={typing.chars_per_second} max={100} onChange={(v) => set(['typing', 'chars_per_second'], v)} /> знаков в секунду, но не меньше
            <Num label="Не короче, сек" value={typing.min_seconds} max={60} step={0.5} onChange={(v) => set(['typing', 'min_seconds'], v)} /> сек
          </Line>
          <Line>
            Между частями ответа — пауза
            <Range label="Между частями" lo={typing.part_pause_min} hi={typing.part_pause_max} step={0.5} max={60} unit="сек" onLo={(v) => set(['typing', 'part_pause_min'], v)} onHi={(v) => set(['typing', 'part_pause_max'], v)} />
          </Line>
        </Card>

        <Card
          icon={Sun}
          title="Утро и прощание"
          help="Утреннее — одно в день, в случайную минуту окна, у каждого собеседника свою; написал первым — она просто ответит. Прощание — если сегодня общались и разговор затих; попрощался первым — ответит взаимно. «До» раньше «с» — окно через полночь. Тексты — промпты «Утреннее сообщение» и «Прощание на ночь»."
          summary={[morning.enabled !== false && `утро ${morning.from ?? '?'}–${morning.to ?? '?'}`, goodnight.enabled !== false && `прощание ${goodnight.from ?? '?'}–${goodnight.to ?? '?'}`].filter(Boolean).join(' · ') || 'оба выключены'}
        >
          <DayStrip morning={morning} goodnight={goodnight} />
          <Line>
            <InlineSwitch checked={morning.enabled !== false} onChange={(v) => set(['morning', 'enabled'], v)} label="Утреннее сообщение" />
            Утреннее сообщение с <Time label="Утро с" value={morning.from} onChange={(v) => set(['morning', 'from'], v)} /> до <Time label="Утро до" value={morning.to} onChange={(v) => set(['morning', 'to'], v)} />
          </Line>
          <Line>
            <InlineSwitch checked={goodnight.enabled !== false} onChange={(v) => set(['goodnight', 'enabled'], v)} label="Прощание на ночь" />
            Прощание на ночь с <Time label="Прощание с" value={goodnight.from} onChange={(v) => set(['goodnight', 'from'], v)} /> до <Time label="Прощание до" value={goodnight.to} onChange={(v) => set(['goodnight', 'to'], v)} />
          </Line>
          <Line>
            Не писать тем, кто молчит дольше <Num label="Не писать молчащим дольше, дн" value={draft.skip_if_silent_days} max={60} onChange={(v) => set(['skip_if_silent_days'], v)} /> дн
          </Line>
          <Line>
            Часы — по поясу
            <NativeSelect aria-label="Часовой пояс окон" className="h-8 w-auto" value={draft.timezone ?? ''} onChange={(e) => set(['timezone'], e.target.value)}>
              {!TIMEZONES.some((t) => t.id === draft.timezone) && <option value={draft.timezone ?? ''}>{draft.timezone}</option>}
              {TIMEZONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </NativeSelect>
          </Line>
        </Card>

        <Card
          icon={History}
          title="Старые сообщения"
          help="Пришли, пока аккаунт был не в сети или без ответа, — например, при входе в аккаунт. Ответ не как на свежее: через «ответ через» из «После молчания», не ночью, и она коротко извиняется за паузу."
          summary={`старше ${late.stale_after_hours ?? '?'} ч — с извинением, старше ${late.max_age_days ?? '?'} дн — без ответа`}
          enabled={late.enabled !== false}
          onToggle={(v) => set(['late_messages', 'enabled'], v)}
          toggleLabel="Отвечать на старые сообщения"
        >
          <Line hint="Ответит через время из «После молчания», не ночью, и коротко извинится за паузу.">
            Старше <Num label="Старое — старше, ч" value={late.stale_after_hours} max={336} onChange={(v) => set(['late_messages', 'stale_after_hours'], v)} /> ч — отвечает как на старое
          </Line>
          <Line>
            Старше <Num label="Не отвечать — старше, дн" value={late.max_age_days} max={365} onChange={(v) => set(['late_messages', 'max_age_days'], v)} /> дн — не отвечает вообще
          </Line>
        </Card>

        <Card
          icon={MessageCircleMore}
          title="Сама пишет первой"
          help="Утро, прощание, «куда пропал» — сообщения, которые она пишет сама, без его ответа."
          summary={`подряд не больше ${draft.max_unanswered ?? '?'}, пока он молчит`}
        >
          <Line hint="Утро, прощание, «куда пропал».">
            Пишет подряд не больше <Num label="Сама пишет подряд, сообщ." value={draft.max_unanswered} max={5} onChange={(v) => set(['max_unanswered'], v)} /> сообщ., пока он не ответил
          </Line>
        </Card>
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
