import sharp from 'sharp';
import { appConfig } from 'src/config/app.config';
import { RATE_LIMIT, SupportService } from './support.service';

const author = { id: 7, username: 'manager1', role: 'manager' };
let now = 1_700_000_000;
const svc = () => new SupportService({ ts: () => now } as any);

async function png(): Promise<Buffer> {
  return sharp({
    create: { width: 2, height: 2, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
}

describe('поддержка', () => {
  const saved = {
    token: appConfig.supportBotToken,
    chat: appConfig.supportChatId,
  };
  beforeEach(() => {
    (appConfig as any).supportBotToken = 'token';
    (appConfig as any).supportChatId = '-100123';
  });
  afterAll(() => {
    (appConfig as any).supportBotToken = saved.token;
    (appConfig as any).supportChatId = saved.chat;
  });

  it('без настроек отвечает 503, не трогая Telegram', async () => {
    (appConfig as any).supportBotToken = '';
    const call = jest.fn();
    await expect(
      svc().send(author, { text: 'x', files: [] }, call),
    ).rejects.toMatchObject({ status: 503 });
    expect(call).not.toHaveBeenCalled();
  });

  it('текст уходит одним сообщением с подписью кто и откуда', async () => {
    const call = jest.fn<Promise<unknown>, [string, any]>(async () => ({}));
    await svc().send(
      author,
      { text: 'Не работает кнопка', page: '/conversation/5', files: [] },
      call,
    );
    const [method, payload] = call.mock.calls[0];
    expect(method).toBe('sendMessage');
    expect(payload).toMatchObject({ chat_id: '-100123' });
    expect((payload as any).text).toContain('manager1 (manager)');
    expect((payload as any).text).toContain('Страница: /conversation/5');
    expect((payload as any).text).toContain('Не работает кнопка');
    expect((payload as any).parse_mode).toBeUndefined();
  });

  it('подозрительная страница не попадает в сообщение', async () => {
    const call = jest.fn<Promise<unknown>, [string, any]>(async () => ({}));
    await svc().send(
      author,
      { text: 'x', page: 'javascript:alert(1)', files: [] },
      call,
    );
    expect((call.mock.calls[0][1] as any).text).toContain(
      'Страница: (не передана)',
    );
  });

  it('скриншоты уходят альбомом, подпись на первом', async () => {
    const call = jest.fn<Promise<unknown>, [string, any]>(async () => ({}));
    const buffer = await png();
    await svc().send(
      author,
      {
        text: 'скрин',
        files: [{ buffer, mimetype: 'image/png', size: buffer.length }],
      },
      call,
    );
    const [method, form] = call.mock.calls[0];
    expect(method).toBe('sendMediaGroup');
    const media = JSON.parse((form as FormData).get('media') as string);
    expect(media[0]).toMatchObject({ type: 'photo', media: 'attach://file0' });
    expect(media[0].caption).toContain('скрин');
    expect((form as FormData).get('file0')).toBeInstanceOf(Blob);
  });

  it('файл с чужим содержимым под видом png отклоняется', async () => {
    const call = jest.fn();
    const fake = Buffer.from('<script>alert(1)</script>');
    await expect(
      svc().send(
        author,
        {
          text: 'x',
          files: [{ buffer: fake, mimetype: 'image/png', size: fake.length }],
        },
        call,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(call).not.toHaveBeenCalled();
  });

  it('пустой текст, слишком длинный текст и лишние файлы — 422', async () => {
    const call = jest.fn();
    const s = svc();
    await expect(
      s.send(author, { text: '   ', files: [] }, call),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      s.send(author, { text: 'x'.repeat(4001), files: [] }, call),
    ).rejects.toMatchObject({ status: 422 });
    const buffer = await png();
    const six = Array.from({ length: 6 }, () => ({
      buffer,
      mimetype: 'image/png',
      size: buffer.length,
    }));
    await expect(
      s.send(author, { text: 'x', files: six }, call),
    ).rejects.toMatchObject({ status: 422 });
    expect(call).not.toHaveBeenCalled();
  });

  it('после лимита обращений за окно — 429, окно сдвигается со временем', async () => {
    const call = jest.fn<Promise<unknown>, [string, any]>(async () => ({}));
    const s = svc();
    for (let i = 0; i < RATE_LIMIT.count; i++)
      await s.send(author, { text: 'x', files: [] }, call);
    await expect(
      s.send(author, { text: 'x', files: [] }, call),
    ).rejects.toMatchObject({ status: 429 });
    now += RATE_LIMIT.windowS + 1;
    await expect(
      s.send(author, { text: 'x', files: [] }, call),
    ).resolves.toEqual({ ok: true });
  });
});
