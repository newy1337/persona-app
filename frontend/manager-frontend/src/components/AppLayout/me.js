import { createContext, useContext } from 'react';

/**
 * Текущий пользователь. Его один раз загружает App и раздаёт всем через
 * контекст: раньше каждая страница и шапка запрашивали /auth/me сами, и
 * шапка перерисовывалась при каждом переходе.
 */
export const MeContext = createContext(null);

export const useMe = () => useContext(MeContext);

export const useIsAdmin = () => useMe()?.role === 'admin';
