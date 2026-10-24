import { spawn } from 'child_process';
import { WATCHDOG_SOURCE, startEventLoopWatchdog } from './event-loop-watchdog';

/** Отдельный процесс с тем же кодом сторожа; основной поток в нём делает `busy`. */
function child(busy: string, limitMs: number) {
  const script = `
    const { Worker } = require('worker_threads');
    const worker = new Worker(${JSON.stringify(WATCHDOG_SOURCE)}, {
      eval: true, workerData: { limitMs: ${limitMs}, checkMs: 50 },
    });
    worker.unref();
    setInterval(() => worker.postMessage(0), 20).unref();
    setTimeout(() => { ${busy} }, 200);
  `;
  return new Promise<{
    code: number | null;
    signal: string | null;
    err: string;
  }>((resolve) => {
    const p = spawn(process.execPath, ['-e', script]);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code, signal) => resolve({ code, signal, err }));
  });
}

describe('сторож основного потока', () => {
  jest.setTimeout(20_000);

  it('основной поток завис — процесс убит и в stderr сказано почему', async () => {
    const r = await child('while (true) {}', 500);
    expect(r.signal ?? r.code).toBeTruthy();
    expect(r.err).toContain('[watchdog] основной поток не отвечает');
  });

  it('живой процесс не трогает и выйти не мешает', async () => {
    const r = await child('setTimeout(() => process.exit(0), 800)', 500);
    expect(r).toMatchObject({ code: 0, signal: null });
    expect(r.err).toBe('');
  });

  it('0 — сторож выключен', () => {
    expect(startEventLoopWatchdog(0)).toBeNull();
  });

  it('запускается и останавливается без утечки', async () => {
    const dog = startEventLoopWatchdog(60_000);
    expect(dog).not.toBeNull();
    await dog!.stop();
  });
});
