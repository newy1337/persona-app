import { TelegramService } from './telegram.service';
import { Api } from 'telegram';
import bigInt from 'big-integer';

function fixture() {
  const service: any = Object.create(TelegramService.prototype);
  const seen: any[] = [];
  Object.assign(service, {
    localSends: new Map(),
    sentHere: new Map(),
    outgoingImports: new Map(),
    ownedByOther: async () => null,
    clock: { ts: () => 1000 },
    prisma: {
      message: {
        findFirst: async ({ where }) =>
          seen.find((m) => m.tgMsgId === where.tgMsgId),
      },
    },
    history: {
      ensureContact: jest.fn(),
      setBlockedByClient: jest.fn(async () => {}),
      appendMessage: jest.fn(async (_c, m) => {
        seen.push(m);
      }),
    },
    brain: {
      observeIncoming: () => () => {},
      noteOperatorQueued: jest.fn(),
      noteOperatorMessage: jest.fn(),
    },
    downloadMedia: async () => null,
  });
  const account = { id: 1, telegramUserId: 999 };
  const message = new Api.Message({
    id: 55,
    date: 800,
    out: true,
    message: 'Завтра в шесть',
    peerId: new Api.PeerUser({ userId: bigInt(123) }),
  });
  return { service, account, message, seen };
}
it('imports a phone/Desktop message once with its original timestamp and cancels the old bot draft', async () => {
  const { service, account, message, seen } = fixture();
  await Promise.all([
    service.importOutgoing(account, message),
    service.importOutgoing(account, message),
  ]);
  await service.importOutgoing(account, message);
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({
    author: 'operator:telegram',
    ts: 800,
    tgMsgId: 55,
    text: 'Завтра в шесть',
  });
  expect(service.brain.noteOperatorQueued).toHaveBeenCalledTimes(1);
  expect(service.brain.noteOperatorMessage).toHaveBeenCalledTimes(1);
});
it('waits for the own RPC identity and does not mistake its echo for a manager reply', async () => {
  const { service, account, message, seen } = fixture();
  let finish: (value: any) => void;
  const sending = service.deliver(
    123,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const importing = service.importOutgoing(account, message);
  finish!({ id: 55 });
  await Promise.all([sending, importing]);
  expect(seen).toHaveLength(0);
  expect(service.brain.noteOperatorQueued).not.toHaveBeenCalled();
});
it('does not import another account conversation into this account memory', async () => {
  const { service, account, message, seen } = fixture();
  service.ownedByOther = async () => 7;
  await service.importOutgoing(account, message);
  expect(seen).toHaveLength(0);
});
