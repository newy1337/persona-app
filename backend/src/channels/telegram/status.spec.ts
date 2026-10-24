import { presenceNow } from 'src/domain/client-status';
import { accountLoss, blockedByClient, clientPresence } from './status';

describe('статусы Telegram', () => {
  it('был в сети: точное время, «недавно», скрыто', () => {
    expect(
      clientPresence({ className: 'UserStatusOnline', expires: 1000 }),
    ).toEqual({ kind: 'online', at: 1000 });
    expect(
      clientPresence({ className: 'UserStatusOffline', wasOnline: 900 }),
    ).toEqual({ kind: 'offline', at: 900 });
    expect(clientPresence({ className: 'UserStatusRecently' })).toEqual({
      kind: 'recently',
      at: null,
    });
    expect(clientPresence({ className: 'UserStatusLastWeek' })).toEqual({
      kind: 'last_week',
      at: null,
    });
    expect(clientPresence({ className: 'UserStatusEmpty' })).toEqual({
      kind: 'hidden',
      at: null,
    });
    expect(clientPresence(undefined)).toBeNull();
  });

  it('«в сети» истекло — был в сети тогда', () => {
    expect(presenceNow({ kind: 'online', at: 1000 }, 1200)).toEqual({
      kind: 'offline',
      at: 1000,
    });
    expect(presenceNow({ kind: 'online', at: 1000 }, 900)).toEqual({
      kind: 'online',
      at: 1000,
    });
  });

  it('бан и выход из сессии различаются; прочие ошибки — не про аккаунт', () => {
    expect(accountLoss({ errorMessage: 'USER_DEACTIVATED_BAN' })).toMatchObject(
      { kind: 'banned' },
    );
    expect(
      accountLoss(
        new Error('401: USER_DEACTIVATED (caused by messages.SendMessage)'),
      ),
    ).toMatchObject({ kind: 'banned' });
    expect(accountLoss(new Error('401: AUTH_KEY_UNREGISTERED'))).toMatchObject({
      kind: 'logged_out',
    });
    expect(accountLoss({ errorMessage: 'SESSION_REVOKED' })).toMatchObject({
      kind: 'logged_out',
    });
    expect(accountLoss(new Error('PEER_FLOOD'))).toBeNull();
  });

  it('собеседник заблокировал нас', () => {
    expect(blockedByClient({ errorMessage: 'USER_IS_BLOCKED' })).toBe(true);
    expect(
      blockedByClient(
        new Error('400: USER_IS_BLOCKED (caused by messages.SendMessage)'),
      ),
    ).toBe(true);
    expect(blockedByClient(new Error('fetch failed'))).toBe(false);
  });
});

describe('вероятный ЧС по статусу собеседника', () => {
  const { likelyBlockedChange } = jest.requireActual(
    'src/domain/client-status',
  );
  it('был виден и вдруг скрыт — вероятно, ЧС', () => {
    expect(likelyBlockedChange('recently', 'hidden', 100)).toBe(100);
    expect(likelyBlockedChange('online', 'hidden', 100)).toBe(100);
  });
  it('скрыт с самого начала — не знаем, ничего не ставим', () => {
    expect(likelyBlockedChange(null, 'hidden', 100)).toBeUndefined();
    expect(likelyBlockedChange('hidden', 'hidden', 100)).toBeUndefined();
  });
  it('снова виден — отметка снимается', () => {
    expect(likelyBlockedChange('hidden', 'online', 100)).toBeNull();
    expect(likelyBlockedChange('hidden', 'last_week', 100)).toBeUndefined();
  });
});
