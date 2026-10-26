import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Окна наблюдения: несколько диалогов поверх панели в виде «телефонов», чтобы
 * следить за перепиской, не открывая каждый чат. Окна живут в каркасе и
 * переживают переходы между страницами, а их набор и места — перезагрузку
 * (localStorage, только для этого пользователя и браузера).
 *
 * Окно: { chatId, name, avatar, account, x, y, z, minimized }. Сверху — окно с
 * большим z. Порядок массива при этом не меняется: перестановка узлов в DOM
 * сбросила бы прокрутку ленты и остановила видео в окне.
 */
export const ChatWatchContext = createContext(null);

/** Управление окнами наблюдения. Вне каркаса (тесты, отдельный рендер) — null. */
export const useChatWatch = () => useContext(ChatWatchContext);

export const WATCH_W = 320;
export const WATCH_H = 520;
export const MAX_WATCH = 6;
const GAP = 12;
const KEY = 'chat_watch_v1';

const topZ = (list) => list.reduce((max, w) => Math.max(max, w.z ?? 0), 0) + 1;

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((w) => w && w.chatId != null).slice(-MAX_WATCH) : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Приватный режим или нет места — окна просто не переживут перезагрузку.
  }
}

/** Окно целиком внутри экрана: за край не уезжает, шапка всегда доступна. */
export function clampWatch(x, y, view = { width: window.innerWidth, height: window.innerHeight }) {
  const w = Math.min(WATCH_W, view.width - 2 * GAP);
  const h = Math.min(WATCH_H, view.height - 2 * GAP);
  return {
    x: Math.round(Math.max(GAP, Math.min(x, view.width - w - GAP))),
    y: Math.round(Math.max(GAP, Math.min(y, view.height - h - GAP))),
  };
}

/** Место нового окна: справа налево у нижнего края, дальше — лесенкой. */
export function nextSlot(count, view = { width: window.innerWidth, height: window.innerHeight }) {
  const perRow = Math.max(1, Math.floor((view.width - GAP) / (WATCH_W + GAP)));
  const col = count % perRow;
  const shift = Math.floor(count / perRow) * 32;
  return clampWatch(view.width - (col + 1) * (WATCH_W + GAP) - shift, view.height - WATCH_H - GAP - shift, view);
}

/**
 * Место нового окна. Окна могли подвинуть, а самое старое — закрыть при
 * открытии седьмого, поэтому номер по счёту не годится: он ставил новое окно
 * прямо на последнее. Сначала ищем место, где рядом нет развёрнутого окна
 * ближе, чем на полокна. Такого нет (на 1920px в ряд встаёт пять окон) —
 * берём первое, где окно хотя бы не ляжет точно поверх другого: шапки видны.
 */
export function freeSlot(list, view = { width: window.innerWidth, height: window.innerHeight }) {
  const shown = list.filter((w) => !w.minimized);
  const first = (near) => {
    for (let i = 0; i < MAX_WATCH * 2; i += 1) {
      const slot = nextSlot(i, view);
      if (!shown.some((w) => Math.abs(w.x - slot.x) < near.x && Math.abs(w.y - slot.y) < near.y)) return slot;
    }
    return null;
  };
  return first({ x: WATCH_W / 2, y: WATCH_H / 2 }) ?? first({ x: 16, y: 16 }) ?? nextSlot(shown.length, view);
}

/**
 * Развернуть окно поверх остальных. Пока оно было свёрнуто, его место могло
 * занять новое окно — тогда разворачиваемое переезжает на свободное, а не
 * ложится сверху.
 */
export function restoreWatch(list, chatId, patch = {}, view = { width: window.innerWidth, height: window.innerHeight }) {
  const found = list.find((w) => w.chatId === chatId);
  if (!found) return list;
  const others = list.filter((w) => w !== found);
  const blocked = found.minimized && others.some((w) => !w.minimized && Math.abs(w.x - found.x) < WATCH_W / 2 && Math.abs(w.y - found.y) < WATCH_H / 2);
  const place = blocked ? freeSlot(others, view) : {};
  return list.map((w) => (w === found ? { ...w, ...patch, ...place, z: topZ(list), minimized: false } : w));
}

export function useChatWatchState() {
  const [windows, setWindows] = useState(load);

  useEffect(() => save(windows), [windows]);

  // Окно браузера сузили — окна подтягиваются внутрь.
  useEffect(() => {
    const onResize = () =>
      setWindows((list) => list.map((w) => ({ ...w, ...clampWatch(w.x, w.y) })));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const open = useCallback((chat) => {
    setWindows((list) => {
      const found = list.find((w) => w.chatId === chat.chatId);
      if (found) return restoreWatch(list, chat.chatId, chat);
      // Больше MAX_WATCH не держим: уходит самое старое окно.
      const kept = list.slice(-(MAX_WATCH - 1));
      const slot = freeSlot(kept);
      return [...kept, { ...chat, ...slot, z: topZ(list), minimized: false }];
    });
  }, []);

  const update = useCallback((chatId, patch) => {
    setWindows((list) => list.map((w) => (w.chatId === chatId ? { ...w, ...patch } : w)));
  }, []);

  const restore = useCallback((chatId) => {
    setWindows((list) => restoreWatch(list, chatId));
  }, []);

  const focus = useCallback((chatId) => {
    setWindows((list) => {
      const found = list.find((w) => w.chatId === chatId);
      const z = topZ(list);
      if (!found || (found.z ?? 0) === z - 1) return list;
      return list.map((w) => (w === found ? { ...w, z } : w));
    });
  }, []);

  const close = useCallback((chatId) => {
    setWindows((list) => list.filter((w) => w.chatId !== chatId));
  }, []);

  const isOpen = useCallback((chatId) => windows.some((w) => w.chatId === chatId), [windows]);

  return useMemo(
    () => ({ windows, open, update, restore, focus, close, isOpen }),
    [windows, open, update, restore, focus, close, isOpen],
  );
}
