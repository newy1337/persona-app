// Куки VK для входа без пароля: выгрузка расширения (Cookie-Editor, EditThisCookie — JSON-массив
// `[{name, value, domain, path}]`) или строка заголовка `Cookie:` из DevTools (`a=1; b=2`).
// Сессию держит `remixsid`: без него бэк вход не примет — говорим об этом до отправки.

export function parseVkCookies(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, error: 'вставьте куки vk.ru' };
  let cookies;
  if (text.startsWith('[') || text.startsWith('{')) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: 'не JSON — вставьте выгрузку целиком' };
    }
    const list = Array.isArray(data) ? data : Array.isArray(data?.cookies) ? data.cookies : [];
    cookies = list
      .filter((c) => c && c.name && c.value !== undefined)
      .map((c) => ({ name: String(c.name), value: String(c.value), domain: String(c.domain || '.vk.ru'), path: c.path || '/' }));
  } else {
    cookies = text
      .replace(/^cookie:\s*/i, '')
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p.includes('='))
      .map((p) => {
        const i = p.indexOf('=');
        return { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim(), domain: '.vk.ru', path: '/' };
      });
  }
  const vk = cookies.filter((c) => /(^|\.)vk\.(ru|com)$/i.test(c.domain.replace(/^\./, '')));
  if (!vk.some((c) => c.name === 'remixsid' && c.value))
    return { ok: false, error: 'нет куки remixsid — выгрузите куки vk.ru после входа в аккаунт' };
  return { ok: true, cookies: vk };
}
