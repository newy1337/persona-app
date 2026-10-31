import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import s from './ChatJournal.module.scss';

const dayFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
const AUTO = new Set(['Бот', 'Система']);

/** Записи по дням (МСК), порядок — как пришёл: новые сверху. */
export function groupByDay(items) {
  const groups = [];
  for (const it of items) {
    const title = dayFmt.format(new Date(it.ts * 1000));
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.items.push(it);
    else groups.push({ title, items: [it] });
  }
  return groups;
}

/** История чата: кто включал и выключал бота, менял этап, писал — время московское. */
export default function ChatJournal({ items, loading, error, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.panel} role="dialog" aria-label="История чата">
        <div className={s.head}>
          <h3 className={s.title}>История</h3>
          <button type="button" className={s.close} onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className={s.body}>
          {loading && <p className={s.empty}>Загрузка…</p>}
          {error && <p className={s.error}>{error}</p>}
          {!loading && !error && !items?.length && <p className={s.empty}>Здесь пока пусто</p>}
          {!loading && !error && groupByDay(items ?? []).map((g) => (
            <section key={g.title}>
              <h4 className={s.day}>{g.title}</h4>
              {g.items.map((it, i) => (
                <div key={`${it.ts}-${i}`} className={s.row} data-testid="journal-row">
                  <span className={s.time}>{timeFmt.format(new Date(it.ts * 1000))}</span>
                  <span className={`${s.who} ${AUTO.has(it.who) ? s.auto : ''}`}>{it.who}</span>
                  <span className={`${s.text} ${it.failed ? s.failed : ''}`}>{it.text}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
