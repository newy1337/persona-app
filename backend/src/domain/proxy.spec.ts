import { proxyLabel, toClientProxy, toProxyUrl } from './proxy';

describe('прокси аккаунта для Telegram-клиента', () => {
  it('SOCKS5 и SOCKS4 с логином', () => {
    expect(
      toClientProxy({
        type: 'socks5',
        host: ' 1.2.3.4 ',
        port: 1080,
        username: 'u',
        password: 'p',
      }),
    ).toEqual({
      ip: '1.2.3.4',
      port: 1080,
      socksType: 5,
      username: 'u',
      password: 'p',
      timeout: 15,
    });
    expect(
      toClientProxy({ type: 'socks4', host: '1.2.3.4', port: 1080 }),
    ).toMatchObject({ socksType: 4 });
  });

  it('MTProto с секретом', () => {
    expect(
      toClientProxy({
        type: 'mtproto',
        host: 'mt.example.com',
        port: 443,
        secret: 'ee00',
      }),
    ).toEqual({
      ip: 'mt.example.com',
      port: 443,
      MTProxy: true,
      secret: 'ee00',
      timeout: 15,
    });
    expect(() =>
      toClientProxy({ type: 'mtproto', host: 'mt.example.com', port: 443 }),
    ).toThrow(/secret/);
  });

  it('HTTP и кривой порт — ошибка, а не подключение напрямую', () => {
    expect(() =>
      toClientProxy({ type: 'http', host: '1.2.3.4', port: 3128 }),
    ).toThrow(/SOCKS5/);
    expect(() =>
      toClientProxy({ type: 'socks5', host: '1.2.3.4', port: 0 }),
    ).toThrow(/порт/);
  });

  it('прокси не задан — подключение без него', () => {
    expect(toClientProxy(null)).toBeNull();
  });

  it('подпись для панели — без пароля и секрета', () => {
    expect(
      proxyLabel({
        type: 'socks5',
        host: '1.2.3.4',
        port: 1080,
        username: 'u',
        password: 'secret-pass',
      }),
    ).toBe('socks5 1.2.3.4:1080 · u');
    expect(
      proxyLabel({
        type: 'mtproto',
        host: 'mt.example.com',
        port: 443,
        secret: 'ee00',
      }),
    ).toBe('mtproto mt.example.com:443');
    expect(proxyLabel(null)).toBeNull();
  });
});

describe('прокси VK', () => {
  it('адрес с логином; без прокси и с MTProto — ошибка', () => {
    expect(
      toProxyUrl({
        type: 'http',
        host: '1.2.3.4',
        port: 8080,
        username: 'u@x',
        password: 'p:w',
      }),
    ).toBe('http://u%40x:p%3Aw@1.2.3.4:8080');
    expect(toProxyUrl({ type: 'socks5', host: 'h', port: 1080 })).toBe(
      'socks5://h:1080',
    );
    expect(() => toProxyUrl(null)).toThrow('нет прокси');
    expect(() => toProxyUrl({ type: 'mtproto', host: 'h', port: 1 })).toThrow(
      'не поддерживает',
    );
  });
});
