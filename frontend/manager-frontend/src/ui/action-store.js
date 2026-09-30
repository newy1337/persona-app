export function actionLabels(method, url) {
  if (!url.startsWith('/api/') || /\/tg-accounts\/auth\//.test(url)) return null;
  if (/\/tg-accounts\/\d+\/auth$/.test(url)) return ['Подключаем…', 'Код входа запрошен'];
  if (method === 'post' && url === '/api/voicer/tasks') return ['Создаём задание…', 'Задание добавлено в очередь'];
  if (/^\/api\/voicer\/notices\/\d+\/read$/.test(url)) return null;
  if (/^\/api\/voicer\/(recordings\/\d+\/send|deliveries\/\d+\/retry)$/.test(url)) return ['Добавляем в очередь…', 'Принято в очередь отправки'];
  if (/^\/api\/voicer\/users\/\d+\/link$/.test(url)) return ['Готовим ссылку…', 'Ссылка создана'];
  if (method === 'delete') return /\/stats\/prices/.test(url) ? ['Восстанавливаем…', 'Цены восстановлены'] : ['Удаляем…', 'Удалено'];
  if (/\/managers\/\d+\/password$/.test(url)) return ['Создаём пароль…', 'Новый пароль создан'];
  if (/\/managers$/.test(url)) return ['Создаём…', 'Учётка создана'];
  if (/\/leads\/start$/.test(url)) return ['Добавляем в очередь…', 'Очередь обновлена'];
  if (/\/leads\/stop$/.test(url)) return ['Снимаем с очереди…', 'Очередь обновлена'];
  if (/\/pause$/.test(url)) return ['Приостанавливаем…', 'Бот на паузе'];
  if (/\/resume$/.test(url)) return ['Возобновляем…', 'Бот включён'];
  if (/\/import$/.test(url)) return ['Импортируем…', 'Импорт завершён'];
  if (/\/restore$/.test(url)) return ['Восстанавливаем…', 'Версия восстановлена'];
  if (/\/hide$/.test(url)) return ['Переносим…', 'Диалог в архиве'];
  if (/\/unhide$/.test(url)) return ['Возвращаем…', 'Диалог возвращён'];
  if (/\/clear-flood$/.test(url)) return ['Снимаем ограничение…', 'Метка ограничения снята'];
  if (method === 'post' && /\/(message|messages|attachment|reply|send|album|media|approve)(\/|$)/.test(url)) return ['Отправляем…', 'Отправлено'];
  return ['Сохраняем…', 'Сохранено'];
}

export function readableError(error) {
  if (error?.status === 401) return 'Сессия истекла. Войдите в панель заново.';
  if (error?.status === 403) return 'Для этого действия недостаточно прав.';
  if (error?.status >= 500) return 'Сервер не смог выполнить действие. Попробуйте ещё раз.';
  const raw = error?.detail || error?.message;
  const text = Array.isArray(raw) ? raw.join('. ') : String(raw || '');
  if (!text || /Failed to fetch|NetworkError|Load failed|network request|fetch failed/i.test(text)) return 'Нет связи с сервером. Проверьте подключение и повторите действие.';
  return text;
}

export function createActionStore(api, schedule = setTimeout) {
  let state = { notices: [], pending: [] };
  let sequence = 0;
  const listeners = new Set(), requests = new Map();
  const emit = () => { for (const listener of listeners) listener(); };
  const dismiss = id => { state = { ...state, notices: state.notices.filter(item => item.id !== id) }; emit(); };
  function run(key, labels, task, signature) {
    const previous = requests.get(key);
    if (previous && signature !== undefined && previous.signature === signature) return previous.promise;
    const id = ++sequence;
    state = { notices: [...state.notices.filter(item => item.status === 'pending').slice(-2), { id, status: 'pending', text: labels[0] }], pending: [...new Set([...state.pending, key])] };
    emit();
    const promise = (previous ? previous.promise.catch(() => {}) : Promise.resolve()).then(task).then(result => {
      state = { ...state, notices: state.notices.map(item => item.id === id ? { id, status: 'success', text: result?.pending_reply_id ? 'Принято в очередь отправки' : result?.voice_request_id ? 'Запрос озвучки создан' : labels[1] } : item) };
      schedule(() => dismiss(id), 7000);
      return result;
    }, error => {
      const message = readableError(error);
      state = { ...state, notices: [...state.notices.filter(item => item.id !== id), { id, status: 'error', text: message }] };
      schedule(() => dismiss(id), 7000);
      if (error && typeof error === 'object') error.detail = message;
      throw error;
    }).finally(() => {
      if (requests.get(key)?.promise === promise) requests.delete(key);
      state = { ...state, pending: [...requests.keys()] };
      emit();
    });
    requests.set(key, { promise, signature });
    return promise;
  }
  for (const method of ['post', 'put', 'delete']) {
    if (typeof api[method] !== 'function') continue;
    const original = api[method].bind(api);
    api[method] = (url, ...args) => {
      const labels = actionLabels(method, url);
      return labels ? run(`${method}:${url}`, labels, () => original(url, ...args), JSON.stringify(args)) : original(url, ...args);
    };
  }
  return { run, dismiss, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => state };
}
