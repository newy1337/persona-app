import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { VkApi } from './api';
import { VkApiError } from './errors';
import {
  decodeEvent,
  eventText,
  inboundMedia,
  inboundText,
  isPersonPeer,
  liftForwardedVoice,
  type VkMessage,
} from './inbound';
import { CursorCommitter, CursorFile, VkLongPoll } from './longpoll';
import { VkMessages, attachmentRef, foldRandomId } from './messages';

/** VkApi-заглушка: метод → очередь ответов. */
const fakeApi = (answers: Record<string, unknown[]>, urls: unknown[] = []) => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const api = {
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push([method, params]);
      const next = answers[method]?.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error(`нет ответа на ${method}`);
      return next;
    },
    getUrl: async (url: string, params: Record<string, unknown>) => {
      calls.push([url, params]);
      return urls.shift();
    },
  };
  return { api: api as unknown as VkApi, calls };
};

const silent = { warn: () => undefined, log: () => undefined };

describe('события Long Poll v21', () => {
  it('новое входящее: cmid, peer, текст с сущностями', () => {
    const e = decodeEvent([
      10004,
      7,
      1,
      19088,
      555,
      1700000000,
      'привет&amp;пока<br>ещё',
      {},
      {},
      0,
      19088,
      0,
    ]);
    expect(e).toEqual({
      kind: 'message',
      outgoing: false,
      thin: false,
      message: expect.objectContaining({
        id: 19088,
        conversation_message_id: 7,
        peer_id: 555,
        from_id: 555,
        date: 1700000000,
        text: 'привет&пока\nещё',
      }),
    });
  });

  it('эхо нашей отправки — исходящее с random_id', () => {
    const e = decodeEvent([10004, 8, 3, 1, 555, 1, 'да', {}, {}, 4242, 2, 0]);
    expect(e).toMatchObject({
      kind: 'message',
      outgoing: true,
      message: { random_id: 4242 },
    });
  });

  it('фото ярлыком и пересланное — дочитать getById', () => {
    const photo = decodeEvent([
      10004,
      9,
      1,
      1,
      555,
      1,
      '',
      {},
      { attach1_type: 'photo', attach1: '1_2' },
      0,
      3,
      0,
    ]);
    expect(photo).toMatchObject({ kind: 'message', thin: true });
    const voice = decodeEvent([
      10004,
      10,
      1,
      1,
      555,
      1,
      '',
      {},
      {
        attach1_type: 'doc',
        attachments: JSON.stringify([
          {
            type: 'audio_message',
            audio_message: { link_ogg: 'https://x/a.ogg' },
          },
        ]),
      },
      0,
      4,
      0,
    ]);
    expect(voice).toMatchObject({ kind: 'message', thin: false });
    if (voice?.kind === 'message')
      expect(inboundMedia(voice.message)).toMatchObject({
        kind: 'voice',
        url: 'https://x/a.ogg',
      });
  });

  it('правка, прочтение и «печатает»', () => {
    expect(
      decodeEvent([10005, 7, 1, 555, 1, 'исправил', {}, {}, 0, 19088, 0]),
    ).toEqual({
      kind: 'edit',
      peer: 555,
      cmid: 7,
      text: 'исправил',
    });
    // Закрепление приходит тем же 10018 — это не правка.
    expect(
      decodeEvent([10018, 7, 1, 555, 1, 'x', { pinned_at: 1 }, {}, 0, 1, 0]),
    ).toBeNull();
    expect(decodeEvent([10007, 555, 12, 0, 19100])).toEqual({
      kind: 'read',
      side: 'outbox',
      peer: 555,
      cmid: 12,
    });
    expect(decodeEvent([64, 555, [555], 1, 1700000000])).toEqual({
      kind: 'typing',
      peer: 555,
      activity: 'voice',
      ts: 1700000000,
    });
    expect(decodeEvent([10002, 1, 2, 3])).toBeNull();
  });

  it('беседы, сообщества и служебные — не собеседники', () => {
    expect(isPersonPeer(555)).toBe(true);
    expect(isPersonPeer(2_000_000_001)).toBe(false);
    expect(isPersonPeer(-1)).toBe(false);
    expect(isPersonPeer(100)).toBe(false);
    expect(isPersonPeer(300_000_000_000)).toBe(true);
  });

  it('eventText не трогает чистый текст', () => {
    expect(eventText('просто текст')).toBe('просто текст');
    expect(eventText('&#128512;&quot;')).toBe('😀"');
  });
});

describe('вложения и текст хода', () => {
  const msg = (m: Partial<VkMessage>): VkMessage => ({
    id: 1,
    conversation_message_id: 1,
    peer_id: 5,
    date: 1,
    text: '',
    ...m,
  });

  it('фото — самое большое, голосовое — с расшифровкой VK', () => {
    const photo = msg({
      attachments: [
        {
          type: 'photo',
          photo: {
            sizes: [
              { url: 's', width: 10, height: 10 },
              { url: 'l', width: 800, height: 600 },
            ],
          },
        },
      ],
    });
    expect(inboundMedia(photo)).toMatchObject({
      kind: 'photo',
      url: 'l',
      ext: 'jpg',
    });
    const voice = msg({
      attachments: [
        {
          type: 'audio_message',
          audio_message: {
            link_mp3: 'm',
            transcript: 'привет',
            transcript_state: 'done',
            duration: 3,
          },
        },
      ],
    });
    expect(inboundMedia(voice)).toMatchObject({
      kind: 'voice',
      url: 'm',
      ext: 'mp3',
      transcript: 'привет',
      duration: 3,
    });
  });

  it('стикер, кружок, gif-документ и обычный документ', () => {
    expect(
      inboundMedia(
        msg({
          attachments: [
            {
              type: 'sticker',
              sticker: { images: [{ url: 'a' }, { url: 'b' }] },
            },
          ],
        }),
      ),
    ).toMatchObject({ kind: 'sticker', url: 'b' });
    expect(
      inboundMedia(
        msg({
          attachments: [
            {
              type: 'video_message',
              video_message: { files: { mp4_480: 'v' } },
            },
          ],
        }),
      ),
    ).toMatchObject({ kind: 'video_note', url: 'v' });
    expect(
      inboundMedia(
        msg({ attachments: [{ type: 'doc', doc: { ext: 'gif', url: 'g' } }] }),
      ),
    ).toMatchObject({ kind: 'animation', url: 'g' });
    expect(
      inboundMedia(
        msg({
          attachments: [
            { type: 'doc', doc: { ext: 'pdf', url: 'd', title: 'счёт.pdf' } },
          ],
        }),
      ),
    ).toMatchObject({ kind: 'document', ext: 'pdf', name: 'счёт.pdf' });
  });

  it('ссылки и пересланное — в текст, прочее без текста — ярлыком', () => {
    expect(
      inboundText(
        msg({
          text: 'смотри',
          attachments: [{ type: 'link', link: { url: 'https://a.ru' } }],
        }),
        null,
      ),
    ).toBe('смотри https://a.ru');
    expect(
      inboundText(
        msg({ text: 'вот', fwd_messages: [msg({ text: 'вопрос?' })] }),
        null,
      ),
    ).toBe('вот вопрос?');
    expect(
      inboundText(msg({ attachments: [{ type: 'geo', geo: {} }] }), null),
    ).toBe('[геопозиция]');
    expect(
      inboundText(msg({ attachments: [{ type: 'poll2', poll2: {} }] }), null),
    ).toBe('[вложение: poll2]');
  });

  it('пересланное голосовое без слов поднимается как своё', () => {
    const fwd = msg({
      fwd_messages: [
        msg({ attachments: [{ type: 'audio_message', audio_message: {} }] }),
      ],
    });
    expect(liftForwardedVoice(fwd).attachments?.[0].type).toBe('audio_message');
    const withText = msg({ text: 'послушай', fwd_messages: fwd.fwd_messages });
    expect(liftForwardedVoice(withText)).toBe(withText);
  });
});

describe('Long Poll', () => {
  const server = { server: 'api.vk.com/gim1', key: 'k', ts: 100, pts: 50 };

  it('a_check двигает курсор и отдаёт события', async () => {
    const { api, calls } = fakeApi({ 'messages.getLongPollServer': [server] }, [
      { ts: 101, pts: 51, updates: [[10004, 1]] },
    ]);
    const lp = new VkLongPoll(api, null, silent);
    const b = await lp.next();
    expect(b.updates).toEqual([[10004, 1]]);
    expect(b.cursor).toEqual({ ts: 101, pts: 51 });
    expect(calls[1][1]).toMatchObject({
      act: 'a_check',
      key: 'k',
      ts: 100,
      mode: 234,
      version: 21,
    });
  });

  it('за простой догружает пропущенное по сохранённому курсору', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vk-lp-'));
    const file = new CursorFile(join(dir, '1.json'));
    file.write({ ts: 90, pts: 40 });
    const item = {
      id: 5,
      peer_id: 555,
      conversation_message_id: 3,
      date: 1,
      text: 'пока бот лежал',
    };
    const { api, calls } = fakeApi({
      'messages.getLongPollServer': [server],
      'messages.getLongPollHistory': [
        { messages: { items: [item] }, new_pts: 50 },
      ],
    });
    const lp = new VkLongPoll(api, file, silent);
    const b = await lp.next();
    expect(b.missed).toEqual([item]);
    expect(calls[1][1]).toMatchObject({ ts: 90, pts: 40 });
  });

  it('failed=2 — только новый ключ; failed=1 — новый сервер и догрузка', async () => {
    const { api, calls } = fakeApi(
      {
        'messages.getLongPollServer': [
          server,
          { ...server, key: 'k2', ts: 999 },
          { ...server, key: 'k3', ts: 1000, pts: 60 },
        ],
        'messages.getLongPollHistory': [
          { messages: { items: [] }, new_pts: 60 },
        ],
      },
      [{ failed: 2 }, { failed: 1 }],
    );
    const lp = new VkLongPoll(api, null, silent);
    await lp.next();
    expect(lp.position()).toEqual({ ts: 100, pts: 50 });
    await lp.next();
    expect(lp.position()).toEqual({ ts: 1000, pts: 60 });
    await lp.next();
    const history = calls.find(([m]) => m === 'messages.getLongPollHistory');
    expect(history?.[1]).toMatchObject({ ts: 100, pts: 50 });
  }, 15_000);

  it('failed=4 — ошибка, а не тихий откат на другую версию', async () => {
    const { api } = fakeApi({ 'messages.getLongPollServer': [server] }, [
      { failed: 4 },
    ]);
    await expect(
      new VkLongPoll(api, null, silent).next(),
    ).rejects.toBeInstanceOf(VkApiError);
  });

  it('курсор на диск — только когда пачка и все прежние приняты', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vk-lp-'));
    const file = new CursorFile(join(dir, '1.json'));
    const c = new CursorCommitter(file);
    const doneA = c.open({ ts: 1, pts: 10 }, 1);
    const doneB = c.open({ ts: 2, pts: 20 }, 1);
    doneB();
    expect(file.read()).toBeNull();
    doneA();
    expect(file.read()).toEqual({ ts: 2, pts: 20 });
    c.open({ ts: 3, pts: 30 }, 0);
    expect(file.read()).toEqual({ ts: 3, pts: 30 });
  });
});

describe('исходящие VK', () => {
  it('random_id сворачивается в int32 детерминированно', () => {
    const k = '9007199254740993123';
    expect(foldRandomId(k)).toBe(foldRandomId(k));
    expect(foldRandomId(k)).toBeGreaterThan(0);
    expect(foldRandomId(k)).toBeLessThanOrEqual(2147483647);
  });

  it('отправка отдаёт cmid и помнит своё эхо', async () => {
    const { api, calls } = fakeApi({
      'messages.send': [{ cmid: 21, message_id: 47 }],
    });
    const m = new VkMessages(api);
    expect(await m.send(555, { message: 'привет' }, { randomId: '123' })).toBe(
      21,
    );
    expect(calls[0][1]).toMatchObject({
      peer_id: 555,
      random_id: foldRandomId('123'),
      message: 'привет',
    });
    expect(m.isOwnEcho(foldRandomId('123'))).toBe(true);
  });

  it('обрыв на отправке: нашли своё по random_id — второй раз не шлём', async () => {
    const key = foldRandomId('7');
    const { api, calls } = fakeApi({
      'messages.send': [new VkApiError(0, 'HTTP 504')],
      'messages.getHistory': [
        { items: [{ out: 1, random_id: key, conversation_message_id: 33 }] },
      ],
    });
    expect(
      await new VkMessages(api).send(555, { message: 'x' }, { randomId: '7' }),
    ).toBe(33);
    expect(calls.filter(([m]) => m === 'messages.send')).toHaveLength(1);
  });

  it('ответ VK с кодом — без поиска и повтора', async () => {
    const { api, calls } = fakeApi({
      'messages.send': [new VkApiError(902, 'privacy')],
    });
    await expect(
      new VkMessages(api).send(555, { message: 'x' }),
    ).rejects.toThrow('902');
    expect(calls).toHaveLength(1);
  });

  it('реакции по таблице, вложение с access_key', async () => {
    const { api, calls } = fakeApi({ 'messages.sendReaction': [1] });
    await new VkMessages(api).react(555, 4, '👍');
    expect(calls[0]).toEqual([
      'messages.sendReaction',
      { peer_id: 555, cmid: 4, reaction_id: 4 },
    ]);
    await expect(new VkMessages(api).react(555, 4, '🦄')).rejects.toThrow(
      'не поддерживает',
    );
    expect(
      attachmentRef('photo', { owner_id: 1, id: 2, access_key: 'ak' }),
    ).toBe('photo1_2_ak');
  });
});
