/** Ссылка, которую можно класть в href: только http(s). Остальное (javascript:, data:) — нет. */
export function httpHref(value) {
  const url = String(value ?? '').trim();
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
}
