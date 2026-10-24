import { chatIdFor } from 'src/channels/ids';
import { VkApiError } from 'src/channels/vk/errors';
import { decodeEvent, type VkEvent } from 'src/channels/vk/inbound';
import { VkMessages, foldRandomId } from 'src/channels/vk/messages';
import { VkService } from './vk.service';

/** VkService без Nest: зависимости — заглушки, API — очередь ответов по методу. */
const setup = (answers: Record<string, unknown[]> = {}) => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const api = {
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push([method, params]);
      const next = answers[method]?.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error(`нет ответа на ${method}`);
      return next;
    },
    download: async () => Buffer.from('x'),
  };
  const turns: unknown[] = [];
  const appended: unknown[] = [];
  const svc: any = Object.create(VkService.prototype);
  Object.assign(svc, {
    log: {
      warn: () => undefined,
      error: () => undefined,
      log: () => undefined,
    },
    live: new Map(),
    stopping: false,
    clock: { ts: () => 1_700_000_100 },
    presence: { setActivity: () => undefined },
    prisma: {
      channelAccount: { findMany: async () => [{ peerId: BigInt(999) }] },
      contact: { findUnique: async () => null },
      message: { findFirst: async () => null },
      inboundMedia: { create: async () => undefined },
    },
    history: {
      chatOwnerAccount: async () => null,
      hasProcessedClientMessage: async () => false,
      setBlockedByClient: async () => undefined,
      clearClearedByClient: async () => undefined,
      clearLikelyBlocked: async () => undefined,
      ensureContact: async () => undefined,
      appendMessage: async (_c: number, m: unknown) => {
        appended.push(m);
      },
    },
    brain: {
      handleInbound: async (t: unknown) => {
        turns.push(t);
      },
      noteOperatorMessage: async () => undefined,
    },
  });
  const entry = {
    id: 3,
    peerId: 999,
    api,
    messages: new VkMessages(api as never),
    abort: new AbortController(),
    contacts: new Map<number, number>(),
    plain: new Set<number>(),
    contactsStale: false,
  };
  svc.live.set(3, entry);
  return { svc, entry, calls, turns, appended };
};

const message = (e: VkEvent | null) =>
  e as Extract<VkEvent, { kind: 'message' }>;

describe('VK: входящие', () => {
  it('сообщение собеседника — ход брейну в чат VK с cmid', async () => {
    const { svc, entry, turns } = setup();
    await svc.onMessage(
      entry,
      message(
        decodeEvent([
          10004,
          7,
          1,
          1,
          555,
          1700000000,
          'привет',
          {},
          {},
          0,
          19088,
          0,
        ]),
      ),
    );
    expect(turns).toEqual([
      {
        chatId: chatIdFor('vk', 555),
        accountId: 3,
        messageId: 7,
        text: 'привет',
        ts: 1700000000,
        media: null,
      },
    ]);
  });

  it('эхо своей отправки — мимо; реплика из приложения VK — в историю от оператора', async () => {
    const { svc, entry, turns, appended } = setup({
      'messages.send': [{ cmid: 8 }],
    });
    await entry.messages.send(555, { message: 'да' }, { randomId: '42' });
    const echo = decodeEvent([
      10004,
      8,
      3,
      1,
      555,
      1,
      'да',
      {},
      {},
      foldRandomId('42'),
      2,
      0,
    ]);
    await svc.onMessage(entry, message(echo));
    expect(appended).toEqual([]);
    await svc.onMessage(
      entry,
      message(
        decodeEvent([10004, 9, 3, 1, 555, 1, 'пишу сама', {}, {}, 777, 3, 0]),
      ),
    );
    expect(turns).toEqual([]);
    expect(appended).toEqual([
      expect.objectContaining({
        role: 'assistant',
        text: 'пишу сама',
        author: 'operator:vk',
        peerMsgId: 9,
      }),
    ]);
  });

  it('беседы и свой аккаунт — не собеседники', async () => {
    const { svc, entry, turns } = setup();
    await svc.onMessage(
      entry,
      message(
        decodeEvent([10004, 1, 1, 1, 2000000005, 1, 'всем', {}, {}, 0, 1, 0]),
      ),
    );
    await svc.onMessage(
      entry,
      message(decodeEvent([10004, 1, 1, 1, 999, 1, 'себе', {}, {}, 0, 1, 0])),
    );
    expect(turns).toEqual([]);
  });

  it('ответ на опенер по номеру — в чат контакта', async () => {
    const { svc, entry, turns } = setup({
      'messages.getContactsById': [
        [{ id: 5, user_id: 555 }],
        new VkApiError(936, 'Contact not found'),
      ],
    });
    entry.contactsStale = true;
    await svc.onMessage(
      entry,
      message(
        decodeEvent([10004, 2, 1, 1, 555, 1, 'кто это?', {}, {}, 0, 1, 0]),
      ),
    );
    expect((turns[0] as { chatId: number }).chatId).toBe(
      chatIdFor('vk', 1_900_000_005),
    );
  });
});

describe('VK: поиск для рассылки', () => {
  it('ник: закрытая личка — не найден, удалённая страница — deleted', async () => {
    const { svc } = setup({
      'users.get': [
        [{ id: 1, screen_name: 'a', can_write_private_message: 0 }],
        [{ id: 2, deactivated: 'deleted' }],
        [{ id: 3, screen_name: 'c', can_write_private_message: 1 }],
        new VkApiError(113, 'Invalid user id'),
      ],
    });
    expect(await svc.resolveUsername(3, 'a')).toEqual({ kind: 'not_found' });
    expect(await svc.resolveUsername(3, 'b')).toMatchObject({
      kind: 'found',
      deleted: true,
    });
    expect(await svc.resolveUsername(3, '@c')).toEqual({
      kind: 'found',
      chatId: chatIdFor('vk', 3),
      userId: 3,
      username: 'c',
      deleted: false,
    });
    expect(await svc.resolveUsername(3, 'zzz')).toEqual({ kind: 'not_found' });
  });

  it('номер — пир контакта, если VK даёт писать', async () => {
    const { svc, entry, calls } = setup({
      'account.importMessagesContacts': [
        { items: { synced: [5] } },
        { items: {} },
      ],
      'messages.getContactsById': [[{ id: 5, user_id: 555, can_write: 1 }]],
    });
    expect(await svc.resolvePhone(3, '+79001112233')).toMatchObject({
      kind: 'found',
      chatId: chatIdFor('vk', 1_900_000_005),
    });
    expect(entry.contactsStale).toBe(true);
    expect(JSON.parse(String(calls[0][1].contacts))).toEqual([
      { phones: ['+79001112233'], name: '' },
    ]);
    expect(await svc.resolvePhone(3, '+79001112244')).toEqual({
      kind: 'not_found',
    });
  });
});
