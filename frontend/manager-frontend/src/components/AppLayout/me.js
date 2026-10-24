import { createContext, useContext } from 'react';

/**
 * Текущий пользователь ({ id, username, role, region_code, … }). Его один раз
 * загружает App, а каркас раздаёт всем через контекст: страницы и шапка не
 * запрашивают /auth/me сами.
 */
export const MeContext = createContext(null);

/** Текущий пользователь панели. Вне каркаса (тесты, отдельный рендер страницы) — null. */
export const useMe = () => useContext(MeContext);

/**
 * Админ ли смотрит. Вне каркаса считаем, что да — отдельно отрисованная
 * таблица показывает всё (так её проверяют тесты).
 */
export function useIsAdmin() {
  const me = useMe();
  return !me || me.role === 'admin';
}
