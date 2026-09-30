import { moscowDay } from '../../utils/panelTime';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { withToken } from '../../utils/chat';
import s from './MediaGallery.module.scss';

const TABS = [
  { id: 'photo', label: 'Фото', kinds: ['photo'] },
  { id: 'video', label: 'Видео', kinds: ['video', 'animation'] },
  { id: 'round', label: 'Кружки', kinds: ['video_note'] },
];

const dateFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function groupByMonth(items) {
  const groups = [];
  for (const it of items) {
    const d = new Date(it.ts * 1000);
    const key = moscowDay(d).slice(0, 7);
    const title = d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', month: 'long', year: 'numeric' });
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(it);
    else groups.push({ key, title: title.charAt(0).toUpperCase() + title.slice(1), items: [it] });
  }
  return groups;
}

export default function MediaGallery({ items, loading, error, onClose, onShowInChat }) {
  const [tab, setTab] = useState('photo');
  const [open, setOpen] = useState(-1);
  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.id, (items ?? []).filter((it) => t.kinds.includes(it.kind)).length])),
    [items],
  );
  const shown = useMemo(() => (items ?? []).filter((it) => TABS.find((t) => t.id === tab).kinds.includes(it.kind)), [items, tab]);
  const current = open >= 0 ? shown[open] : null;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') (open >= 0 ? setOpen(-1) : onClose());
      if (open < 0) return;
      if (e.key === 'ArrowLeft') setOpen((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setOpen((i) => Math.min(shown.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, shown.length, onClose]);

  return createPortal(
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.panel} role="dialog" aria-label="Медиа переписки">
        <div className={s.head}>
          <h3 className={s.title}>Медиа</h3>
          <div className={s.tabs} role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`${s.tab} ${tab === t.id ? s.tabActive : ''}`}
                onClick={() => { setTab(t.id); setOpen(-1); }}
              >
                {t.label}
                <span className={s.count}>{counts[t.id] ?? 0}</span>
              </button>
            ))}
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className={s.body}>
          {loading && <p className={s.empty}>Загрузка…</p>}
          {error && <p className={s.error}>{error}</p>}
          {!loading && !error && !shown.length && <p className={s.empty}>Здесь пока пусто</p>}
          {groupByMonth(shown).map((g) => (
            <section key={g.key}>
              <h4 className={s.month}>{g.title}</h4>
              <div className={s.grid}>
                {g.items.map((it) => {
                  const index = shown.indexOf(it);
                  const src = withToken(it.url);
                  return (
                    <button
                      key={it.id}
                      type="button"
                      className={`${s.cell} ${it.kind === 'video_note' ? s.cellRound : ''}`}
                      onClick={() => setOpen(index)}
                      title={`${it.role === 'user' ? 'Собеседник' : 'Мы'} · ${timeFmt.format(new Date(it.ts * 1000))}`}
                    >
                      {it.kind === 'photo' ? (
                        <img src={src} alt="" loading="lazy" />
                      ) : (
                        <>
                          <video src={`${src}#t=0.1`} preload="metadata" muted playsInline />
                          <span className={s.play} aria-hidden="true">▶</span>
                        </>
                      )}
                      {it.role !== 'user' && <span className={s.ours}>мы</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      {current && (
        <div className={s.viewer} onMouseDown={(e) => e.target === e.currentTarget && setOpen(-1)}>
          <button type="button" className={`${s.nav} ${s.navPrev}`} disabled={open === 0} onClick={() => setOpen(open - 1)} aria-label="Предыдущее">‹</button>
          <figure className={s.figure}>
            {current.kind === 'photo' ? (
              <img className={s.full} src={withToken(current.url)} alt="" />
            ) : (
              <video
                key={current.id}
                className={`${s.full} ${current.kind === 'video_note' ? s.fullRound : ''}`}
                src={withToken(current.url)}
                controls
                autoPlay
                playsInline
                loop={current.kind === 'animation'}
                muted={current.kind === 'animation'}
              />
            )}
            <figcaption className={s.caption}>
              <span>
                {current.role === 'user' ? 'Собеседник' : 'Мы'} · {dateFmt.format(new Date(current.ts * 1000))}, {new Date(current.ts * 1000).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })}
                {current.caption ? ` — ${current.caption}` : ''}
              </span>
              <span className={s.captionActions}>
                <span className={s.counter}>{open + 1} / {shown.length}</span>
                <button type="button" className={s.toChat} onClick={() => { onShowInChat(current); onClose(); }}>
                  Показать в чате
                </button>
                <a className={s.toChat} href={withToken(current.url)} target="_blank" rel="noreferrer">Открыть файл</a>
              </span>
            </figcaption>
          </figure>
          <button type="button" className={`${s.nav} ${s.navNext}`} disabled={open === shown.length - 1} onClick={() => setOpen(open + 1)} aria-label="Следующее">›</button>
          <button type="button" className={s.viewerClose} onClick={() => setOpen(-1)} aria-label="Закрыть просмотр">✕</button>
        </div>
      )}
    </div>,
    document.body,
  );
}
