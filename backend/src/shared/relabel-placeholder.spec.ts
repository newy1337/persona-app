import { HistoryService } from './history.service';

describe('замена метки после докачки вложения', () => {
  const service = () => {
    const calls: any[] = [];
    const svc: any = Object.create(HistoryService.prototype);
    svc.prisma = {
      message: {
        updateMany: async (args: any) => {
          calls.push(args);
          return { count: 1 };
        },
      },
    };
    return { svc, calls };
  };

  it('голосовое получает человеческую подпись', async () => {
    const { svc, calls } = service();
    await svc.relabelPlaceholder(111, 42, 'voice');
    expect(calls[0].data.text).toBe('[Голосовое сообщение]');
  });

  it('у файла своя подпись, у кружка своя', async () => {
    const { svc, calls } = service();
    await svc.relabelPlaceholder(111, 42, 'document');
    await svc.relabelPlaceholder(111, 43, 'video_note');
    expect(calls.map((c) => c.data.text)).toEqual(['[Файл]', '[Кружок]']);
  });

  it('неизвестный вид не остаётся техническим', async () => {
    const { svc, calls } = service();
    await svc.relabelPlaceholder(111, 42, 'что-то новое');
    expect(calls[0].data.text).toBe('[Вложение]');
  });

  it('трогаются только сообщения собеседника с меткой-заглушкой', async () => {
    const { svc, calls } = service();
    await svc.relabelPlaceholder(111, 42, 'voice');
    expect(calls[0].where).toMatchObject({
      sourceMessageId: 42,
      role: 'user',
      text: { startsWith: '[вложение:' },
    });
  });
});
