import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { transcribeFile, TranscribeError } from './transcribe';

const ok = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, statusText: '', json: async () => body }) as any;

describe('расшифровка голосовых', () => {
  let dir: string;
  let file: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'stt-'));
    file = join(dir, 'voice.ogg');
    writeFileSync(file, Buffer.from('OggS fake'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('шлёт файл, модель и язык; текст и расход — назад', async () => {
    const calls: any[] = [];
    const record = jest.fn();
    const text = await transcribeFile(file, {
      apiKey: 'sk-test',
      model: 'gpt-4o-mini-transcribe',
      language: 'ru',
      fetch: (async (url: string, init: any) => {
        calls.push({ url, init });
        return ok({
          text: ' привет, как дела ',
          usage: { type: 'tokens', input_tokens: 120, output_tokens: 8 },
        });
      }) as any,
      usage: { record },
    });
    expect(text).toBe('привет, как дела');
    expect(calls[0].url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(calls[0].init.headers.authorization).toBe('Bearer sk-test');
    const form = calls[0].init.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(form.get('language')).toBe('ru');
    expect((form.get('file') as File).name).toBe('voice.ogg');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        stage: 'transcribe',
        inputTokens: 120,
        outputTokens: 8,
      }),
    );
  });

  it('обрыв сети и 5xx повторяются; 401 — сразу ошибка', async () => {
    let n = 0;
    const text = await transcribeFile(file, {
      apiKey: 'k',
      model: 'm',
      fetch: (async () => {
        n += 1;
        if (n === 1) throw new TypeError('fetch failed');
        if (n === 2) return ok({ error: { message: 'busy' } }, 503);
        return ok({ text: 'ок' });
      }) as any,
    });
    expect(text).toBe('ок');
    expect(n).toBe(3);

    let m = 0;
    const err = await transcribeFile(file, {
      apiKey: 'k',
      model: 'm',
      fetch: (async () => {
        m += 1;
        return ok({ error: { message: 'Incorrect API key' } }, 401);
      }) as any,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TranscribeError);
    expect(err.message).toMatch(/401: Incorrect API key/);
    expect(m).toBe(1);
  });
});
