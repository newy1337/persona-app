import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export const LABELS = {
  name: 'Имя',
  identity: 'Кто она',
  public_label: 'Как себя называет',
  ordinary_conversation: 'Обычный разговор',
  direct_question: 'Прямой вопрос «ты бот?»',
  boundary: 'Граница',
  card: 'Факты о себе',
  biography: 'Биография',
  relationship_values: 'Про отношения',
  daily_life: 'Быт',
  work_and_income: 'Работа и доход',
  human_behavior: 'Человеческие мелочи',
  voice: 'Манера речи',
  tastes: 'Вкусы',
  fun_facts: 'Мелкие факты',
  stories: 'Готовые истории',
  story_usage_rules: 'Как рассказывать истории',
  chat_examples: 'Примеры переписки',
  dialogue_examples: 'Примеры диалога',
  dating_site: 'Сайт знакомств',
  self_disclosure: 'Насколько открывается',
  stages: 'Этапы знакомства',
  slots: 'Что хочет узнать',
  shared: 'Что рассказывает о себе',
  gap: 'Паузы в переписке',
  tone_step: 'Шаг смягчения тона',
  streak_boost: 'Ускорение при серии дней',
  one_step_per_day: 'Не больше этапа в день',
  acquaintance_plan: 'План знакомства',
  ask_policy: 'Когда спрашивать',
  ask_slots: 'Какие темы поднимать',
  not_before_day: 'Не раньше дня',
  required_by_day: 'Нужно к дню',
  desired_by_day: 'Желательно к дню',
  topic_triggers: 'Слова-поводы',
  requires: 'Требует',
  manner: 'Манера',
  personal: 'Личное',
  formality: 'Официальность',
  warmth: 'Теплота',
  beat_days: 'Дней на один шаг',
  rotation_days: 'Дней до смены линии',
  show_at_once: 'Линий в промпте за раз',
  lines: 'Сюжетные линии',
  beats: 'Шаги истории',
  beat_after_days: 'Шаг после дней',
  episodes: 'Прошлые случаи',
  text: 'Текст',
  topics: 'Темы',
  date: 'Дата',
  state: 'Состояние',
  pool: 'Из чего собирается день',
  mood: 'Настроение',
  id: 'Идентификатор',
  title: 'Название',
  scope: 'Вид',
  day: 'День',
  note: 'Заметка',
  hint: 'Подсказка',
  story: 'История',
  source_anchor: 'Источник',
};

export const label = (key) => LABELS[key] ?? key;

export function hintFor(parent, key) {
  if (!parent || typeof parent !== 'object') return null;
  for (const candidate of [`_${key}`, `_комментарий_${key}`, `_коммент_${key}`]) {
    if (typeof parent[candidate] === 'string') return parent[candidate];
  }
  return null;
}

const isPlain = (v) => v === null || typeof v !== 'object';
const isLongText = (v) => typeof v === 'string' && (v.length > 60 || v.includes('\n'));

/** Строка «подпись слева — значение справа»; общая для DocEditor и ObjectEditor. */
export function FieldRow({ parent, k, children }) {
  const hint = hintFor(parent, k);
  return (
    <div className="grid items-start gap-1.5 md:grid-cols-[minmax(150px,210px)_minmax(0,1fr)] md:gap-3.5">
      <div className="flex flex-col gap-0.5 md:pt-1.5">
        <span className="text-sm font-medium">{label(k)}</span>
        {label(k) !== k && <span className="font-mono text-[11px] text-muted-foreground">{k}</span>}
        {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ScalarField({ value, onChange }) {
  if (typeof value === 'boolean') {
    return (
      <Label className="h-9 gap-1.5 text-sm font-normal">
        <Checkbox checked={value} onCheckedChange={(v) => onChange(v === true)} />
        {value ? 'да' : 'нет'}
      </Label>
    );
  }
  if (typeof value === 'number') {
    return (
      <Input
        className="w-30 font-mono tabular-nums"
        inputMode="decimal"
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value.replace(',', '.'));
          onChange(Number.isFinite(n) ? n : value);
        }}
      />
    );
  }
  if (value === null) {
    return <Input value="" placeholder="пусто" onChange={(e) => onChange(e.target.value)} />;
  }
  if (isLongText(value)) {
    return (
      <Textarea
        className="field-sizing-fixed resize-y leading-normal"
        rows={Math.min(12, Math.max(2, String(value).split('\n').length + 1))}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return <Input value={value} onChange={(e) => onChange(e.target.value)} />;
}

function itemTitle(item, index) {
  if (isPlain(item)) return String(item ?? '').slice(0, 80) || `— ${index + 1}`;
  const named = item.id ?? item.title ?? item.name ?? item.topic ?? item.text ?? item.story;
  return named ? String(named).slice(0, 80) : `${index + 1}`;
}

function RowTools({ index, total, onMove, onRemove }) {
  return (
    <div className="flex shrink-0 gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="Выше"
        aria-label="Выше"
        disabled={index === 0}
        onClick={() => onMove(index, -1)}
      >
        <ArrowUp className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="Ниже"
        aria-label="Ниже"
        disabled={index === total - 1}
        onClick={() => onMove(index, 1)}
      >
        <ArrowDown className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-destructive hover:text-destructive"
        title="Удалить"
        aria-label="Удалить"
        onClick={() => onRemove(index)}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function ArrayEditor({ value, onChange }) {
  const [open, setOpen] = useState(() => new Set());
  const allPlain = value.every(isPlain);

  const replace = (i, next) => onChange(value.map((v, k) => (k === i ? next : v)));
  const remove = (i) => onChange(value.filter((_, k) => k !== i));
  const move = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const addItem = () => {
    const sample = value[value.length - 1];
    if (sample && !isPlain(sample) && !Array.isArray(sample)) {
      onChange([...value, Object.fromEntries(Object.keys(sample).map((k) => [k, typeof sample[k] === 'number' ? 0 : Array.isArray(sample[k]) ? [] : '']))]);
    } else {
      onChange([...value, '']);
    }
  };
  const toggle = (i) => setOpen((v) => { const n = new Set(v); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <div className="flex flex-col gap-2">
      {value.map((item, i) =>
        allPlain ? (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
            <ScalarField value={item} onChange={(v) => replace(i, v)} />
            <RowTools index={i} total={value.length} onMove={move} onRemove={remove} />
          </div>
        ) : (
          <div key={i} className="rounded-md border bg-muted/30">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="min-w-0 flex-1 justify-start gap-2 px-2 font-normal"
                aria-expanded={open.has(i)}
                onClick={() => toggle(i)}
              >
                <ChevronRight
                  className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open.has(i) && 'rotate-90')}
                />
                <span className="truncate">{itemTitle(item, i)}</span>
              </Button>
              <RowTools index={i} total={value.length} onMove={move} onRemove={remove} />
            </div>
            {open.has(i) && (
              <div className="border-t px-3 pt-2 pb-3">
                <ValueEditor value={item} onChange={(v) => replace(i, v)} />
              </div>
            )}
          </div>
        ),
      )}
      <Button variant="outline" size="sm" className="self-start" onClick={addItem}>+ Добавить</Button>
    </div>
  );
}

function ObjectEditor({ value, onChange }) {
  const keys = Object.keys(value).filter((k) => !k.startsWith('_'));
  if (!keys.length) return <p className="text-xs text-muted-foreground">Пусто — добавьте поля в режиме JSON.</p>;
  return (
    <div className="flex flex-col gap-3.5">
      {keys.map((k) => (
        <FieldRow key={k} parent={value} k={k}>
          <ValueEditor value={value[k]} onChange={(v) => onChange({ ...value, [k]: v })} />
        </FieldRow>
      ))}
    </div>
  );
}

export function ValueEditor({ value, onChange }) {
  if (Array.isArray(value)) return <ArrayEditor value={value} onChange={onChange} />;
  if (value && typeof value === 'object') return <ObjectEditor value={value} onChange={onChange} />;
  return <ScalarField value={value} onChange={onChange} />;
}
