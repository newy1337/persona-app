import { useEffect, useState } from 'react';

// Вид списка «Диалоги» (поиск, фильтры, страница) переживает заход в чат: живёт
// в sessionStorage вкладки. Без хранилища (приватное окно) — обычное состояние.

const PREFIX = 'dialogs.view.';
const ANCHOR_KEY = 'dialogs.anchor';

function read(key, fallback) {
  try {
    const raw = globalThis.sessionStorage?.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    globalThis.sessionStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // без хранилища вид просто сбросится при возврате
  }
}

/** useState, который помнит значение до закрытия вкладки. */
export function useViewState(name, initial) {
  const [value, setValue] = useState(() => read(PREFIX + name, initial));
  useEffect(() => {
    write(PREFIX + name, value);
  }, [name, value]);
  return [value, setValue];
}

/** Открыли чат: при возврате в «Диалоги» список встанет на него. */
export function rememberDialog(chatId) {
  if (chatId != null && chatId !== '') write(ANCHOR_KEY, String(chatId));
}

/** Чат, к которому вернуть список, — один раз: потом якорь стирается. */
export function takeDialogAnchor() {
  const id = read(ANCHOR_KEY, null);
  try {
    globalThis.sessionStorage?.removeItem(ANCHOR_KEY);
  } catch {
    // нечего стирать
  }
  return id;
}

export function peekDialogAnchor() {
  return read(ANCHOR_KEY, null);
}
