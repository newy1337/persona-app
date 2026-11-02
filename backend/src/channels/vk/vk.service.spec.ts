import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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

  it('ответ собеседника на сообщение — в ходе номер того сообщения (cmid)', async () => {
    const { svc, entry, turns } = setup();
    await svc.onMessage(entry, {
      kind: 'message',
      outgoing: false,
      thin: false,
      message: {
        id: 9,
        conversation_message_id: 9,
        peer_id: 555,
        from_id: 555,
        date: 1700000000,
        text: 'да',
        out: 0,
        reply_message: { conversation_message_id: 4 },
      },
    } as never);
    expect(turns).toEqual([
      expect.objectContaining({ messageId: 9, replyTo: 4 }),
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

describe('VK: вложения из панели и от войсера', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vk-files-'));
  const file = (name: string) => {
    const path = join(dir, name);
    writeFileSync(path, 'x');
    return path;
  };
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const withUploads = (answers: Record<string, unknown[]>) => {
    const t = setup(answers);
    const posted: Array<Record<string, unknown>> = [];
    Object.assign(t.entry.api, {
      postFile: async (_url: string, f: Record<string, unknown>) => {
        posted.push(f);
        return f.field === 'photo'
          ? { photo: 'p', server: 1, hash: 'h' }
          : f.field === 'video_file'
            ? { video_hash: 'vh' }
            : { file: 'f' };
      },
    });
    t.svc.accountFor = async () => ({ entry: t.entry, peer: 555 });
    return { ...t, posted };
  };

  it('голосовое — документ audio_message, ответом на сообщение, с подписью', async () => {
    const { svc, calls } = withUploads({
      'messages.setActivity': [1],
      'docs.getMessagesUploadServer': [{ upload_url: 'https://up' }],
      'docs.save': [
        {
          type: 'audio_message',
          audio_message: { owner_id: 9, id: 7, access_key: 'k' },
        },
      ],
      'messages.send': [{ cmid: 31 }],
    });
    const dispatched: string[] = [];
    const cmid = await svc.sendFile(chatIdFor('vk', 555), {
      kind: 'voice',
      path: file('v.ogg'),
      caption: 'держи',
      randomId: '42',
      replyTo: 12,
      onDispatch: async () => {
        dispatched.push('ушло');
      },
    });
    expect(cmid).toBe(31);
    expect(dispatched).toEqual(['ушло']);
    expect(calls.find(([m]) => m === 'messages.setActivity')![1].type).toBe(
      'audiomessage',
    );
    expect(
      calls.find(([m]) => m === 'docs.getMessagesUploadServer')![1],
    ).toMatchObject({ peer_id: 555, type: 'audio_message' });
    const send = calls.find(([m]) => m === 'messages.send')![1];
    expect(send).toMatchObject({
      peer_id: 555,
      attachment: 'doc9_7_k',
      message: 'держи',
      random_id: foldRandomId('42'),
    });
    expect(JSON.parse(String(send.forward))).toMatchObject({
      conversation_message_ids: [12],
      is_reply: true,
    });
  });

  it('альбом — одно сообщение: фото и видео через запятую', async () => {
    const { svc, calls } = withUploads({
      'messages.setActivity': [1],
      'photos.getMessagesUploadServer': [{ upload_url: 'https://up' }],
      'photos.saveMessagesPhoto': [[{ owner_id: 9, id: 1 }]],
      'video.save': [{ upload_url: 'https://up', owner_id: 9, video_id: 2 }],
      'messages.send': [{ cmid: 55 }],
    });
    const cmid = await svc.sendFiles(chatIdFor('vk', 555), {
      paths: [file('a.jpg'), file('b.mp4')],
      caption: 'мы',
      randomId: '7',
    });
    expect(cmid).toBe(55);
    expect(calls.filter(([m]) => m === 'messages.send')).toHaveLength(1);
    expect(calls.find(([m]) => m === 'messages.send')![1]).toMatchObject({
      attachment: 'photo9_1,video9_2',
      message: 'мы',
    });
  });

  it('больше 10 вложений — сразу отказ, ничего не загружено', async () => {
    const { svc, calls } = withUploads({});
    await expect(
      svc.sendFiles(chatIdFor('vk', 555), {
        paths: Array.from({ length: 11 }, (_, i) => `/x/${i}.jpg`),
        caption: '',
        randomId: '1',
      }),
    ).rejects.toThrow('до 10 вложений');
    expect(calls).toEqual([]);
  });
});
