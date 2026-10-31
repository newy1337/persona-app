/** Аккаунт на одной проверке: в сети ли и почему нет. */
export interface AccountProbe {
  id: number;
  channel: string;
  login: string;
  /** «socks5 1.2.3.4:1080 · user»; null — без прокси */
  proxy: string | null;
  manager: string | null;
  region: string | null;
  online: boolean;
  reason: string | null;
}

/**
 * Не в сети из-за связи — прокси или сеть до канала. Сессия, бан и пауза —
 * другое: менять прокси бесполезно, о них здесь не пишем.
 */
export function isProxyTrouble(reason: string | null): boolean {
  if (!reason) return false;
  if (/не активен|сессия|сессии|заблокировал|ключи/i.test(reason)) return false;
  return /прокси|нет связи|не отвечает/i.test(reason);
}

const MAX_LINES = 40;
const CHANNEL: Record<string, string> = { telegram: 'Telegram', vk: 'VK' };

const minutes = (sec: number) =>
  sec >= 3600
    ? `${Math.floor(sec / 3600)} ч ${Math.floor((sec % 3600) / 60)} мин`
    : `${Math.max(1, Math.floor(sec / 60))} мин`;

function accountLine(p: AccountProbe & { since: number }, now: number) {
  const who = [p.manager, p.region ? `рег. ${p.region}` : null]
    .filter(Boolean)
    .join(', ');
  return `• #${p.id} ${p.login} (${CHANNEL[p.channel] ?? p.channel})${who ? ` — ${who}` : ''} — ${p.reason} — ${minutes(now - p.since)}`;
}

/** Список по прокси: на одном прокси часто сидят несколько аккаунтов. */
function deadList(
  dead: Array<AccountProbe & { since: number }>,
  now: number,
): string {
  const byProxy = new Map<string, Array<AccountProbe & { since: number }>>();
  for (const p of dead) {
    const key = p.proxy ?? 'без прокси';
    byProxy.set(key, [...(byProxy.get(key) ?? []), p]);
  }
  const lines: string[] = [];
  for (const [proxy, accounts] of byProxy) {
    lines.push('', proxy);
    for (const p of accounts) lines.push(accountLine(p, now));
  }
  const shown = lines.slice(0, MAX_LINES);
  const hidden = dead.length - shown.filter((l) => l.startsWith('•')).length;
  if (hidden > 0) shown.push('', `…и ещё ${hidden} — список в «Аккаунтах».`);
  return shown.join('\n');
}

/**
 * Следит за аккаунтами, которые не в сети из-за прокси. Предупреждает, когда
 * аккаунт лежит дольше afterSec, напоминает раз в repeatSec, пока лежит, и
 * сообщает, когда он снова в сети или его выключили. Состояние — в памяти:
 * после перезапуска отсчёт начинается заново (аккаунты и так переподключаются).
 */
export class ProxyWatch {
  private readonly downSince = new Map<number, number>();
  private alerted = new Set<number>();
  private lastReminder = 0;

  constructor(
    private readonly afterSec: number,
    private readonly repeatSec: number,
  ) {}

  step(probes: readonly AccountProbe[], now: number): string[] {
    const dead: Array<AccountProbe & { since: number }> = [];
    const byId = new Map(probes.map((p) => [p.id, p]));
    for (const p of probes) {
      if (p.online || !isProxyTrouble(p.reason)) {
        this.downSince.delete(p.id);
        continue;
      }
      const since = this.downSince.get(p.id) ?? now;
      this.downSince.set(p.id, since);
      if (now - since >= this.afterSec) dead.push({ ...p, since });
    }
    for (const id of this.downSince.keys())
      if (!byId.has(id)) this.downSince.delete(id);

    const messages: string[] = [];
    const deadIds = new Set(dead.map((p) => p.id));
    const fresh = dead.filter((p) => !this.alerted.has(p.id));
    const back = [...this.alerted].filter((id) => !deadIds.has(id));
    this.alerted = deadIds;

    if (fresh.length) {
      messages.push(
        `⚠️ Не работают прокси: ${fresh.length === 1 ? 'аккаунт не в сети' : `${fresh.length} акк. не в сети`} дольше ${minutes(this.afterSec)}. Замените прокси или выключите аккаунт в «Аккаунтах».\n${deadList(fresh, now)}${dead.length > fresh.length ? `\n\nВсего с нерабочим прокси: ${dead.length}.` : ''}`,
      );
      this.lastReminder = now;
    } else if (dead.length && now - this.lastReminder >= this.repeatSec) {
      messages.push(
        `⏰ Напоминание: прокси всё ещё не работают у ${dead.length} акк.\n${deadList(dead, now)}`,
      );
      this.lastReminder = now;
    }
    if (back.length) {
      const lines = back.map((id) => {
        const p = byId.get(id);
        if (!p) return `• #${id} — выключен или удалён`;
        return p.online
          ? `• #${id} ${p.login} — снова в сети`
          : `• #${id} ${p.login} — не в сети по другой причине: ${p.reason ?? '—'}`;
      });
      messages.push(`✅ Прокси больше не мешают:\n${lines.join('\n')}`);
    }
    if (!dead.length) this.lastReminder = 0;
    return messages;
  }
}
