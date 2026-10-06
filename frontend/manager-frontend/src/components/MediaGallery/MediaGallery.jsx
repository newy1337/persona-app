import { moscowDay } from '../../utils/panelTime';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { withToken } from '../../utils/chat';

const TABS = [
  { id: 'photo', label: 'Фото', kinds: ['photo'] },
  { id: 'video', label: 'Видео', kinds: ['video', 'animation'] },
  { id: 'round', label: 'Кружки', kinds: ['video_note'] },
];

const dateFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Сетка и заголовок месяца общие для данных и скелетона — высоты совпадают
// по построению.
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-1';
const MONTH = 'bg-background sticky top-0 z-10 m-0 px-1 pt-2.5 pb-2 text-xs font-semibold';
const SKELETON_CELLS = Array.from({ length: 9 }, (_, i) => i);

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
  const viewerRef = useRef(null);
  const returnFocusRef = useRef(null);
  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.id, (items ?? []).filter((it) => t.kinds.includes(it.kind)).length])),
    [items],
  );
  const shown = useMemo(() => (items ?? []).filter((it) => TABS.find((t) => t.id === tab).kinds.includes(it.kind)), [items, tab]);
  const current = open >= 0 ? shown[open] : null;
  const viewing = Boolean(current);
  // Скелетон — только на первой загрузке; при повторной прежняя сетка остаётся.
  const firstLoad = loading && !(items ?? []).length;

  // Блокировка прокрутки Radix добавляет body отступ на ширину полосы, а место
  // под полосу уже зарезервировано (html: scrollbar-gutter: stable) — без
  // сброса страница под шторкой сдвигается.
  useLayoutEffect(() => {
    const { style } = document.body;
    const value = style.getPropertyValue('margin-right');
    const priority = style.getPropertyPriority('margin-right');
    style.setProperty('margin-right', '0px', 'important');
    return () => {
      if (value) style.setProperty('margin-right', value, priority);
      else style.removeProperty('margin-right');
    };
  }, []);

  useEffect(() => {
    if (open < 0) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') setOpen((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setOpen((i) => Math.min(shown.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, shown.length]);

  useEffect(() => {
    if (!viewing) return undefined;
    const back = returnFocusRef.current;
    viewerRef.current?.focus();
    return () => back?.focus?.();
  }, [viewing]);

  const openViewer = (index, e) => {
    returnFocusRef.current = e.currentTarget;
    setOpen(index);
  };
  const closeOnBackdrop = (e) => {
    if (e.target.dataset.backdrop !== undefined) setOpen(-1);
  };

  return (
    <Sheet open onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent
        side="right"
        aria-label="Медиа переписки"
        aria-labelledby={undefined}
        aria-describedby={undefined}
        className="w-full gap-0 sm:max-w-[560px] [&>button]:hidden"
        onEscapeKeyDown={(e) => {
          // Escape сначала закрывает просмотр, и только потом шторку.
          if (open >= 0) {
            e.preventDefault();
            setOpen(-1);
          }
        }}
      >
        <Tabs
          value={tab}
          onValueChange={(next) => { setTab(next); setOpen(-1); }}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b px-4 pt-[calc(14px+env(safe-area-inset-top,0px))] pb-3">
            <SheetTitle className="m-0 text-base">Медиа</SheetTitle>
            <div className="min-w-0 flex-1">
              <TabsList>
                {TABS.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="px-2.5">
                    {t.label}
                    <Badge variant="outline" className="min-w-6 px-1.5 font-mono tabular-nums">{counts[t.id] ?? 0}</Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
              <X aria-hidden="true" />
            </Button>
          </div>

          <TabsContent value={tab} className="min-h-0 overflow-y-auto px-3 pt-1 pb-6 [scrollbar-gutter:stable]">
            {firstLoad && (
              <section aria-busy="true">
                <span className="sr-only">Загрузка…</span>
                <div className={MONTH}><Skeleton className="h-4 w-28" /></div>
                <div className={GRID}>
                  {SKELETON_CELLS.map((i) => <Skeleton key={i} className="aspect-square w-full" />)}
                </div>
              </section>
            )}
            {error && <p className="text-destructive my-10 text-center text-sm">{error}</p>}
            {!loading && !error && !shown.length && (
              <p className="text-muted-foreground my-10 text-center text-sm">Здесь пока пусто</p>
            )}
            {groupByMonth(shown).map((g) => (
              <section key={g.key}>
                <h4 className={cn(MONTH, 'text-muted-foreground')}>{g.title}</h4>
                <div className={GRID}>
                  {g.items.map((it) => {
                    const index = shown.indexOf(it);
                    const src = withToken(it.url);
                    return (
                      <Button
                        key={it.id}
                        type="button"
                        variant="ghost"
                        className={cn(
                          'group/cell bg-muted hover:bg-muted dark:hover:bg-muted relative aspect-square h-auto w-full overflow-hidden p-0',
                          it.kind === 'video_note' && 'rounded-full',
                        )}
                        onClick={(e) => openViewer(index, e)}
                        title={`${it.role === 'user' ? 'Собеседник' : 'Мы'} · ${timeFmt.format(new Date(it.ts * 1000))}`}
                      >
                        {it.kind === 'photo' ? (
                          <img
                            className="block size-full object-cover transition-transform duration-150 group-hover/cell:scale-105"
                            src={src}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <>
                            <video
                              className="block size-full object-cover transition-transform duration-150 group-hover/cell:scale-105"
                              src={`${src}#t=0.1`}
                              preload="metadata"
                              muted
                              playsInline
                            />
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
                              <span className="bg-background/70 text-foreground flex size-9 items-center justify-center rounded-full">
                                <Play className="size-4 fill-current" />
                              </span>
                            </span>
                          </>
                        )}
                        {it.role !== 'user' && (
                          <Badge
                            className={cn(
                              'absolute bottom-1.5 rounded-full px-1.5 py-0',
                              it.kind === 'video_note' ? 'left-1/2 -translate-x-1/2' : 'left-1.5',
                            )}
                          >
                            мы
                          </Badge>
                        )}
                      </Button>
                    );
                  })}
                </div>
              </section>
            ))}
          </TabsContent>
        </Tabs>

        {current && (
          <div
            ref={viewerRef}
            tabIndex={-1}
            data-backdrop=""
            className="bg-background/95 fixed inset-0 z-[60] flex items-center justify-center px-2 pt-14 pb-4 outline-none sm:px-16"
            onMouseDown={closeOnBackdrop}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1/2 left-2.5 z-10 -translate-y-1/2"
              disabled={open === 0}
              onClick={() => setOpen(open - 1)}
              aria-label="Предыдущее"
            >
              <ChevronLeft aria-hidden="true" className="size-6" />
            </Button>
            <figure data-backdrop="" className="m-0 flex size-full max-w-5xl flex-col items-center gap-3">
              {/* Сцена фиксированной высоты: подпись и кнопки не прыгают при листании. */}
              <div data-backdrop="" className="flex min-h-0 w-full flex-1 items-center justify-center">
                {current.kind === 'photo' ? (
                  <img className="bg-muted max-h-full max-w-full rounded-lg object-contain" src={withToken(current.url)} alt="" />
                ) : (
                  <video
                    key={current.id}
                    className={cn(
                      'bg-muted max-h-full max-w-full',
                      current.kind === 'video_note'
                        ? 'aspect-square w-[min(420px,90vw)] rounded-full object-cover'
                        : 'rounded-lg object-contain',
                    )}
                    src={withToken(current.url)}
                    controls
                    autoPlay
                    playsInline
                    loop={current.kind === 'animation'}
                    muted={current.kind === 'animation'}
                  />
                )}
              </div>
              <figcaption className="text-muted-foreground flex min-h-8 w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
                <span>
                  {current.role === 'user' ? 'Собеседник' : 'Мы'} · {dateFmt.format(new Date(current.ts * 1000))}, {new Date(current.ts * 1000).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })}
                  {current.caption ? ` — ${current.caption}` : ''}
                </span>
                <span className="flex items-center gap-2">
                  <span className="min-w-12 text-right font-mono text-xs tabular-nums">{open + 1} / {shown.length}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => { onShowInChat(current); onClose(); }}>
                    Показать в чате
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href={withToken(current.url)} target="_blank" rel="noreferrer">Открыть файл</a>
                  </Button>
                </span>
              </figcaption>
            </figure>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-2.5 z-10 -translate-y-1/2"
              disabled={open === shown.length - 1}
              onClick={() => setOpen(open + 1)}
              aria-label="Следующее"
            >
              <ChevronRight aria-hidden="true" className="size-6" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-[calc(12px+env(safe-area-inset-top,0px))] right-3 z-10"
              onClick={() => setOpen(-1)}
              aria-label="Закрыть просмотр"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
