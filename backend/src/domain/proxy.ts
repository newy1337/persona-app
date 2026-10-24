/** http/https — для VK (Telegram их не принимает), mtproto — только Telegram. */
export const PROXY_TYPES = [
  'socks5',
  'socks4',
  'mtproto',
  'http',
  'https',
] as const;
export type ProxyType = (typeof PROXY_TYPES)[number];

export interface ProxyConfig {
  type: string;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  secret?: string | null;
}

export type ClientProxy =
  | {
      ip: string;
      port: number;
      socksType: 4 | 5;
      username?: string;
      password?: string;
      timeout: number;
    }
  | {
      ip: string;
      port: number;
      MTProxy: true;
      secret: string;
      timeout: number;
    };

const PROXY_TIMEOUT_S = 15;

export function toClientProxy(
  cfg: ProxyConfig | null | undefined,
): ClientProxy | null {
  if (!cfg) return null;
  const ip = String(cfg.host ?? '').trim();
  const port = Number(cfg.port);
  if (!ip || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('прокси: нужен хост и порт 1–65535');
  if (cfg.type === 'mtproto') {
    if (!cfg.secret) throw new Error('прокси MTProto: нужен secret');
    return {
      ip,
      port,
      MTProxy: true,
      secret: cfg.secret,
      timeout: PROXY_TIMEOUT_S,
    };
  }
  if (cfg.type === 'socks5' || cfg.type === 'socks4') {
    return {
      ip,
      port,
      socksType: cfg.type === 'socks4' ? 4 : 5,
      ...(cfg.username ? { username: cfg.username } : {}),
      ...(cfg.password ? { password: cfg.password } : {}),
      timeout: PROXY_TIMEOUT_S,
    };
  }
  throw new Error(
    `прокси «${cfg.type}» Telegram не поддерживает — нужен SOCKS5, SOCKS4 или MTProto`,
  );
}

export function proxyLabel(cfg: ProxyConfig | null | undefined): string | null {
  if (!cfg?.host) return null;
  return `${cfg.type} ${cfg.host}:${cfg.port}${cfg.username ? ` · ${cfg.username}` : ''}`;
}

/**
 * Прокси VK адресом для HTTP-клиента: http, https или socks5. Токен VK
 * привязан к выходному IP, поэтому без прокси аккаунт не подключаем.
 */
export function toProxyUrl(cfg: ProxyConfig | null | undefined): string {
  if (!cfg?.host)
    throw new Error('у аккаунта VK нет прокси — без него токен не живёт');
  const port = Number(cfg.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('прокси: нужен хост и порт 1–65535');
  if (!['http', 'https', 'socks5'].includes(cfg.type))
    throw new Error(
      `прокси «${cfg.type}» VK не поддерживает — нужен HTTP, HTTPS или SOCKS5`,
    );
  const auth = cfg.username
    ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password ?? '')}@`
    : '';
  return `${cfg.type}://${auth}${cfg.host.trim()}:${port}`;
}

/** Тип прокси не подходит каналу аккаунта — текст для панели; null — подходит. */
export function proxyTypeError(channel: string, type: string): string | null {
  if (channel === 'vk')
    return ['http', 'https', 'socks5'].includes(type)
      ? null
      : `прокси ${type} VK не поддерживает — нужен HTTP, HTTPS или SOCKS5`;
  return ['http', 'https'].includes(type)
    ? 'прокси HTTP Telegram не поддерживает — нужен SOCKS5, SOCKS4 или MTProto'
    : null;
}
