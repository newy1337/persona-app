/** Cancellation is control flow, never a failed delivery to retry unchanged. */
export class ReplySuperseded extends Error {
  constructor() {
    super('New inbound activity superseded this reply');
    this.name = 'ReplySuperseded';
  }
}

export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new ReplySuperseded();
}

export function cancellableSleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  checkCancelled(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason ?? new ReplySuperseded());
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
