import { createContext, useContext, useEffect } from 'react';

/**
 * Инструменты шапки (поиск, фильтры, счётчик «LIVE»), которые страница диалогов
 * отдаёт общей шапке. Шапка смонтирована один раз в каркасе, поэтому страница
 * не передаёт ей пропсы, а публикует их через контекст.
 */
export const HeaderToolsContext = createContext({ tools: null, setTools: () => {} });

export const useHeaderTools = () => useContext(HeaderToolsContext).tools;

/** Страница публикует инструменты, пока смонтирована; при уходе снимает их. */
export function usePublishHeaderTools(tools) {
  const { setTools } = useContext(HeaderToolsContext);
  const { liveCount, query, onQueryChange, filters, onFiltersChange, accountsKey, accounts } = tools;
  useEffect(() => {
    setTools({ liveCount, query, onQueryChange, filters, onFiltersChange, accounts });
    // accounts сравниваем по ключу, чтобы новый массив с тем же содержимым не дёргал шапку
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTools, liveCount, query, onQueryChange, filters, onFiltersChange, accountsKey]);
  useEffect(() => () => setTools(null), [setTools]);
}
