import { createContext, useContext } from 'react';

/** Каркас кладёт сюда вошедшего пользователя ({ id, username, role, … }). */
export const MeContext = createContext(null);

/** Текущий пользователь панели. Вне каркаса (тесты, отдельный рендер страницы) — null. */
export const useMe = () => useContext(MeContext);

/**
 * Показывать ли служебные колонки и поля, которые нужны только админу
 * («Менеджер», «Регион»): менеджер видит лишь свои диалоги, для него они
 * всегда одинаковые и только занимают место. Вне каркаса считаем, что да —
 * отдельно отрисованная таблица показывает всё.
 */
export function useIsAdmin() {
  const me = useMe();
  return !me || me.role === 'admin';
}
