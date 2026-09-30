import { VoiceEncoderService } from './voice-encoder.service';

describe('VoiceEncoderService', () => {
  const encoder = new VoiceEncoderService();

  it('ffprobe недоступен или файл не читается — отправляем исходник, ничего не удаляем', async () => {
    const file = await encoder.prepare('C:/нет/такого/файла.mp3');
    expect(file).toEqual({
      path: 'C:/нет/такого/файла.mp3',
      duration: 0,
      temporary: false,
    });
    expect(() => encoder.cleanup(file)).not.toThrow();
  });
});
