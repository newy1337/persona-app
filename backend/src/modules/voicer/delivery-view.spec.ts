import { deliveryView } from './voicer-delivery.service';

const row = (pendingReply: object | null) =>
  ({
    id: 1,
    recordingId: 2,
    chatId: 6000000475468578n,
    createdAt: 10,
    pendingReply,
  }) as never;

describe('карточка отправки голосового', () => {
  it('дошло со второй попытки — ошибки первой на карточке нет', () => {
    expect(
      deliveryView(
        row({
          status: 'sent',
          error: 'VkApiError: загрузка HTTP 504',
          sentTs: 20,
        }),
      ),
    ).toMatchObject({ status: 'sent', error: null, sent_at: 20 });
  });

  it('не дошло — причина видна', () => {
    expect(
      deliveryView(row({ status: 'failed', error: 'нет связи', sentTs: null })),
    ).toMatchObject({ status: 'failed', error: 'нет связи' });
    expect(deliveryView(row(null))!.error).toContain('недоступна');
  });
});
