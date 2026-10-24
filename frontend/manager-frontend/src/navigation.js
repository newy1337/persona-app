/**
 * Меню панели по ролям — один источник для шапки, подвкладок «Настроек» и
 * маршрутов. Страница, которой нет в меню роли, для неё не открывается.
 *
 * Пункт: { key, label, to } — key же ключ страницы в App (что рендерить).
 */

/** Подвкладки «Настроек»: адрес — /settings/<path>. */
const SETTINGS = {
  accounts: { path: 'accounts', label: 'Аккаунты' },
  personas: { path: 'personas', label: 'Личности' },
  photoSets: { path: 'photo-sets', label: 'Образы' },
  leadget: { path: 'leadget', label: 'LeadGet' },
  catalogs: { path: 'catalogs', label: 'Справочники' },
  buffer: { path: 'buffer', label: 'Буфер' },
  team: { path: 'team', label: 'Команда' },
  // Прежняя страница «Настройки»: бот, стоп-фразы, API-ключи.
  general: { path: 'general', label: 'Бот и API' },
};

const settingsTabs = (...keys) => keys.map((key) => ({ key, ...SETTINGS[key], to: `/settings/${SETTINGS[key].path}` }));

const TOP = {
  dialogs: { label: 'Диалоги', to: '/', end: true },
  leads: { label: 'Лиды', to: '/leads' },
  voice: { label: 'Войсер', to: '/voice' },
  accounts: { label: 'Аккаунты', to: '/accounts' },
  photoSets: { label: 'Образы', to: '/photo-sets' },
  managers: { label: 'Менеджеры', to: '/managers' },
  stats: { label: 'Статистика', to: '/stats' },
  settings: { label: 'Настройки', to: '/settings' },
};

const topNav = (...keys) => keys.map((key) => ({ key, ...TOP[key] }));

const MENU = {
  admin: {
    top: topNav('dialogs', 'leads', 'voice', 'accounts', 'managers', 'stats', 'settings'),
    settings: settingsTabs('accounts', 'personas', 'photoSets', 'leadget', 'catalogs', 'buffer', 'general'),
  },
  // Статистика хеду пока не отдаётся бэкендом (только админу) — вкладки нет.
  head: {
    top: topNav('dialogs', 'leads', 'voice', 'settings'),
    settings: settingsTabs('team', 'buffer', 'photoSets', 'accounts'),
  },
  teamlead: {
    top: topNav('dialogs', 'leads', 'voice', 'settings'),
    settings: settingsTabs('buffer', 'photoSets', 'accounts'),
  },
  manager: {
    top: topNav('dialogs', 'leads', 'voice', 'accounts', 'photoSets'),
    settings: [],
  },
  voice: {
    top: topNav('voice'),
    settings: [],
  },
};

export function menuFor(role) {
  return MENU[role] ?? { top: [], settings: [] };
}

/** Есть ли у роли пункт верхнего меню. */
export const hasTop = (role, key) => menuFor(role).top.some((item) => item.key === key);

/** Есть ли у роли подвкладка «Настроек». */
export const hasSetting = (role, key) => menuFor(role).settings.some((item) => item.key === key);

/** Адрес подвкладки «Настроек» по ключу. */
export const settingsPath = (key) => `/settings/${SETTINGS[key].path}`;

export { SETTINGS };
