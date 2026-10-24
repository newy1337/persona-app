import { VK_CHAT_BASE, chatIdFor, isChannel, peerOf } from './ids';

describe('сквозной id чата по каналам', () => {
  it('Telegram: chat_id — это id пользователя, как и было', () => {
    expect(chatIdFor('telegram', 7026943193)).toBe(7026943193);
    expect(peerOf(7026943193)).toEqual({
      channel: 'telegram',
      peerId: 7026943193,
    });
    expect(peerOf(BigInt(7026943193))).toEqual({
      channel: 'telegram',
      peerId: 7026943193,
    });
  });

  it('VK: своя полоса, туда и обратно без потерь', () => {
    const chat = chatIdFor('vk', 123456789);
    expect(chat).toBe(VK_CHAT_BASE + 123456789);
    expect(Number.isSafeInteger(chat)).toBe(true);
    expect(peerOf(chat)).toEqual({ channel: 'vk', peerId: 123456789 });
  });

  it('полосы не пересекаются: самый большой id Telegram ниже полосы VK', () => {
    expect(2 ** 52).toBeLessThan(VK_CHAT_BASE);
    expect(() => chatIdFor('telegram', VK_CHAT_BASE)).toThrow(/вне полосы/);
  });

  it('мусор не превращается в чат', () => {
    expect(() => chatIdFor('vk', 0)).toThrow();
    expect(() => chatIdFor('telegram', -5)).toThrow();
    expect(isChannel('vk')).toBe(true);
    expect(isChannel('whatsapp')).toBe(false);
  });
});
