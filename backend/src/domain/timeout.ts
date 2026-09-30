export class TelegramTimeoutError extends Error {
  constructor(
    readonly accountId: number,
    readonly label: string,
    readonly ms: number,
  ) {
    super(
      `аккаунт #${accountId}: Telegram не ответил за ${Math.round(ms / 1000)} с (${label})`,
    );
    this.name = 'TelegramTimeoutError';
  }
}

export const isTelegramTimeout = (e: unknown): e is TelegramTimeoutError =>
  e instanceof TelegramTimeoutError ||
  (e as { name?: string } | null)?.name === 'TelegramTimeoutError';

export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
