const HOST_RX = /^(localhost|(\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\]|([a-z0-9-]+\.)+[a-z0-9-]{2,})$/i;

const isHost = (v) => HOST_RX.test(String(v ?? '').trim());
const isPort = (v) => /^\d{1,5}$/.test(String(v ?? '').trim()) && Number(v) > 0 && Number(v) < 65536;

const result = (type, host, port, username = '', password = '', secret = '') => ({
  ok: true,
  proxy: { type, host: host.trim(), port: String(Number(port)), username: username ?? '', password: password ?? '', secret: secret ?? '' },
});

const fail = (error) => ({ ok: false, error });

function parseBare(text, type) {
  if (text.includes('@')) {
    const at = text.lastIndexOf('@');
    const left = text.slice(0, at);
    const right = text.slice(at + 1);
    const [rh, rp] = splitHostPort(right);
    if (isHost(rh) && isPort(rp)) {
      const [u, ...p] = left.split(':');
      return result(type, rh, rp, decodeURIComponent(u), decodeURIComponent(p.join(':')));
    }
    const [lh, lp] = splitHostPort(left);
    if (isHost(lh) && isPort(lp)) {
      const [u, ...p] = right.split(':');
      return result(type, lh, lp, u, p.join(':'));
    }
    return fail('не нашёл хост и порт');
  }

  const parts = text.split(':');
  if (parts.length === 2 && isHost(parts[0]) && isPort(parts[1])) return result(type, parts[0], parts[1]);
  if (parts.length >= 4) {
    if (isHost(parts[0]) && isPort(parts[1])) return result(type, parts[0], parts[1], parts[2], parts.slice(3).join(':'));
    if (isHost(parts[2]) && isPort(parts[3])) return result(type, parts[2], parts[3], parts[0], parts[1]);
  }
  return fail('не похоже на хост:порт — пример: 1.2.3.4:1080:логин:пароль');
}

function splitHostPort(text) {
  const t = String(text ?? '').trim();
  const i = t.lastIndexOf(':');
  return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 1)];
}

export function parseProxyLine(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return fail('пустая строка');

  if (/^(tg:\/\/proxy|https?:\/\/(t\.me|telegram\.me)\/proxy)\?/i.test(text)) {
    const q = new URLSearchParams(text.slice(text.indexOf('?') + 1));
    const server = q.get('server');
    const port = q.get('port');
    const secret = q.get('secret');
    if (!server || !isPort(port) || !secret) return fail('в ссылке MTProto нужны server, port и secret');
    return result('mtproto', server, port, '', '', secret);
  }

  const scheme = /^([a-z0-9]+):\/\/(.*)$/i.exec(text);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name.startsWith('http')) return fail('HTTP-прокси Telegram не поддерживает — нужен SOCKS5, SOCKS4 или MTProto');
    const type = name.startsWith('socks4') ? 'socks4' : name.startsWith('socks') ? 'socks5' : null;
    if (!type) return fail(`схема «${name}» не поддерживается`);
    return parseBare(scheme[2].replace(/\/+$/, ''), type);
  }

  return parseBare(text, 'socks5');
}
