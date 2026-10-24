import { validateJudgment } from './validate';

const judge = (value: Record<string, unknown>) =>
  validateJudgment(
    value,
    new Set(),
    new Set(),
    new Set(),
    new Set(),
    'скинь фотку',
  );

describe('validateJudgment: просьба прислать медиа', () => {
  it('голосовое, фото, кружок и видео принимаются как есть', () => {
    for (const kind of ['voice', 'photo', 'video_note', 'video'])
      expect(judge({ media_request: kind }).media_request).toBe(kind);
  });

  it('пусто, мусор или другой тип — просьбы нет, бот отвечает сам', () => {
    expect(judge({}).media_request).toBe('');
    expect(judge({ media_request: 'sticker' }).media_request).toBe('');
    expect(judge({ media_request: true }).media_request).toBe('');
  });
});
