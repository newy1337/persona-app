import { useCallback, useMemo, useSyncExternalStore } from 'react';

// Настройка полей таблицы. Колонка описана в COLUMNS своей сетки:
//   required — скрыть нельзя (сущность, чекбокс / раскрытие, действия);
//   show     — видимость по умолчанию: true (если не задано), false или
//              'wide' — только на широком экране (медиа-запрос сетки);
//   width    — ширина в px; колонка без ширины гибкая и забирает остаток.
// Выбор пользователя лежит в localStorage: panel_columns_<tableId> — карта
// «ключ -> true | false». Нет записи — действует умолчание; явное true
// показывает и «широкую» колонку на любом экране.
const PREFIX = 'panel_columns_';
const EMPTY = Object.freeze({});
const stores = new Map();

function storage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(key) {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function parse(raw) {
  if (!raw) return EMPTY;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY;
    const entries = Object.entries(value).filter(([, on]) => typeof on === 'boolean');
    return entries.length ? Object.fromEntries(entries) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function storeOf(tableId) {
  let store = stores.get(tableId);
  if (!store) {
    store = { key: `${PREFIX}${tableId}`, raw: undefined, value: EMPTY, listeners: new Set() };
    stores.set(tableId, store);
  }
  return store;
}

// Снимок привязан к строке из хранилища: поменялась строка (другая вкладка,
// очистка) — разбираем заново, иначе отдаём тот же объект.
function snapshot(tableId) {
  const store = storeOf(tableId);
  const raw = readRaw(store.key);
  if (raw !== store.raw) {
    store.raw = raw;
    store.value = parse(raw);
  }
  return store.value;
}

function write(tableId, value) {
  const store = storeOf(tableId);
  try {
    if (Object.keys(value).length) storage()?.setItem(store.key, JSON.stringify(value));
    else storage()?.removeItem(store.key);
  } catch {
    // Хранилище недоступно или переполнено: выбор живёт до перезагрузки.
  }
  store.raw = readRaw(store.key);
  store.value = value;
  for (const listener of store.listeners) listener();
}

function subscribe(tableId, listener) {
  const store = storeOf(tableId);
  store.listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    store.listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

const media = (query) =>
  query && typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;

/** Совпал ли медиа-запрос. Там, где matchMedia нет, экран считается широким. */
function useMedia(query) {
  return useSyncExternalStore(
    useCallback(
      (listener) => {
        const list = media(query);
        list?.addEventListener?.('change', listener);
        return () => list?.removeEventListener?.('change', listener);
      },
      [query],
    ),
    () => media(query)?.matches ?? true,
  );
}

const known = (columns, stored) => {
  const prefs = {};
  for (const col of columns) {
    if (!col.required && typeof stored[col.key] === 'boolean') prefs[col.key] = stored[col.key];
  }
  return prefs;
};

/**
 * Видимые колонки таблицы и управление ими.
 *   columns  — видимые колонки в исходном порядке; auto: true у «широкой»
 *              колонки, показанной по умолчанию (в минимальную ширину не входит);
 *   has(key) — видна ли колонка;
 *   options  — скрываемые колонки для ColumnPicker: { key, label, checked };
 *   toggle(key), reset(), isDefault.
 * Все экземпляры одной таблицы (сетка и её заглушка) видят один выбор.
 */
export function useColumnPrefs(tableId, columns, { wide } = {}) {
  const stored = useSyncExternalStore(
    useCallback((listener) => subscribe(tableId, listener), [tableId]),
    () => snapshot(tableId),
  );
  const isWide = useMedia(wide);

  return useMemo(() => {
    const prefs = known(columns, stored);
    const shown = (col) => {
      if (col.required) return true;
      if (col.key in prefs) return prefs[col.key];
      return col.show === 'wide' ? isWide : col.show !== false;
    };
    const visible = columns
      .filter(shown)
      .map((col) => ({ ...col, auto: !col.required && col.show === 'wide' && !(col.key in prefs) }));
    const keys = new Set(visible.map((col) => col.key));

    return {
      columns: visible,
      has: (key) => keys.has(key),
      options: columns
        .filter((col) => !col.required)
        .map((col) => ({ key: col.key, label: col.label, checked: keys.has(col.key) })),
      isDefault: Object.keys(prefs).length === 0,
      toggle(key) {
        const col = columns.find((c) => c.key === key);
        if (!col || col.required) return;
        const next = known(columns, snapshot(tableId));
        const on = !keys.has(key);
        // Вернулись к умолчанию — запись не нужна. У «широкой» колонки
        // умолчание зависит от экрана, поэтому её выбор всегда явный.
        if (col.show !== 'wide' && on === (col.show !== false)) delete next[key];
        else next[key] = on;
        write(tableId, next);
      },
      reset: () => write(tableId, EMPTY),
    };
  }, [tableId, columns, stored, isWide]);
}

/**
 * Минимальная ширина таблицы по видимым колонкам: сумма фиксированных ширин
 * плюс минимум гибкой колонки, если она видна. «Широкие» колонки, показанные
 * по умолчанию, не считаются: они появляются там, где место уже есть.
 */
export function tableMinWidth(visible, flexMin = 0) {
  return visible.reduce((sum, col) => sum + (col.auto ? 0 : (col.width ?? flexMin)), 0);
}
