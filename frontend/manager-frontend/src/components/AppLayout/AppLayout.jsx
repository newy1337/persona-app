import { Suspense, useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useMatch } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import Header from '../Header/Header';
import ErrorBoundary from './ErrorBoundary';
import { HeaderToolsContext } from './headerTools';
import { RouteBusyContext, useRouteBusy } from './routeBusy';
import { MeContext } from './me';
import ChatWatchLayer from '../ChatWatch/ChatWatchLayer';
import HotkeysHelp from '../Hotkeys/HotkeysHelp';
import { ChatWatchContext, useChatWatchState } from '../ChatWatch/chatWatch';

/** Пока грузится код страницы: шапка на месте, под ней — каркас контента. */
function PageFallback() {
  useRouteBusy(true);
  return (
    <div className="container pt-5" role="status" aria-busy="true">
      <span className="sr-only">Загружаем…</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-6 h-14 w-full rounded-lg" />
      <Skeleton className="mt-3 h-64 w-full rounded-lg" />
    </div>
  );
}

/**
 * Каркас панели: шапка монтируется один раз, при переходах меняется только
 * содержимое <main>. Страницы возвращают свой контент без .app / Header / main.
 * Переписка занимает ровно экран (лента прокручивается внутри), остальные
 * страницы растут по содержимому. Ошибка страницы не гасит шапку, а переход
 * на другую страницу сбрасывает экран ошибки.
 */
export default function AppLayout({ me }) {
  const [waiting, setWaiting] = useState(0);
  const [tools, setTools] = useState(null);
  const { pathname } = useLocation();
  const hold = useCallback(() => {
    let held = true;
    setWaiting((n) => n + 1);
    return () => {
      if (!held) return;
      held = false;
      setWaiting((n) => n - 1);
    };
  }, []);
  const fixed = Boolean(useMatch('/conversation/:id'));
  const watch = useChatWatchState();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <MeContext.Provider value={me}>
      <HeaderToolsContext.Provider value={{ tools, setTools }}>
        <RouteBusyContext.Provider value={hold}>
          <ChatWatchContext.Provider value={watch}>
          <div className={cn('app', fixed && 'h-dvh overflow-hidden')}>
            <Header me={me} busy={waiting > 0} {...(tools ?? {})} />
            <main className={cn('main', fixed && 'min-h-0')}>
              <ErrorBoundary key={pathname}>
                <Suspense fallback={<PageFallback />}>
                  <Outlet />
                </Suspense>
              </ErrorBoundary>
            </main>
          </div>
          {/* Окна наблюдения — поверх любой страницы и переживают переходы. */}
          <ChatWatchLayer />
          <HotkeysHelp />
          </ChatWatchContext.Provider>
        </RouteBusyContext.Provider>
      </HeaderToolsContext.Provider>
    </MeContext.Provider>
  );
}
