import { appConfig } from 'src/config/app.config';
import { BalanceAlertService, lowText } from './balance-alert.service';
import type { OpenRouterBalance } from './balance.service';

const balance = (
  left: number | null,
  extra: Partial<OpenRouterBalance> = {},
): OpenRouterBalance => ({
  total: 1000,
  spent: left === null ? null : 1000 - left,
  left,
  today: 40,
  week: null,
  month: null,
  days_left: left === null ? null : Math.round((left / 40) * 10) / 10,
  checked_at: 0,
  error: null,
  ...extra,
});

describe('предупреждение о балансе OpenRouter', () => {
  const saved = { ...appConfig.balanceAlert };
  let now = 1_000_000;
  let current: OpenRouterBalance;
  let sent: Array<{ url: string; body: any }>;
  let svc: BalanceAlertService;
  const fetchMock = jest.fn();

  beforeEach(() => {
    Object.assign(appConfig.balanceAlert, {
      threshold: 300,
      repeatHours: 12,
      chatId: '-1001',
      botToken: 'T',
    });
    now = 1_000_000;
    sent = [];
    fetchMock
      .mockReset()
      .mockImplementation(async (url: string, init: { body: string }) => {
        sent.push({ url, body: JSON.parse(init.body) });
        return { ok: true, json: async () => ({ ok: true }) };
      });
    (global as any).fetch = fetchMock;
    svc = new BalanceAlertService(
      { openRouter: async () => current } as any,
      { ts: () => now } as any,
    );
  });

  afterAll(() => Object.assign(appConfig.balanceAlert, saved));

  it('ниже порога — одно сообщение в группу, повтор не раньше чем через 12 часов', async () => {
    current = balance(250);
    expect(await svc.check()).toBe('low');
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://api.telegram.org/botT/sendMessage');
    expect(sent[0].body.chat_id).toBe('-1001');
    expect(sent[0].body.text).toContain('осталось $250.00');
    now += 11 * 3600;
    expect(await svc.check()).toBeNull();
    now += 3600;
    expect(await svc.check()).toBe('low');
    expect(sent[1].body.text).toContain('Напоминание');
  });

  it('после пополнения — сообщение «пополнен», дальше тишина', async () => {
    current = balance(120);
    await svc.check();
    current = balance(900);
    expect(await svc.check()).toBe('recovered');
    expect(sent[1].body.text).toContain('пополнен: на счёте $900.00');
    expect(await svc.check()).toBeNull();
    expect(sent).toHaveLength(2);
  });

  it('выше порога с самого начала — ничего не пишет', async () => {
    current = balance(301);
    expect(await svc.check()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('порог берётся из настройки', async () => {
    appConfig.balanceAlert.threshold = 1000;
    current = balance(900);
    expect(await svc.check()).toBe('low');
    expect(sent[0].body.text).toContain('ниже $1000.00');
  });

  it('баланс не прочитался — ни тревоги, ни «пополнен»', async () => {
    current = balance(100);
    await svc.check();
    current = balance(null, { error: 'OpenRouter не ответил' });
    expect(await svc.check()).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('без чата или токена молчит', async () => {
    appConfig.balanceAlert.chatId = '';
    current = balance(10);
    await svc.tick();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Telegram отказал — ошибка, а состояние не меняется: следующая проверка попробует снова', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        ok: false,
        description: 'Forbidden: bot is not a member',
      }),
    }));
    current = balance(100);
    await expect(svc.check()).rejects.toThrow('bot is not a member');
    expect(await svc.check()).toBe('low');
  });

  it('текст: дни запаса и расход за сегодня', () => {
    const text = lowText(balance(200), 300, false);
    expect(text).toContain('хватит примерно на 5 дн.');
    expect(text).toContain('Расход за сегодня: $40.00');
  });
});
