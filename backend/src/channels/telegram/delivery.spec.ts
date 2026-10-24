import { TelegramService } from './telegram.service';
import { Api } from 'telegram';
import bigInt from 'big-integer';
import { DEFAULT_TYPING } from 'src/domain/typing';

function setup() {
  const client = {
    getInputEntity: jest.fn(async () => new Api.InputPeerSelf()),
    invoke: jest.fn(),
    sendMessage: jest.fn(),
  };
  const service: any = Object.create(TelegramService.prototype);
  Object.assign(service, {
    accountFor: async () => ({ client, id: 1 }),
    call: async (_a, _n, work) => work(),
    deliver: async (_c, work) => work(),
    setTyping: jest.fn(),
  });
  return { service, client };
}
it('durable send preserves the exact 64-bit random ID on retries and maps Telegram acknowledgment', async () => {
  const { service, client } = setup();
  const randomId = '8223372036854775899';
  client.invoke.mockResolvedValue(
    new Api.Updates({
      updates: [
        new Api.UpdateMessageID({ id: 55, randomId: bigInt(randomId) }),
      ],
      users: [],
      chats: [],
      date: 1,
      seq: 1,
    }),
  );
  const onPart = jest.fn();
  for (let i = 0; i < 2; i++)
    expect(
      await service.sendText(1, ['**Привет**'], {
        typing: { ...DEFAULT_TYPING, enabled: false },
        randomIds: [randomId],
        onPart,
      }),
    ).toEqual([55]);
  expect(
    client.invoke.mock.calls.map(([req]) => req.randomId.toString()),
  ).toEqual([randomId, randomId]);
  expect(client.sendMessage).not.toHaveBeenCalled();
  expect(onPart).toHaveBeenCalledWith(0, 55);
});
it('checks cancellation after asynchronous peer resolution, immediately before dispatch', async () => {
  const { service, client } = setup();
  const controller = new AbortController();
  client.getInputEntity.mockImplementationOnce(async () => {
    controller.abort();
    return new Api.InputPeerSelf();
  });
  await expect(
    service.sendText(1, ['Привет'], {
      typing: { ...DEFAULT_TYPING, enabled: false },
      randomIds: ['44'],
      signal: controller.signal,
    }),
  ).rejects.toBeDefined();
  expect(client.invoke).not.toHaveBeenCalled();
});
it('never invokes the delivery callback for an unacknowledged send', async () => {
  const { service, client } = setup();
  client.invoke.mockResolvedValue(
    new Api.Updates({ updates: [], users: [], chats: [], date: 1, seq: 1 }),
  );
  const onPart = jest.fn();
  await expect(
    service.sendText(1, ['Привет'], {
      typing: { ...DEFAULT_TYPING, enabled: false },
      randomIds: ['44'],
      onPart,
    }),
  ).rejects.toThrow('не подтвердил');
  expect(onPart).not.toHaveBeenCalled();
});
it('persists the dispatch checkpoint after peer resolution and before the Telegram RPC', async () => {
  const { service, client } = setup();
  const order: string[] = [];
  client.getInputEntity.mockImplementationOnce(async () => {
    order.push('peer');
    return new Api.InputPeerSelf();
  });
  client.invoke.mockImplementationOnce(async () => {
    order.push('rpc');
    return new Api.UpdateShortSentMessage({
      id: 56,
      pts: 1,
      ptsCount: 1,
      date: 1,
      out: true,
    });
  });
  await service.sendText(1, ['Привет'], {
    typing: { ...DEFAULT_TYPING, enabled: false },
    randomIds: ['44'],
    onDispatch: async () => {
      order.push('checkpoint');
    },
    onPart: async () => {
      order.push('confirmed');
    },
  });
  expect(order).toEqual(['peer', 'checkpoint', 'rpc', 'confirmed']);
});
it('does not dispatch if the durable outbox checkpoint failed', async () => {
  const { service, client } = setup();
  await expect(
    service.sendText(1, ['Привет'], {
      typing: { ...DEFAULT_TYPING, enabled: false },
      randomIds: ['44'],
      onDispatch: async () => {
        throw new Error('database unavailable');
      },
    }),
  ).rejects.toThrow('database unavailable');
  expect(client.invoke).not.toHaveBeenCalled();
});
