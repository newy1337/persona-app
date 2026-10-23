import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation, useMatch } from 'react-router-dom';
import Header from '../Header/Header';
import ErrorBoundary from './ErrorBoundary';
import { HeaderToolsContext } from './headerTools';
import styles from './AppLayout.module.scss';

/**
 * Каркас панели: шапка монтируется один раз и не перерисовывается при переходах,
 * страницы рендерят только своё содержимое. Пока ленивая страница грузится,
 * под шапкой идёт полоса, а место под контент не схлопывается.
 */
export default function AppLayout() {
  const [tools, setTools] = useState(null);
  const { pathname } = useLocation();
  // Переписка — экран на всю высоту со своим подзаголовком, общий контейнер ей не нужен.
  const bare = Boolean(useMatch('/conversation/:id'));

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <HeaderToolsContext.Provider value={{ tools, setTools }}>
      <div className={`app ${bare ? styles.bare : ''}`}>
        <Header {...(tools ?? {})} />
        {/* key по пути: переход на другую страницу сбрасывает экран ошибки */}
        <ErrorBoundary key={pathname}>
          <Suspense fallback={<RouteLoading />}>
            {bare ? (
              <Outlet />
            ) : (
              <main className="main">
                <div className="container">
                  <Outlet />
                </div>
              </main>
            )}
          </Suspense>
        </ErrorBoundary>
      </div>
    </HeaderToolsContext.Provider>
  );
}

function RouteLoading() {
  return (
    <main className="main" aria-busy="true">
      <div className={styles.progress} role="progressbar" aria-label="Загружаем страницу" />
      <div className="container">
        <p className={styles.loading} role="status">Загружаем…</p>
      </div>
    </main>
  );
}
