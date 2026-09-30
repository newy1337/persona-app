export const PROXY_TYPES = ['socks5', 'socks4', 'mtproto'] as const;
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
