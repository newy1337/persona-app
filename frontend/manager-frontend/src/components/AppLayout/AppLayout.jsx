import { Suspense, useCallback, useState } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import Header from '../Header/Header';
import { RouteBusyContext, useRouteBusy } from './routeBusy';
import { MeContext } from './me';

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
 * страницы растут по содержимому.
 */
export default function AppLayout({ me }) {
  const [waiting, setWaiting] = useState(0);
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

  return (
    <MeContext.Provider value={me}>
    <RouteBusyContext.Provider value={hold}>
      <div className={cn('app', fixed && 'h-dvh overflow-hidden')}>
        <Header me={me} busy={waiting > 0} />
        <main className={cn('main', fixed && 'min-h-0')}>
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </RouteBusyContext.Provider>
    </MeContext.Provider>
  );
}
