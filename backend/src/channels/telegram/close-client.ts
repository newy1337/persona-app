import type { TelegramClient } from 'telegram';
import { withTimeout } from 'src/domain/timeout';

const CLOSE_TIMEOUT_MS = 10_000;
// Через сколько проверить, что закрытый клиент не подключился обратно.
const RECHECK_MS = 120_000;

type Closable = Pick<TelegramClient, 'destroy' | 'connected'>;

/**
 * Закрыть клиент GramJS насовсем. `disconnect()` для этого не годится: он не
 * останавливает ping-цикл клиента (_updateLoop), и «отключённый» клиент дальше
 * пингует Telegram, а при ошибке сам переподключается. Такие клиенты копились
 * при каждом переподключении аккаунта, ели память и CPU, пока бэкенд не вставал.
 * `destroy()` выключает цикл и снимает обработчики событий.
 *
 * `pending` — подключение, которое ещё идёт (connect() отвалился по нашему
 * таймауту, а GramJS продолжает попытки): когда оно завершится, клиент
 * закрывается ещё раз. И на всякий случай через пару минут проверяем, не
 * поднял ли соединение сам транспорт, — тогда рвём его снова.
 */
/**
 * Соединения GramJS с другими дата-центрами (через них качаются аватарки и
 * медиа). GramJS 2.x закрывает их в disconnect() через Object.values(Map) —
 * это всегда пустой список, так что они и их таймеры переживают destroy().
 * Таймер освобождения видит незавершённые запросы, переподключает соединение
 * и ставит себя снова: зомби крутится вечно («sender already has some hanging
 * states. reconnecting»). Каждый неудачный вход аккаунта добавлял таких, пока
 * процесс не съедал весь CPU (прод 26.10). Закрываем их сами.
 */
export function releaseExportedSenders(client: unknown): void {
  const c = client as {
    _exportedSenderReleaseTimeouts?: Map<
      unknown,
      ReturnType<typeof setTimeout>
    >;
    _exportedSenderPromises?: Map<unknown, Promise<unknown> | undefined>;
  };
  const timers = c._exportedSenderReleaseTimeouts;
  if (timers instanceof Map) {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  }
  const senders = c._exportedSenderPromises;
  if (!(senders instanceof Map)) return;
  for (const promise of senders.values())
    void Promise.resolve(promise)
      .then((sender) => {
        const s = sender as {
          _autoReconnect?: boolean;
          _pendingState?: { clear?: () => void };
          disconnect?: () => unknown;
        } | null;
        if (!s) return;
        s._autoReconnect = false;
        s._pendingState?.clear?.();
        return s.disconnect?.();
      })
      .catch(() => undefined);
  senders.clear();
}

export async function closeClient(
  client: Closable,
  {
    pending,
    timeoutMs = CLOSE_TIMEOUT_MS,
  }: { pending?: Promise<unknown>; timeoutMs?: number } = {},
): Promise<void> {
  const close = () =>
    withTimeout(
      new Promise<void>((done) => {
        releaseExportedSenders(client);
        done(client.destroy());
      }),
      timeoutMs,
      () => new Error('disconnect timeout'),
    ).catch(() => undefined);
  if (pending) void pending.then(close, () => undefined).catch(() => undefined);
  const recheck = setTimeout(() => {
    if (client.connected) void close();
  }, RECHECK_MS);
  recheck.unref?.();
  await close();
}
