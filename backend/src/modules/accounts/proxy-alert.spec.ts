import {
  type AccountProbe,
  disabledMessage,
  ProxyWatch,
  isProxyTrouble,
} from './proxy-alert';

const probe = (over: Partial<AccountProbe>): AccountProbe => ({
  id: 1,
  channel: 'telegram',
  login: '+79001112233',
  proxy: 'socks5 1.2.3.4:1080 · u',
  manager: 'Ivan',
  region: '737',
  online: false,
  reason: 'прокси не отвечает (connect ECONNREFUSED 1.2.3.4:1080)',
  ...over,
});

const msgs = (watch: ProxyWatch, probes: AccountProbe[], now: number) =>
  watch.step(probes, now).messages;

describe('предупреждения о нерабочих прокси', () => {
  it('прокси и связь — да; сессия, бан, пауза и запуск — нет', () => {
    expect(isProxyTrouble('прокси не отвечает (x)')).toBe(true);
    expect(isProxyTrouble('нет связи с Telegram или прокси (ETIMEDOUT)')).toBe(
      true,
    );
    expect(
      isProxyTrouble(
        'переподключается — прошлая попытка: Telegram не отвечает — переподключаемся',
      ),
    ).toBe(true);
    expect(isProxyTrouble('сессия завершена — нужно войти заново')).toBe(false);
    expect(isProxyTrouble('Telegram заблокировал аккаунт')).toBe(false);
    expect(
      isProxyTrouble(
        'отключён: аккаунт не активен (пауза, выведен или вход не выполнен)',
      ),
    ).toBe(false);
    expect(isProxyTrouble('ждёт подключения после перезапуска сервера')).toBe(
      false,
    );
    expect(isProxyTrouble(null)).toBe(false);
    expect(
      isProxyTrouble(
        'в сети, но прокси или связь с VK сбоят: приём сообщений падает 4 раз подряд (Proxy rejected the CONNECT tunnel with status code 504.)',
      ),
    ).toBe(true);
  });

  it('пишет через 15 минут, один раз; напоминает раз в 12 часов; сообщает о возврате', () => {
    const watch = new ProxyWatch(900, 12 * 3600);
    const other = probe({
      id: 2,
      login: '79990001122',
      channel: 'vk',
      manager: null,
      region: null,
    });
    const healthy = probe({ id: 3, online: true, reason: null });
    expect(msgs(watch, [probe({}), other, healthy], 0)).toEqual([]);
    expect(msgs(watch, [probe({}), other, healthy], 600)).toEqual([]);

    const [alert] = msgs(watch, [probe({}), other, healthy], 900);
    expect(alert).toContain('Не работают прокси: 2 акк.');
    expect(alert).toContain('socks5 1.2.3.4:1080 · u');
    expect(alert).toContain(
      '• #1 +79001112233 (Telegram) — Ivan, рег. 737 — прокси не отвечает',
    );
    expect(alert).toContain('• #2 79990001122 (VK) — прокси не отвечает');
    expect(alert).not.toContain('#3');
    // на одном прокси — одна шапка
    expect(alert.split('socks5 1.2.3.4:1080').length).toBe(2);

    expect(msgs(watch, [probe({}), other], 1800)).toEqual([]);
    const [reminder] = msgs(watch, [probe({}), other], 900 + 12 * 3600);
    expect(reminder).toContain('Напоминание');

    const up = probe({ online: true, reason: null });
    const t = 900 + 12 * 3600 + 300;
    const [gone] = msgs(watch, [up], t);
    expect(gone).toContain('• #2 — выключен или удалён');
    expect(gone).not.toContain('#1');
    // «починился» — только после 30 минут в сети подряд
    expect(msgs(watch, [up], t + 1500)).toEqual([]);
    const [back] = msgs(watch, [up], t + 1800);
    expect(back).toContain('• #1 +79001112233 — снова в сети, уже 30 мин');
    expect(msgs(watch, [up], 99999)).toEqual([]);
  });

  it('короткий обрыв не считается; починился — после 30 минут в сети подряд', () => {
    const watch = new ProxyWatch(900, 3600);
    const up = probe({ online: true, reason: null });
    msgs(watch, [probe({})], 0);
    msgs(watch, [up], 300);
    expect(msgs(watch, [up], 2100)).toEqual([]);
    // 30 минут в сети — отсчёт сброшен, новое падение считается с начала
    expect(msgs(watch, [probe({})], 2400)).toEqual([]);
    expect(msgs(watch, [probe({})], 3000)).toEqual([]);
    expect(msgs(watch, [probe({})], 3300)).toHaveLength(1);
  });

  it('моргающий аккаунт не обнуляет отсчёт и выключается по сроку', () => {
    const R = 3600;
    const watch = new ProxyWatch(900, R, 2);
    const up = probe({ online: true, reason: null });
    watch.step([probe({})], 0);
    expect(watch.step([probe({})], 900).messages[0]).toContain(
      'Не работают прокси',
    );
    // 10 минут в сети и снова лежит — без «починился» и без нового предупреждения
    expect(watch.step([up], 1200).messages).toEqual([]);
    expect(watch.step([up], 1800).messages).toEqual([]);
    expect(watch.step([probe({})], 2100).messages).toEqual([]);
    expect(watch.step([probe({})], 900 + R).messages[0]).toContain(
      'Напоминание',
    );
    watch.step([up], 900 + R + 300);
    watch.step([probe({})], 900 + R + 900);
    watch.step([probe({})], 900 + 2 * R);
    expect(watch.step([probe({})], 900 + 3 * R).disable).toHaveLength(1);
  });

  it('после перезапуска «ждёт подключения» — отсчёт стоит, без сообщений', () => {
    const R = 3600;
    const watch = new ProxyWatch(900, R, 2);
    watch.step([probe({})], 0);
    watch.step([probe({})], 900);
    const boot = probe({
      reason: 'ждёт подключения после перезапуска сервера',
    });
    expect(watch.step([boot], 1200).messages).toEqual([]);
    expect(watch.step([boot], 1500).messages).toEqual([]);
    // снова прокси — то же предупреждение, напоминание по старому сроку
    expect(watch.step([probe({})], 1800).messages).toEqual([]);
    expect(watch.step([probe({})], 900 + R).messages[0]).toContain(
      'Напоминание',
    );
  });

  it('после двух напоминаний без замены прокси — аккаунт на выключение, один раз', () => {
    const R = 12 * 3600;
    const watch = new ProxyWatch(900, R, 2);
    watch.step([probe({})], 0);
    const alert = watch.step([probe({})], 900);
    expect(alert.messages[0]).toContain(
      'после 2 напоминаний аккаунт выключится сам',
    );
    expect(alert.disable).toEqual([]);
    const r1 = watch.step([probe({})], 900 + R);
    expect(r1.messages[0]).toContain('Напоминание');
    expect(r1.messages[0]).not.toContain('Последнее');
    const r2 = watch.step([probe({})], 900 + 2 * R);
    expect(r2.messages[0]).toContain('Последнее напоминание для #1');
    expect(r2.disable).toEqual([]);
    expect(watch.step([probe({})], 900 + 2 * R + 600)).toEqual({
      messages: [],
      disable: [],
    });
    const off = watch.step([probe({})], 900 + 3 * R);
    expect(off.messages).toEqual([]);
    expect(off.disable.map((p) => p.id)).toEqual([1]);
    expect(disabledMessage(off.disable, 2, 900 + 3 * R)).toContain(
      '• #1 +79001112233',
    );
    // выключить не удалось — на следующем шаге снова просит, без сообщений
    const retry = watch.step([probe({})], 900 + 3 * R + 300);
    expect(retry.messages).toEqual([]);
    expect(retry.disable.map((p) => p.id)).toEqual([1]);
    // выключили: пропадает из активных — «выключен или удалён» о нём не пишем
    watch.forget([1]);
    expect(watch.step([], 900 + 3 * R + 600)).toEqual({
      messages: [],
      disable: [],
    });
  });

  it('прокси заменили — меры приняты: отсчёт и напоминания заново', () => {
    const R = 3600;
    const watch = new ProxyWatch(900, R, 2);
    watch.step([probe({})], 0);
    watch.step([probe({})], 900);
    watch.step([probe({})], 900 + R);
    watch.step([probe({})], 900 + 2 * R);
    const fixed = probe({ proxy: 'socks5 5.6.7.8:1080 · u' });
    const swap = watch.step([fixed], 900 + 2 * R + 300);
    expect(swap.messages).toEqual([expect.stringContaining('Прокси заменили')]);
    expect(swap.disable).toEqual([]);
    // новый прокси тоже не работает — с начала: 15 минут, предупреждение, два напоминания
    const t = 900 + 2 * R + 300;
    expect(watch.step([fixed], t + 900).messages[0]).toContain(
      'Не работают прокси',
    );
    expect(watch.step([fixed], t + 900 + R).disable).toEqual([]);
    expect(watch.step([fixed], t + 900 + 2 * R).disable).toEqual([]);
    expect(watch.step([fixed], t + 900 + 3 * R).disable).toHaveLength(1);
  });

  it('время в сети после перезапуска считается заново', () => {
    const R = 3600;
    const up = probe({ online: true, reason: null });
    const first = new ProxyWatch(900, R, 2);
    first.step([probe({})], 0);
    first.step([probe({})], 900);
    first.step([up], 1200);
    const second = new ProxyWatch(900, R, 2);
    second.restore(first.snapshot());
    // процесс лежал час: это не «в сети 30 минут»
    expect(second.step([up], 1200 + 3600).messages).toEqual([]);
    expect(second.step([up], 1200 + 3600 + 1800).messages[0]).toContain(
      'снова в сети',
    );
  });

  it('состояние переживает перезапуск: без повторного предупреждения, отсчёт не сбрасывается', () => {
    const R = 3600;
    const first = new ProxyWatch(900, R, 2);
    first.step([probe({})], 0);
    first.step([probe({})], 900);
    first.step([probe({})], 900 + R);
    const second = new ProxyWatch(900, R, 2);
    second.restore(JSON.parse(JSON.stringify(first.snapshot())));
    expect(second.step([probe({})], 900 + R + 300).messages).toEqual([]);
    expect(second.step([probe({})], 900 + 2 * R).messages[0]).toContain(
      'Последнее напоминание',
    );
    expect(second.step([probe({})], 900 + 3 * R).disable).toHaveLength(1);
    // битое состояние — как пустое
    const broken = new ProxyWatch(900, R, 2);
    broken.restore({ downSince: { x: 'y' } as never, notices: null as never });
    expect(broken.snapshot()).toEqual({ downSince: {}, notices: {} });
  });
});
