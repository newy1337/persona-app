import { useEffect, useMemo, useRef, useState } from 'react';
import s from './DateRangePicker.module.scss';

const MSK_OFFSET_MS = 3 * 3600 * 1000;
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export const mskToday = (now = Date.now()) => new Date(now + MSK_OFFSET_MS).toISOString().slice(0, 10);

export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export function weekStart(day) {
  const d = new Date(`${day}T00:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

export const monthStart = (day) => `${day.slice(0, 7)}-01`;

export function shiftMonth(monthDay, n) {
  const d = new Date(`${monthStart(monthDay)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export const monthEnd = (day) => addDays(shiftMonth(day, 1), -1);

export function presets(today = mskToday(), firstDay = null) {
  const prevMonth = addDays(monthStart(today), -1);
  return [
    { key: 'today', label: 'Сегодня', from: today, to: today },
    { key: 'yesterday', label: 'Вчера', from: addDays(today, -1), to: addDays(today, -1) },
    { key: 'week', label: 'Эта неделя', from: weekStart(today), to: today },
    { key: '7d', label: 'Последние 7 дней', from: addDays(today, -6), to: today },
    { key: '30d', label: 'Последние 30 дней', from: addDays(today, -29), to: today },
    { key: 'month', label: 'Этот месяц', from: monthStart(today), to: today },
    { key: 'prev_month', label: 'Прошлый месяц', from: monthStart(prevMonth), to: prevMonth },
    { key: '90d', label: 'Последние 90 дней', from: addDays(today, -89), to: today },
    ...(firstDay ? [{ key: 'all', label: 'Всё время', from: firstDay, to: today }] : []),
  ];
}

export const human = (day) => (day ? day.split('-').reverse().join('.') : '');

export function monthGrid(monthDay) {
  const first = monthStart(monthDay);
  const last = monthEnd(monthDay);
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells = [...Array(lead).fill(null)];
  for (let d = first; d <= last; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

function Month({ monthDay, from, to, today, onPick }) {
  const title = `${MONTHS[Number(monthDay.slice(5, 7)) - 1]} ${monthDay.slice(0, 4)}`;
  return (
    <div className={s.month}>
      <div className={s.monthTitle}>{title}</div>
      <div className={s.week}>
        {WEEKDAYS.map((w) => (
          <span key={w} className={s.weekday}>{w}</span>
        ))}
      </div>
      <div className={s.days}>
        {monthGrid(monthDay).map((day, i) =>
          day === null ? (
            <span key={`x${i}`} />
          ) : (
            <button
              key={day}
              type="button"
              className={[
                s.day,
                day === from || day === to ? s.dayEdge : '',
                from && to && day > from && day < to ? s.dayInside : '',
                day === today ? s.dayToday : '',
                day > today ? s.dayFuture : '',
              ].join(' ')}
              disabled={day > today}
              onClick={() => onPick(day)}
              title={human(day)}
            >
              {Number(day.slice(8, 10))}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export default function DateRangePicker({ from, to, firstDay = null, onChange }) {
  const today = mskToday();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const [leftMonth, setLeftMonth] = useState(monthStart(to || today));
  const box = useRef(null);
  const list = useMemo(() => presets(today, firstDay), [today, firstDay]);
  const active = list.find((p) => p.from === from && p.to === to);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(day) {
    if (anchor && day >= anchor) {
      onChange({ from: anchor, to: day });
      setAnchor(null);
      setOpen(false);
      return;
    }
    setAnchor(day);
  }

  return (
    <div className={s.wrap} ref={box}>
      <button
        type="button"
        className={s.field}
        data-testid="range-button"
        onClick={() => {
          setAnchor(null);
          setLeftMonth(shiftMonth(monthStart(to || today), -1));
          setOpen((v) => !v);
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
        <span className={s.fieldText}>
          {active ? active.label : from === to ? human(from) : `${human(from)} — ${human(to)}`}
        </span>
        <span className={s.caret} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className={s.panel} role="dialog" aria-label="Выбор периода">
          <div className={s.presets}>
            {list.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`${s.preset} ${active?.key === p.key ? s.presetActive : ''}`}
                onClick={() => {
                  onChange({ from: p.from, to: p.to });
                  setOpen(false);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className={s.calendars}>
            <div className={s.navRow}>
              <button type="button" className={s.navBtn} onClick={() => setLeftMonth(shiftMonth(leftMonth, -1))} aria-label="Предыдущий месяц">‹</button>
              <span className={s.hint}>
                {anchor ? `Начало: ${human(anchor)} — выберите конец` : 'Выберите начало и конец периода'}
              </span>
              <button
                type="button"
                className={s.navBtn}
                disabled={shiftMonth(leftMonth, 1) >= monthStart(today)}
                onClick={() => setLeftMonth(shiftMonth(leftMonth, 1))}
                aria-label="Следующий месяц"
              >
                ›
              </button>
            </div>
            <div className={s.months}>
              {[leftMonth, shiftMonth(leftMonth, 1)].map((m) => (
                <Month key={m} monthDay={m} from={anchor ?? from} to={anchor ? null : to} today={today} onPick={pick} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
