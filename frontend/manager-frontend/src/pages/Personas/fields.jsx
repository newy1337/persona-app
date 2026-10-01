import { useState } from 'react';
import s from '../../styles/AdminPage.module.scss';
import p from './Personas.module.scss';

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

function ScalarField({ value, onChange }) {
  if (typeof value === 'boolean') {
    return (
      <label className={s.check}>
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        {value ? 'да' : 'нет'}
      </label>
    );
  }
  if (typeof value === 'number') {
    return (
      <input
        className={`${s.field} ${p.numField}`}
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
    return <input className={s.field} value="" placeholder="пусто" onChange={(e) => onChange(e.target.value)} />;
  }
  if (isLongText(value)) {
    return (
      <textarea
        className={`${s.field} ${p.textField}`}
        rows={Math.min(12, Math.max(2, String(value).split('\n').length + 1))}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return <input className={s.field} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function itemTitle(item, index) {
  if (isPlain(item)) return String(item ?? '').slice(0, 80) || `— ${index + 1}`;
  const named = item.id ?? item.title ?? item.name ?? item.topic ?? item.text ?? item.story;
  return named ? String(named).slice(0, 80) : `${index + 1}`;
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
    <div className={p.fieldList}>
      {value.map((item, i) => (
        <div key={i} className={allPlain ? p.listRow : p.listCard}>
          {allPlain ? (
            <>
              <ScalarField value={item} onChange={(v) => replace(i, v)} />
              <div className={p.rowTools}>
                <button className={p.iconBtn} title="Выше" onClick={() => move(i, -1)}>↑</button>
                <button className={p.iconBtn} title="Ниже" onClick={() => move(i, 1)}>↓</button>
                <button className={`${p.iconBtn} ${p.iconDanger}`} title="Удалить" onClick={() => remove(i)}>✕</button>
              </div>
            </>
          ) : (
            <>
              <div className={p.cardHead}>
                <button className={p.cardToggle} onClick={() => toggle(i)}>
                  <span className={p.caret}>{open.has(i) ? '▾' : '▸'}</span>
                  <span className={p.cardName}>{itemTitle(item, i)}</span>
                </button>
                <div className={p.rowTools}>
                  <button className={p.iconBtn} title="Выше" onClick={() => move(i, -1)}>↑</button>
                  <button className={p.iconBtn} title="Ниже" onClick={() => move(i, 1)}>↓</button>
                  <button className={`${p.iconBtn} ${p.iconDanger}`} title="Удалить" onClick={() => remove(i)}>✕</button>
                </div>
              </div>
              {open.has(i) && (
                <div className={p.cardBody}>
                  <ValueEditor value={item} onChange={(v) => replace(i, v)} />
                </div>
              )}
            </>
          )}
        </div>
      ))}
      <button className={s.btnSm} onClick={addItem}>+ Добавить</button>
    </div>
  );
}

function ObjectEditor({ value, onChange }) {
  const keys = Object.keys(value).filter((k) => !k.startsWith('_'));
  if (!keys.length) return <p className={s.muted}>Пусто — добавьте поля в режиме JSON.</p>;
  return (
    <div className={p.fields}>
      {keys.map((k) => {
        const hint = hintFor(value, k);
        return (
          <div key={k} className={p.field}>
            <div className={p.fieldLabel}>
              <span className={p.fieldName}>{label(k)}</span>
              {label(k) !== k && <span className={p.fieldKey}>{k}</span>}
              {hint && <span className={p.fieldHint}>{hint}</span>}
            </div>
            <div className={p.fieldValue}>
              <ValueEditor value={value[k]} onChange={(v) => onChange({ ...value, [k]: v })} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ValueEditor({ value, onChange }) {
  if (Array.isArray(value)) return <ArrayEditor value={value} onChange={onChange} />;
  if (value && typeof value === 'object') return <ObjectEditor value={value} onChange={onChange} />;
  return <ScalarField value={value} onChange={onChange} />;
}
