import { ConversationsService } from './conversations.service';

describe('отметка о прочтении ставится менеджером, а не ботом', () => {
  const service = (
    managerSeenTs: number | null,
    lastClientTs: number | null,
  ) => {
    const read: number[] = [];
    const seen: Array<[number, number]> = [];
    const svc: any = Object.create(ConversationsService.prototype);
    Object.assign(svc, {
      prisma: {
        contact: {
          findUnique: async () =>
            managerSeenTs === null && lastClientTs === null
              ? null
              : { managerSeenTs },
        },
        message: {
          findFirst: async () =>
            lastClientTs === null ? null : { ts: lastClientTs },
        },
      },
      telegram: {
        markRead: async (chatId: number) => {
          read.push(chatId);
        },
      },
      history: {
        markManagerSeen: async (chatId: number, ts: number) => {
          seen.push([chatId, ts]);
        },
      },
      clock: { ts: () => 1_000 },
    });
    return { svc, read, seen };
  };

  it('открыли чат с новым сообщением — читаем в Telegram и двигаем курсор', async () => {
    const { svc, read, seen } = service(500, 700);
    await svc.markSeen(42);
    expect(read).toEqual([42]);
    expect(seen).toEqual([[42, 1_000]]);
  });

  it('читать нечего — Telegram не трогаем, опрос страницы его не дёргает', async () => {
    const { svc, read, seen } = service(700, 500);
    await svc.markSeen(42);
    expect(read).toEqual([]);
    expect(seen).toEqual([[42, 1_000]]);
  });

  it('менеджер открывает впервые — прежнего курсора нет, но сообщение есть', async () => {
    const { svc, read } = service(null, 500);
    await svc.markSeen(42);
    expect(read).toEqual([42]);
  });

  it('упавший Telegram не ломает открытие переписки', async () => {
    const { svc, seen } = service(500, 700);
    svc.telegram.markRead = async () => {
      throw new Error('аккаунт не в сети');
    };
    await expect(svc.markSeen(42)).resolves.toBeUndefined();
    expect(seen).toEqual([[42, 1_000]]);
  });
});
