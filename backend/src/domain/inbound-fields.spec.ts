import { unknownFields, usernameFrom } from './inbound-fields';

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
