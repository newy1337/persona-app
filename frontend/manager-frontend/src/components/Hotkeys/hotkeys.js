import { useEffect, useRef } from 'react';

// Горячие клавиши панели: одна буква без модификаторов. Пока человек печатает
// (поле ввода, textarea, селект, contenteditable) или открыт диалог, клавиши
// не срабатывают — буква уходит в поле, как обычно. Раскладка не важна:
// сравнивается физическая клавиша (e.code), «о» и «j» — одно и то же.

const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export function isTyping(target) {
  return Boolean(target?.closest?.(TYPING));
}

/** Код клавиши → короткое имя: KeyJ → j, Slash → /, Enter, Escape. */
export function keyName(e) {
  if (e.code?.startsWith('Key')) return e.code.slice(3).toLowerCase();
  if (e.code === 'Slash') return e.shiftKey ? '?' : '/';
  return e.key;
}

/**
 * Подписка на клавиши: map — { j: fn, k: fn, Enter: fn, '?': fn }. Escape
 * работает и из поля ввода (снимает фокус), остальные — только вне полей.
 */
export function useHotkeys(map, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const name = keyName(e);
      if (name === 'Escape' && isTyping(e.target)) return;
      if (name !== 'Escape' && isTyping(e.target)) return;
      if (e.shiftKey && name !== '?') return;
      const fn = ref.current[name];
      if (!fn) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Шпаргалка: какие клавиши где работают. */
export const HOTKEYS = [
  { where: 'Список диалогов', keys: [['J / K', 'вниз / вверх по строкам'], ['Enter', 'открыть чат'], ['W', 'следить в окне']] },
  { where: 'Чат', keys: [['J / K', 'следующий / предыдущий чат'], ['E', 'забрать у бота / отдать боту'], ['R', 'к полю ответа'], ['Esc', 'назад к диалогам']] },
  { where: 'Везде', keys: [['?', 'эта подсказка']] },
];
