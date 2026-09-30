import { TelegramService } from './telegram.service';
import { Api } from 'telegram';
import bigInt from 'big-integer';

function iterable<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}
function fixture(count = 1, perChat = 2) {
  const user = new Api.User({ id: bigInt(100), firstName: 'Test' });
  const messages = Array.from(
    { length: perChat },
    (_, i) =>
      new Api.Message({
        id: 101 + i,
        date: 1000 + i,
        message: i ? 'Как тебе?' : 'Фото поездки',
        peerId: new Api.PeerUser({ userId: user.id }),
        ...(i ? {} : { media: new Api.MessageMediaPhoto({}) }),
      }),
  );
  const dialogs = Array.from({ length: count }, (_, i) => ({
    isUser: true,
    entity: new Api.User({ id: bigInt(100 + i), firstName: 'Test' }),
    unreadCount: perChat,
    dialog: {},
  }));
  const account = {
    id: 1,
    client: {
      iterDialogs: () => iterable(dialogs),
      iterMessages: jest.fn(() => iterable([...messages].reverse())),
    },
  };
  const release = jest.fn(),
    turns: any[] = [];
  const service: any = Object.create(TelegramService.prototype);
  Object.assign(service, {
    stopping: false,
    log: { error: jest.fn() },
    call: async (_a, _n, fn) => fn(),
    ownedByOther: async () => null,
    rememberPeer: async () => {},
    history: {
      latestSourceMessageId: async () => 0,
      lastStoredRole: async () => null,
      markTelegramRead: async () => {},
    },
    downloadMedia: jest.fn(async (_a, m) =>
      m.media ? { kind: 'photo', path: '/synthetic/photo.jpg' } : null,
    ),
    brain: {
      observeIncoming: () => release,
      answerAfterResume: jest.fn(),
      handleInbound: jest.fn(async (t) => {
        turns.push(t);
      }),
    },
  });
  return { service, account, turns, release };
}
it('preserves every Telegram ID, timestamp and photo before the following text', async () => {
  const { service, account, turns, release } = fixture();
  await service.catchUp(account);
  expect(turns.map((t) => [t.messageId, t.ts])).toEqual([
    [101, 1000],
    [102, 1001],
  ]);
  expect(turns[0].media.path).toBe('/synthetic/photo.jpg');
  expect(turns[1].media).toBeNull();
  expect(release).toHaveBeenCalledTimes(1);
});
it('does not truncate catch-up at 50 dialogs or 20 messages', async () => {
  const { service, account, turns } = fixture(51, 21);
  await service.catchUp(account);
  expect(turns).toHaveLength(51 * 21);
});
it('holds and releases the batch even if a message fails', async () => {
  const { service, account, release } = fixture();
  service.brain.handleInbound.mockRejectedValueOnce(Error('db failed'));
  await service.catchUp(account);
  expect(release).toHaveBeenCalledTimes(1);
  expect(service.log.error).toHaveBeenCalled();
});
