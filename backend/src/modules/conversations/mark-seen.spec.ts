import { ConversationsService } from './conversations.service';

describe('отметку о прочтении ставит менеджер, и только на ручном режиме', () => {
  const service = ({
    paused = true,
    inbox = 0,
    latest = 0,
  }: { paused?: boolean; inbox?: number; latest?: number } = {}) => {
    const read: number[] = [];
    const seen: Array<[number, number]> = [];
    const svc: any = Object.create(ConversationsService.prototype);
    Object.assign(svc, {
      pause: { status: async () => ({ status: paused ? 'paused' : 'active' }) },
      telegram: {
        markRead: async (chatId: number) => {
          read.push(chatId);
        },
      },
      history: {
        telegramReadMarks: async () => ({ inbox, outbox: null }),
        latestClientTgId: async () => latest,
        markManagerSeen: async (chatId: number, ts: number) => {
          seen.push([chatId, ts]);
        },
      },
      clock: { ts: () => 1_000 },
    });
    return { svc, read, seen };
  };

  it('ручной режим, есть непрочитанное — читаем в Telegram', async () => {
    const { svc, read, seen } = service({ inbox: 10, latest: 12 });
    await svc.markSeen(42);
    expect(read).toEqual([42]);
    expect(seen).toEqual([[42, 1_000]]);
  });

  it('ведёт бот — присутствие менеджера собеседнику не показываем', async () => {
    const { svc, read, seen } = service({
      paused: false,
      inbox: 10,
      latest: 12,
    });
    await svc.markSeen(42);
    expect(read).toEqual([]);
    // Курсор непрочитанного в панели всё равно двигаем: менеджер их видел.
    expect(seen).toEqual([[42, 1_000]]);
  });

  it('в Telegram уже отмечено — повторно не дёргаем на каждом обновлении', async () => {
    const { svc, read } = service({ inbox: 12, latest: 12 });
    await svc.markSeen(42);
    expect(read).toEqual([]);
  });

  it('сообщений от собеседника ещё нет — читать нечего', async () => {
    const { svc, read } = service({ inbox: 0, latest: 0 });
    await svc.markSeen(42);
    expect(read).toEqual([]);
  });

  it('упавший Telegram не ломает открытие переписки', async () => {
    const { svc, seen } = service({ inbox: 10, latest: 12 });
    svc.telegram.markRead = async () => {
      throw new Error('аккаунт не в сети');
    };
    await expect(svc.markSeen(42)).resolves.toBeUndefined();
    expect(seen).toEqual([[42, 1_000]]);
  });
});
