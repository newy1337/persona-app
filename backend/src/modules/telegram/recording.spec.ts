import { recordingMs } from './telegram.service';

describe('«записывает голосовое…» перед отправкой', () => {
  it('по длине записи, но не меньше 3 с и не больше 20 с', () => {
    expect(recordingMs(8)).toBe(8000);
    expect(recordingMs(0)).toBe(3000);
    expect(recordingMs(1)).toBe(3000);
    expect(recordingMs(95)).toBe(20000);
  });
});
