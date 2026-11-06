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

type Dead = AccountProbe & { since: number };

/** Что уже писали об аккаунте: когда, сколько напоминаний и при каком прокси. */
interface Notice {
  at: number;
  reminders: number;
  proxy: string | null;
}

/** Состояние наблюдения: переживает перезапуск, иначе отсчёт до выключения терялся бы с каждым деплоем. */
export interface ProxyWatchState {
  downSince: Record<string, number>;
  notices: Record<string, Notice>;
}

export interface ProxyStep {
  messages: string[];
  /** аккаунты, которые пора выключить: напоминания кончились, прокси не меняли */
  disable: Dead[];
}

/** Сообщение о выключенных аккаунтах — после того, как их правда выключили. */
export function disabledMessage(
  list: Dead[],
  reminders: number,
  now: number,
): string {
  return `⛔ Выключены (на паузу): прокси не работает, после ${reminders} напоминаний его не заменили. Замените прокси и включите аккаунт в «Аккаунтах».\n${deadList(list, now)}`;
}

/**
 * Следит за аккаунтами, которые не в сети из-за прокси. Предупреждает, когда
 * аккаунт лежит дольше afterSec, напоминает раз в repeatSec, пока лежит, и
 * сообщает, когда он снова в сети или его выключили. После maxReminders
 * напоминаний, если прокси так и не заменили, отдаёт аккаунт на выключение:
 * мёртвый аккаунт держит свои диалоги и очереди. Замена прокси — это меры:
 * отсчёт начинается заново.
 */
export class ProxyWatch {
  private downSince = new Map<number, number>();
  private notices = new Map<number, Notice>();

  constructor(
    private readonly afterSec: number,
    private readonly repeatSec: number,
    readonly maxReminders = 2,
  ) {}

  snapshot(): ProxyWatchState {
    return {
      downSince: Object.fromEntries(this.downSince),
      notices: Object.fromEntries(this.notices),
    };
  }

  restore(state: Partial<ProxyWatchState> | null | undefined): void {
    const ids = (o: object | undefined) =>
      Object.entries(o ?? {}).filter(([k]) => Number.isInteger(Number(k)));
    this.downSince = new Map(
      ids(state?.downSince)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => [Number(k), v as number]),
    );
    this.notices = new Map(
      ids(state?.notices)
        .filter(([, v]) => v && typeof (v as Notice).at === 'number')
        .map(([k, v]) => {
          const n = v as Notice;
          return [
            Number(k),
            {
              at: n.at,
              reminders: Number(n.reminders) || 0,
              proxy: n.proxy ?? null,
            },
          ];
        }),
    );
  }

  step(probes: readonly AccountProbe[], now: number): ProxyStep {
    const dead: Dead[] = [];
    const byId = new Map(probes.map((p) => [p.id, p]));
    const replaced = new Set<number>();
    for (const p of probes) {
      if (p.online || !isProxyTrouble(p.reason)) {
        this.downSince.delete(p.id);
        continue;
      }
      const notice = this.notices.get(p.id);
      // Прокси заменили, а аккаунт всё ещё лежит — меры приняты, считаем заново.
      if (notice && notice.proxy !== p.proxy) {
        this.notices.delete(p.id);
        this.downSince.delete(p.id);
        replaced.add(p.id);
      }
      const since = this.downSince.get(p.id) ?? now;
      this.downSince.set(p.id, since);
      if (now - since >= this.afterSec) dead.push({ ...p, since });
    }
    for (const id of this.downSince.keys())
      if (!byId.has(id)) this.downSince.delete(id);

    const deadIds = new Set(dead.map((p) => p.id));
    const back = [...this.notices.keys()].filter((id) => !deadIds.has(id));
    for (const id of back) this.notices.delete(id);

    const fresh = dead.filter((p) => !this.notices.has(p.id));
    const due = dead.filter((p) => {
      const n = this.notices.get(p.id);
      return n && now - n.at >= this.repeatSec;
    });
    const disable = due.filter(
      (p) => this.notices.get(p.id)!.reminders >= this.maxReminders,
    );
    const remind = due.filter(
      (p) => this.notices.get(p.id)!.reminders < this.maxReminders,
    );
    for (const p of disable) {
      this.notices.delete(p.id);
      this.downSince.delete(p.id);
    }

    const messages: string[] = [];
    const after = minutes(this.repeatSec);
    if (fresh.length) {
      for (const p of fresh)
        this.notices.set(p.id, { at: now, reminders: 0, proxy: p.proxy });
      messages.push(
        `⚠️ Не работают прокси: ${fresh.length === 1 ? 'аккаунт не в сети' : `${fresh.length} акк. не в сети`} дольше ${minutes(this.afterSec)}. Замените прокси или выключите аккаунт в «Аккаунтах». Без замены после ${this.maxReminders} напоминаний аккаунт выключится сам.\n${deadList(fresh, now)}${dead.length > fresh.length ? `\n\nВсего с нерабочим прокси: ${dead.length}.` : ''}`,
      );
    }
    if (remind.length) {
      const last: number[] = [];
      for (const p of remind) {
        const n = this.notices.get(p.id)!;
        n.reminders += 1;
        n.at = now;
        if (n.reminders >= this.maxReminders) last.push(p.id);
      }
      messages.push(
        `⏰ Напоминание: прокси всё ещё не работают у ${remind.length} акк.\n${deadList(remind, now)}${last.length ? `\n\nПоследнее напоминание для ${last.map((id) => `#${id}`).join(', ')}: не заменят прокси за ${after} — выключатся сами.` : ''}`,
      );
    }
    if (back.length)
      messages.push(
        `✅ Прокси больше не мешают:\n${back
          .map((id) => {
            const p = byId.get(id);
            if (!p) return `• #${id} — выключен или удалён`;
            return p.online
              ? `• #${id} ${p.login} — снова в сети`
              : `• #${id} ${p.login} — не в сети по другой причине: ${p.reason ?? '—'}`;
          })
          .join('\n')}`,
      );
    if (replaced.size)
      messages.push(
        `🔄 Прокси заменили, аккаунт ещё не в сети — отсчёт заново:\n${[
          ...replaced,
        ]
          .map((id) => `• #${id} ${byId.get(id)?.login ?? ''}`.trimEnd())
          .join('\n')}`,
      );
    return { messages, disable };
  }
}
