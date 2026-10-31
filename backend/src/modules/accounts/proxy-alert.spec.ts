import { type AccountProbe, ProxyWatch, isProxyTrouble } from './proxy-alert';

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
    expect(watch.step([probe({}), other, healthy], 0)).toEqual([]);
    expect(watch.step([probe({}), other, healthy], 600)).toEqual([]);

    const [alert] = watch.step([probe({}), other, healthy], 900);
    expect(alert).toContain('Не работают прокси: 2 акк.');
    expect(alert).toContain('socks5 1.2.3.4:1080 · u');
    expect(alert).toContain(
      '• #1 +79001112233 (Telegram) — Ivan, рег. 737 — прокси не отвечает',
    );
    expect(alert).toContain('• #2 79990001122 (VK) — прокси не отвечает');
    expect(alert).not.toContain('#3');
    // на одном прокси — одна шапка
    expect(alert.split('socks5 1.2.3.4:1080').length).toBe(2);

    expect(watch.step([probe({}), other], 1800)).toEqual([]);
    const [reminder] = watch.step([probe({}), other], 900 + 12 * 3600);
    expect(reminder).toContain('Напоминание');

    const [back] = watch.step(
      [probe({ online: true, reason: null })],
      900 + 12 * 3600 + 300,
    );
    expect(back).toContain('• #1 +79001112233 — снова в сети');
    expect(back).toContain('• #2 — выключен или удалён');
    expect(watch.step([probe({ online: true, reason: null })], 99999)).toEqual(
      [],
    );
  });

  it('короткий обрыв не считается: отсчёт с начала после возврата в сеть', () => {
    const watch = new ProxyWatch(900, 3600);
    watch.step([probe({})], 0);
    watch.step([probe({ online: true, reason: null })], 600);
    expect(watch.step([probe({})], 1200)).toEqual([]);
    expect(watch.step([probe({})], 2000)).toEqual([]);
    expect(watch.step([probe({})], 2100)).toHaveLength(1);
  });
});
