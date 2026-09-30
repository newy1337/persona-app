import { ReplySuperseded } from 'src/shared/cancellation';

/** Receipt is registered BEFORE waiting for the chat lock or downloading media. */
export class ChatActivity {
  private readonly incoming = new Map<number, Map<string, number>>();
  private readonly active = new Map<number, AbortController>();

  receive(chatId: number, key: string): () => void {
    let pending = this.incoming.get(chatId);
    if (!pending) this.incoming.set(chatId, (pending = new Map()));
    if (!pending.has(key))
      this.active.get(chatId)?.abort(new ReplySuperseded());
    pending.set(key, (pending.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (pending!.get(key) ?? 1) - 1;
      if (count) pending!.set(key, count);
      else pending!.delete(key);
      if (!pending!.size) this.incoming.delete(chatId);
    };
  }

  start(chatId: number): { signal: AbortSignal; finish: () => void } | null {
    if (this.incoming.has(chatId)) return null;
    if (this.active.has(chatId))
      throw new Error('Concurrent reply outside the chat lock');
    const controller = new AbortController();
    this.active.set(chatId, controller);
    return {
      signal: controller.signal,
      finish: () => {
        if (this.active.get(chatId) === controller) this.active.delete(chatId);
      },
    };
  }
}
