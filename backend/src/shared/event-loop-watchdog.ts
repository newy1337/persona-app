import { Worker } from 'worker_threads';

/**
 * Код сторожа. Живёт в отдельном потоке, поэтому работает, даже когда основной
 * поток намертво занят (сборщик мусора у предела памяти, бесконечный цикл).
 * Основной поток раз в секунду шлёт «жив»; нет вестей дольше limitMs — пишем
 * в stderr напрямую (console из потока идёт через основной поток и не дойдёт)
 * и убиваем процесс. Docker (`restart: unless-stopped`) поднимает его заново.
 */
export const WATCHDOG_SOURCE = `
const { parentPort, workerData } = require('worker_threads');
const { writeSync } = require('fs');
let last = Date.now();
parentPort.on('message', () => { last = Date.now(); });
setInterval(() => {
  const stalled = Date.now() - last;
  if (stalled < workerData.limitMs) return;
  try {
    writeSync(2, '[watchdog] основной поток не отвечает ' + Math.round(stalled / 1000) + ' с — перезапуск процесса\\n');
  } catch {}
  process.kill(process.pid, 'SIGKILL');
}, workerData.checkMs);
`;

export type Watchdog = { stop(): Promise<void> };

/** Запустить сторожа; limitMs = 0 — выключен. */
export function startEventLoopWatchdog(
  limitMs: number,
  checkMs = 5_000,
): Watchdog | null {
  if (!(limitMs > 0)) return null;
  const worker = new Worker(WATCHDOG_SOURCE, {
    eval: true,
    workerData: { limitMs, checkMs },
  });
  worker.unref();
  const beat = setInterval(() => worker.postMessage(0), 1_000);
  beat.unref();
  return {
    async stop() {
      clearInterval(beat);
      await worker.terminate();
    },
  };
}
