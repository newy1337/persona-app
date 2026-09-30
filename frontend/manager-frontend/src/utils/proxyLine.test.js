import { describe, it, expect } from 'vitest';
import { parseProxyLine } from './proxyLine';

const p = (line) => parseProxyLine(line).proxy;

describe('прокси одной строкой', () => {
  it('без схемы — SOCKS5, самые частые форматы продавцов', () => {
    expect(p('1.2.3.4:1080')).toMatchObject({ type: 'socks5', host: '1.2.3.4', port: '1080', username: '', password: '' });
    expect(p('1.2.3.4:1080:user:pass')).toMatchObject({ type: 'socks5', host: '1.2.3.4', port: '1080', username: 'user', password: 'pass' });
    expect(p('user:pass:1.2.3.4:1080')).toMatchObject({ host: '1.2.3.4', port: '1080', username: 'user', password: 'pass' });
    expect(p('user:pass@1.2.3.4:1080')).toMatchObject({ host: '1.2.3.4', port: '1080', username: 'user', password: 'pass' });
    expect(p('1.2.3.4:1080@user:pass')).toMatchObject({ host: '1.2.3.4', port: '1080', username: 'user', password: 'pass' });
  });

  it('ссылки со схемой', () => {
    expect(p('socks5://user:p%40ss@proxy.example.com:9050')).toMatchObject({
      type: 'socks5', host: 'proxy.example.com', port: '9050', username: 'user', password: 'p@ss',
    });
    expect(p('socks5h://1.2.3.4:1080/')).toMatchObject({ type: 'socks5', host: '1.2.3.4' });
    expect(p('socks4://1.2.3.4:1080')).toMatchObject({ type: 'socks4' });
  });

  it('пароль с двоеточием не рвётся', () => {
    expect(p('1.2.3.4:1080:user:pa:ss')).toMatchObject({ username: 'user', password: 'pa:ss' });
  });

  it('MTProto из ссылки Telegram', () => {
    expect(p('tg://proxy?server=mt.example.com&port=443&secret=ee0123abcd')).toMatchObject({
      type: 'mtproto', host: 'mt.example.com', port: '443', secret: 'ee0123abcd',
    });
    expect(p('https://t.me/proxy?server=1.2.3.4&port=8443&secret=dd00')).toMatchObject({ type: 'mtproto', port: '8443' });
  });

  it('HTTP не принимается: Telegram-клиент его не умеет, поля не заполняются', () => {
    const r = parseProxyLine('http://user:pass@1.2.3.4:3128');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HTTP.*SOCKS5/);
    expect(parseProxyLine('https://1.2.3.4:3128').ok).toBe(false);
  });

  it('мусор — понятная ошибка, а не пустые поля', () => {
    expect(parseProxyLine('').ok).toBe(false);
    expect(parseProxyLine('просто текст').error).toMatch(/хост:порт/);
    expect(parseProxyLine('1.2.3.4:99999').ok).toBe(false);
    expect(parseProxyLine('ftp://1.2.3.4:21').error).toMatch(/ftp/);
    expect(parseProxyLine('tg://proxy?server=1.2.3.4&port=443').error).toMatch(/secret/);
  });
});
