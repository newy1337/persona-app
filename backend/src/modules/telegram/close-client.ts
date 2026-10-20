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
export async function closeClient(
  client: Closable,
  {
    pending,
    timeoutMs = CLOSE_TIMEOUT_MS,
  }: { pending?: Promise<unknown>; timeoutMs?: number } = {},
): Promise<void> {
  const close = () =>
    withTimeout(
      new Promise<void>((done) => done(client.destroy())),
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
