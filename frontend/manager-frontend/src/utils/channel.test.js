import { describe, expect, it } from 'vitest';
import { accountContact, channelBadge, clientContact, matchesChannel } from './channel';
import { parseProxyLine } from './proxyLine';

describe('канал и ссылки — от бэка', () => {
  it('VK: ссылки из contact/account_contact, t.me не собирается', () => {
    const row = { channel: 'vk', client_username: 'x', contact: { display: 'id42', url: 'https://vk.com/id42' }, account_contact: { display: 'acc', url: 'https://vk.com/acc' } };
    expect(clientContact(row)).toEqual({ display: 'id42', url: 'https://vk.com/id42' });
    expect(accountContact(row)).toEqual({ display: 'acc', url: 'https://vk.com/acc' });
    expect(channelBadge('vk')).toMatchObject({ label: 'VK', other: true });
  });

  it('старая форма без полей — Telegram, как было', () => {
    expect(clientContact({ client_username: 'ira' })).toEqual({ display: '@ira', url: 'https://t.me/ira' });
    expect(accountContact({ account_username: 'acc' })).toEqual({ display: '@acc', url: 'https://t.me/acc' });
    expect(channelBadge(undefined)).toMatchObject({ key: 'tg', other: false });
  });

  it('аккаунт из списка аккаунтов: ник VK → vk.com', () => {
    expect(accountContact({ channel: 'vk', username: 'durov' })).toEqual({ display: 'durov', url: 'https://vk.com/durov' });
  });

  it('фильтр канала', () => {
    expect(matchesChannel({ channel: 'telegram' }, 'tg')).toBe(true);
    expect(matchesChannel({ channel: 'vk' }, 'tg')).toBe(false);
    expect(matchesChannel({}, 'all')).toBe(true);
  });
});

describe('прокси по каналу', () => {
  it('VK: HTTP и строка без схемы — HTTP; MTProto нельзя', () => {
    expect(parseProxyLine('http://u:p@1.2.3.4:3128', { channel: 'vk' }).proxy).toMatchObject({ type: 'http', host: '1.2.3.4', port: '3128', username: 'u' });
    expect(parseProxyLine('1.2.3.4:3128:u:p', { channel: 'vk' }).proxy.type).toBe('http');
    expect(parseProxyLine('tg://proxy?server=a.b&port=1&secret=x', { channel: 'vk' }).ok).toBe(false);
  });

  it('Telegram: HTTP по-прежнему отказ', () => {
    expect(parseProxyLine('http://1.2.3.4:3128').ok).toBe(false);
    expect(parseProxyLine('1.2.3.4:1080').proxy.type).toBe('socks5');
  });
});
