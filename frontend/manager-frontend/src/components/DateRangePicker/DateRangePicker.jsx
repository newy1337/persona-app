import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MSK_OFFSET_MS = 3 * 3600 * 1000;
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
// Сетка месяца всегда 6 недель — высота панели не меняется от месяца к месяцу.
const GRID_CELLS = 42;

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
  const cells = monthGrid(monthDay);
  while (cells.length < GRID_CELLS) cells.push(null);
  return (
    <div className="w-[224px]">
      <div className="mb-1.5 text-center text-sm font-medium">{title}</div>
      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((w) => (
          <span key={w} className="pb-0.5 text-center text-[11px] text-muted-foreground">{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (day === null) return <span key={`x${i}`} className="size-8" />;
          const edge = day === from || day === to;
          const inside = from && to && day > from && day < to;
          return (
            <Button
              key={day}
              type="button"
              variant="ghost"
              className={cn(
                'size-8 p-0 text-xs font-normal tabular-nums',
                edge && 'bg-primary font-semibold text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
                inside && 'rounded-none bg-primary/15 hover:bg-primary/25',
                day === today && !edge && 'ring-1 ring-primary/60 ring-inset',
                day > today && 'text-muted-foreground',
              )}
              disabled={day > today}
              onClick={() => onPick(day)}
              title={human(day)}
            >
              {Number(day.slice(8, 10))}
            </Button>
          );
        })}
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
  const trigger = useRef(null);
  const panel = useRef(null);
  const list = useMemo(() => presets(today, firstDay), [today, firstDay]);
  const active = list.find((p) => p.from === from && p.to === to);

  // Закрытие по выбору или Escape возвращает фокус на кнопку; клик мимо панели — нет.
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return undefined;
    panel.current?.focus({ preventScroll: true });
    const onDown = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(day) {
    if (anchor && day >= anchor) {
      onChange({ from: anchor, to: day });
      setAnchor(null);
      close();
      return;
    }
    setAnchor(day);
  }

  return (
    <div className="relative" ref={box}>
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        className="min-w-[180px] justify-start"
        data-testid="range-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setAnchor(null);
          setLeftMonth(shiftMonth(monthStart(to || today), -1));
          setOpen((v) => !v);
        }}
      >
        <Calendar aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left tabular-nums">
          {active ? active.label : from === to ? human(from) : `${human(from)} — ${human(to)}`}
        </span>
        <ChevronDown className="opacity-60" aria-hidden="true" />
      </Button>

      {open && (
        <div
          ref={panel}
          tabIndex={-1}
          role="dialog"
          aria-label="Выбор периода"
          className="absolute top-[calc(100%+6px)] right-0 z-50 flex max-h-[calc(100vh-120px)] overflow-auto rounded-lg border bg-popover text-popover-foreground shadow-md outline-hidden [scrollbar-gutter:stable] max-md:right-auto max-md:left-0 max-md:max-w-[calc(100vw-32px)] max-md:flex-col"
        >
          <div className="flex min-w-[190px] flex-col gap-0.5 border-r bg-muted/30 p-2 max-md:flex-row max-md:flex-wrap max-md:border-r-0 max-md:border-b">
            {list.map((p) => (
              <Button
                key={p.key}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={active?.key === p.key}
                className="justify-start aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"
                onClick={() => {
                  onChange({ from: p.from, to: p.to });
                  close();
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="px-3 pt-2.5 pb-3">
            <div className="mb-1.5 flex items-center gap-2.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setLeftMonth(shiftMonth(leftMonth, -1))}
                aria-label="Предыдущий месяц"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <span className="min-h-4 flex-1 truncate text-center text-xs text-muted-foreground">
                {anchor ? `Начало: ${human(anchor)} — выберите конец` : 'Выберите начало и конец периода'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={shiftMonth(leftMonth, 1) >= monthStart(today)}
                onClick={() => setLeftMonth(shiftMonth(leftMonth, 1))}
                aria-label="Следующий месяц"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
            <div className="flex gap-4 max-md:flex-col max-md:gap-2.5">
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
