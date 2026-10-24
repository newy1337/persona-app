import { accountContact, chatChannel, clientContact } from './contact';
import { chatIdFor } from './ids';

describe('ссылки на собеседника и аккаунт по каналу', () => {
  it('Telegram: @ник → t.me, без ника — нет ссылки', () => {
    expect(chatChannel(555)).toBe('telegram');
    expect(clientContact(555, 'ira')).toEqual({
      display: '@ira',
      url: 'https://t.me/ira',
    });
    expect(clientContact(555, null)).toBeNull();
    expect(accountContact('telegram', '@acc')).toEqual({
      display: '@acc',
      url: 'https://t.me/acc',
    });
  });

  it('VK: ник или idN → vk.com; контакт по номеру без ника — без ссылки', () => {
    const chat = chatIdFor('vk', 555);
    expect(chatChannel(chat)).toBe('vk');
    expect(clientContact(chat, null)).toEqual({
      display: 'id555',
      url: 'https://vk.com/id555',
    });
    expect(clientContact(chat, 'durov')).toEqual({
      display: 'durov',
      url: 'https://vk.com/durov',
    });
    expect(clientContact(chatIdFor('vk', 1_900_000_005), null)).toBeNull();
    expect(accountContact('vk', null, 77n)).toEqual({
      display: 'id77',
      url: 'https://vk.com/id77',
    });
    expect(accountContact('vk', null, null)).toBeNull();
  });
});
