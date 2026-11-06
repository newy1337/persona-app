import {
  messengerOf,
  unknownFields,
  usernameFrom,
  withContactAliases,
} from './inbound-fields';

describe('ник из тела входящего лида', () => {
  it('username в приоритете, иначе — распространённые варианты поля', () => {
    expect(usernameFrom({ username: '@a', tg: '@b' })).toBe('@a');
    expect(usernameFrom({ tg: '@durov' })).toBe('@durov');
    expect(usernameFrom({ telegram: ' durov ' })).toBe('durov');
    expect(usernameFrom({ tg_username: 'durov' })).toBe('durov');
    expect(usernameFrom({ telegramUsername: 'durov' })).toBe('durov');
  });

  it('пустые и не строки пропускаются', () => {
    expect(usernameFrom({ username: '  ', tg: 'durov' })).toBe('durov');
    expect(usernameFrom({ tg: 123 })).toBeUndefined();
    expect(usernameFrom(null)).toBeUndefined();
  });

  it('неизвестные поля видно, ник под другим именем к ним не относится', () => {
    expect(
      unknownFields({ phone: '1', tg: 'x', foo: 1, bar: 2 }, [
        'phone',
        'source',
      ]),
    ).toEqual(['bar', 'foo']);
    expect(unknownFields([1], ['phone'])).toEqual([]);
  });
});

describe('мессенджер и ник под другими именами', () => {
  it('название мессенджера в любом регистре и по-русски; чужое — null', () => {
    expect(messengerOf('VK')).toBe('vk');
    expect(messengerOf(' вконтакте ')).toBe('vk');
    expect(messengerOf('tg')).toBe('telegram');
    expect(messengerOf('Телеграм')).toBe('telegram');
    expect(messengerOf('max')).toBeNull();
    expect(messengerOf(1)).toBeNull();
  });

  it('ник из tg доживает до проверки тела без телефона', () => {
    expect(withContactAliases({ tg: '@durov' })).toMatchObject({
      username: '@durov',
    });
    expect(withContactAliases({ username: 'a', tg: 'b' })).toMatchObject({
      username: 'a',
    });
  });

  it('холодка: channel — в messenger, поле vk — ник VK и мессенджер VK', () => {
    expect(withContactAliases({ channel: 'vk' }, { messenger: true })).toEqual({
      channel: 'vk',
      messenger: 'vk',
    });
    expect(
      withContactAliases({ vk: 123, tg: 'durov_tg' }, { messenger: true }),
    ).toMatchObject({ username: '123', messenger: 'vk' });
    // мессенджер назван Telegram — поле vk не перебивает ник из tg
    expect(
      withContactAliases(
        { vk: 'ivan', tg: 'durov_tg', messenger: 'telegram' },
        { messenger: true },
      ),
    ).toMatchObject({ username: 'durov_tg', messenger: 'telegram' });
    // без флага поле vk не трогаем
    expect(withContactAliases({ vk: 'ivan' })).toEqual({ vk: 'ivan' });
  });
});
