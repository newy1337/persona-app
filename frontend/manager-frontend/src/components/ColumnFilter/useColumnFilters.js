import { useCallback, useState } from 'react';
import { isActive } from './filters';

const storageKey = (tableId) => `panel_filters_${tableId}`;

function read(tableId) {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(storageKey(tableId)) || 'null');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function write(tableId, state) {
  try {
    window.sessionStorage.setItem(storageKey(tableId), JSON.stringify(state));
  } catch {
    // хранилище недоступно — фильтры живут до ухода со страницы
  }
}

/**
 * Состояние фильтров колонок одной таблицы: { ключ колонки: значение }.
 * Хранится в sessionStorage — открыл диалог, вернулся к списку, фильтры на
 * месте; в новой вкладке список начинается без них.
 */
export function useColumnFilters(tableId) {
  const [state, setState] = useState(() => read(tableId));

  const setFilter = useCallback(
    (key, value) =>
      setState((prev) => {
        const next = { ...prev };
        if (isActive(value)) next[key] = value;
        else delete next[key];
        write(tableId, next);
        return next;
      }),
    [tableId],
  );

  const reset = useCallback(() => {
    write(tableId, {});
    setState({});
  }, [tableId]);

  // Заменить фильтры целиком — так применяется сохранённый набор.
  const replace = useCallback(
    (next) => {
      const clean = Object.fromEntries(Object.entries(next ?? {}).filter(([, v]) => isActive(v)));
      write(tableId, clean);
      setState(clean);
    },
    [tableId],
  );

  return [state, setFilter, reset, replace];
}
