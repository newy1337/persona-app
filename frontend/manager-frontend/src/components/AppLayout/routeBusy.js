import { createContext, useContext, useEffect } from 'react';

/** Каркас кладёт сюда функцию «я занят»; она возвращает функцию «освободился». */
export const RouteBusyContext = createContext(null);

/**
 * Страница сообщает каркасу, что ждёт данные: под шапкой бежит полоса загрузки.
 * Вне каркаса (тесты, отдельный рендер страницы) ничего не делает.
 */
export function useRouteBusy(busy) {
  const hold = useContext(RouteBusyContext);
  useEffect(() => {
    if (!hold || !busy) return undefined;
    return hold();
  }, [hold, busy]);
}
