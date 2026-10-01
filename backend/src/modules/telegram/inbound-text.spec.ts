import { Api } from 'telegram';
import { inboundText } from './telegram.service';

const message = (over: Partial<Api.Message>) =>
  ({ message: '', ...over }) as Api.Message;

describe('текст входящего: вложение без подписи не должно стать пустым пузырём', () => {
  it('обычный текст отдаётся как есть', () => {
    expect(inboundText(message({ message: 'привет' }), null)).toBe('привет');
  });

  it('подпись к распознанному вложению не трогаем — метку ставит мозг', () => {
    expect(
      inboundText(message({ message: '' }), { kind: 'photo' } as any),
    ).toBe('');
  });

  it('геопозиция без подписи получает человеческую метку', () => {
    const geo = new Api.MessageMediaGeo({ geo: new Api.GeoPointEmpty() });
    expect(inboundText(message({ message: '', media: geo }), null)).toBe(
      '[геопозиция]',
    );
  });

  it('контакт и опрос тоже', () => {
    const contact = new Api.MessageMediaContact({
      phoneNumber: '+70000000000',
      firstName: 'И',
      lastName: '',
      vcard: '',
      userId: BigInt(1) as any,
    });
    expect(inboundText(message({ message: '', media: contact }), null)).toBe(
      '[контакт]',
    );
  });

  it('неизвестный вид называет себя сам — по нему и добавим поддержку', () => {
    const exotic = {
      className: 'MessageMediaPaidMedia',
    } as unknown as Api.TypeMessageMedia;
    expect(inboundText(message({ message: '', media: exotic }), null)).toBe(
      '[вложение: MessageMediaPaidMedia]',
    );
  });

  it('пустое сообщение без вложения остаётся пустым: придумывать нечего', () => {
    expect(inboundText(message({ message: '' }), null)).toBe('');
  });
});
