import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as argon2 from 'argon2';
import { ManagersController } from './managers.controller';
import { ManagersService } from './managers.service';
import { PrismaService } from '../../prisma.service';
import { ClockService } from '../../shared/clock.service';
import { AuditService } from '../../shared/audit.service';
import { CryptoService } from '../../shared/crypto.service';
import { AccessControlService } from '../../shared/access-control.service';
import { appConfig } from '../../config/app.config';
import { credentialTag } from '../../shared/session-claims';

describe('Manager credentials and regions through authenticated HTTP', () => {
  let app: any;
  // База в памяти: учётки, закрепления аккаунтов и сами Telegram-аккаунты.
  let db: {
    rows: any[];
    links: { userId: number; tgAccountId: number }[];
    accounts: number[];
  };
  let admin: string;
  let manager: string;
  let voice: string;
  const previousKey = appConfig.sessionEncKey;
  const previousJwt = process.env.JWT_SECRET;
  const audit = { wrap: jest.fn((_meta, fn) => fn()) };
  const withAccounts = (row: any) =>
    row && {
      ...row,
      accounts: db.links
        .filter((l) => l.userId === row.id)
        .sort((a, b) => a.tgAccountId - b.tgAccountId),
    };
  const linkMatches = (where: any) => (l: any) =>
    (where.userId === undefined || l.userId === where.userId) &&
    (where.tgAccountId === undefined || l.tgAccountId === where.tgAccountId);
  const findUser = async ({ where }) =>
    withAccounts(
      db.rows.find((r) =>
        where.id !== undefined
          ? r.id === where.id
          : r.username === where.username,
      ),
    );
  const prisma = {
    // Как настоящая транзакция: при ошибке всё, что успели записать, откатывается.
    $transaction: async (fn) => {
      const snapshot = structuredClone(db);
      try {
        return await fn(prisma);
      } catch (e) {
        db = snapshot;
        throw e;
      }
    },
    dashboardUser: {
      findUnique: jest.fn(findUser),
      findMany: jest.fn(async () => db.rows.map(withAccounts)),
      create: jest.fn(async ({ data }) => {
        const row = { ...data, id: db.rows.length + 1 };
        db.rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = db.rows.find((r) => r.id === where.id);
        if (
          data.username !== undefined &&
          db.rows.some((r) => r !== row && r.username === data.username)
        )
          throw Object.assign(new Error('unique'), {
            code: 'P2002',
            meta: { target: ['username'] },
          });
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        for (const row of db.rows)
          if (row.voicerId === where.voicerId) Object.assign(row, data);
      }),
    },
    managerAccount: {
      deleteMany: jest.fn(async ({ where }) => {
        db.links = db.links.filter((l) => !linkMatches(where)(l));
      }),
      create: jest.fn(async ({ data }) => {
        db.links.push({ ...data });
      }),
    },
    tgAccount: {
      count: jest.fn(
        async ({ where }) =>
          db.accounts.filter((id) => where.id.in.includes(id)).length,
      ),
    },
    voiceTask: { count: jest.fn(async () => 0) },
    voicerProfile: { deleteMany: jest.fn(async () => undefined) },
  };
  const http = () => request(app.getHttpServer());
  const user = (id: number) => db.rows.find((r) => r.id === id);
  const owner = (tgAccountId: number) =>
    db.links.find((l) => l.tgAccountId === tgAccountId)?.userId;
  const lastAudit = () => audit.wrap.mock.calls.at(-1)[0];
  beforeAll(async () => {
    appConfig.sessionEncKey = 'a1'.repeat(32);
    process.env.JWT_SECRET = 'manager-region-http-test-only';
    const module = await Test.createTestingModule({
      controllers: [ManagersController],
      providers: [
        ManagersService,
        CryptoService,
        JwtService,
        AccessControlService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClockService, useValue: { ts: () => 1790076000 } },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidUnknownValues: false,
      }),
    );
    await app.init();
    const jwt = module.get(JwtService);
    const claims = (id: number, passwordHash: string) => ({
      id,
      kind: 'access',
      credential: credentialTag({ id, passwordHash }),
    });
    admin = jwt.sign(claims(1, 'old-admin-hash'), {
      secret: process.env.JWT_SECRET,
    });
    manager = jwt.sign(claims(2, 'old-manager-hash'), {
      secret: process.env.JWT_SECRET,
    });
    voice = jwt.sign(claims(3, 'old-voice-hash'), {
      secret: process.env.JWT_SECRET,
    });
  });
  beforeEach(() => {
    audit.wrap.mockClear();
    db = {
      rows: [
        {
          id: 1,
          username: 'admin',
          role: 'admin',
          passwordHash: 'old-admin-hash',
          passwordEncrypted: null,
          regionCode: null,
        },
        {
          id: 2,
          username: 'manager',
          role: 'manager',
          passwordHash: 'old-manager-hash',
          passwordEncrypted: null,
          regionCode: null,
        },
        {
          id: 3,
          username: 'voice',
          role: 'voice',
          passwordHash: 'old-voice-hash',
          passwordEncrypted: null,
          regionCode: null,
        },
      ],
      links: [{ userId: 2, tgAccountId: 7 }],
      accounts: [7, 8],
    };
  });
  afterAll(async () => {
    await app.close();
    appConfig.sessionEncKey = previousKey;
    if (previousJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwt;
  });

  it('generates distinct passwords, preserves leading zeros, and only stores encrypted recoverable credentials', async () => {
    const generated: string[] = [];
    for (const username of ['alpha', 'beta']) {
      const created = await http()
        .post('/api/managers')
        .auth(admin, { type: 'bearer' })
        .send({ username, role: 'manager', region_code: '0077' })
        .expect(200);
      expect(JSON.stringify(created.body)).not.toMatch(
        /password_hash|passwordHash|passwordEncrypted|password_encrypted/,
      );
      const id = created.body.created_user_id;
      const result = await http()
        .get(`/api/managers/${id}`)
        .auth(admin, { type: 'bearer' })
        .expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.region_code).toBe('0077');
      expect(result.body.password).toMatch(/^[A-Za-z0-9_-]{16}$/);
      const row = user(id);
      expect(await argon2.verify(row.passwordHash, result.body.password)).toBe(
        true,
      );
      expect(row.passwordEncrypted).toMatch(/^v1:/);
      expect(row.passwordEncrypted).not.toContain(result.body.password);
      generated.push(result.body.password);
    }
    expect(generated[0]).not.toBe(generated[1]);
  });

  it('rejects missing or malformed manager regions without creating users', async () => {
    for (const region_code of [undefined, '', '12', '12345', '12a', 123]) {
      await http()
        .post('/api/managers')
        .auth(admin, { type: 'bearer' })
        .send({ username: 'invalid', role: 'manager', region_code })
        .expect(400);
    }
    expect(db.rows).toHaveLength(3);
  });

  it('returns everything the editor needs in one response and logs the view', async () => {
    db.rows[1].regionCode = '0077';
    db.rows[1].voicerId = 3;
    db.links.push({ userId: 2, tgAccountId: 8 });
    const result = await http()
      .get('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toEqual({
      user_id: 2,
      username: 'manager',
      role: 'manager',
      region_code: '0077',
      voicer_id: 3,
      account_ids: [7, 8],
      password: null,
    });
    expect(lastAudit()).toMatchObject({
      userId: 1,
      action: 'manager.credentials_view',
      resource: 'user:2',
    });
    await http()
      .get('/api/managers/999')
      .auth(admin, { type: 'bearer' })
      .expect(404);
  });

  it('denies the editor payload and updates to managers, voice users and anonymous users', async () => {
    for (const token of [manager, voice]) {
      await http()
        .get('/api/managers/2')
        .auth(token, { type: 'bearer' })
        .expect(403);
      await http()
        .put('/api/managers/2')
        .auth(token, { type: 'bearer' })
        .send({ regenerate_password: true })
        .expect(403);
      await http()
        .get('/api/managers')
        .auth(token, { type: 'bearer' })
        .expect(403);
    }
    await http().get('/api/managers/2').expect(401);
    await http()
      .put('/api/managers/2')
      .send({ regenerate_password: true })
      .expect(401);
    expect(db.rows[1].passwordHash).toBe('old-manager-hash');
  });

  it('keeps old passwords until an explicit reset and keeps hash and encrypted copy in sync', async () => {
    const old = await http()
      .get('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .expect(200);
    expect(old.body.password).toBeNull();
    const region = await http()
      .put('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .send({ region_code: '077' })
      .expect(200);
    expect(db.rows[1].passwordHash).toBe('old-manager-hash');
    // Обычная правка: пароль в ответе не повторяется, в журнале — manager.update.
    expect(region.body.editor).toEqual({
      user_id: 2,
      username: 'manager',
      role: 'manager',
      region_code: '077',
      voicer_id: null,
      account_ids: [7],
    });
    expect(lastAudit()).toMatchObject({
      action: 'manager.update',
      resource: 'user:2',
      payload: { fields: ['region_code'] },
    });
    const reset = await http()
      .put('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .send({ regenerate_password: true })
      .expect(200);
    const fresh = reset.body.editor.password;
    expect(reset.headers['cache-control']).toBe('no-store');
    expect(reset.body.items).toHaveLength(3);
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(await argon2.verify(db.rows[1].passwordHash, fresh)).toBe(true);
    expect(db.rows[1].passwordEncrypted).toMatch(/^v1:/);
    expect(JSON.stringify(reset.body.items)).not.toContain(fresh);
    // Случайный пароль — своё событие журнала; в него попадают названия полей, но не сам пароль.
    expect(lastAudit()).toMatchObject({
      action: 'manager.password_regenerate',
      resource: 'user:2',
      payload: { fields: ['regenerate_password'] },
    });
    expect(JSON.stringify(lastAudit())).not.toContain(fresh);
    // Следующая обычная правка сохранённый пароль не возвращает: он уже есть у окна.
    const plain = await http()
      .put('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .send({ region_code: '0078', account_ids: [7, 8] })
      .expect(200);
    expect(plain.body.editor).not.toHaveProperty('password');
    expect(JSON.stringify(plain.body)).not.toContain(fresh);
    expect(lastAudit().action).toBe('manager.update');
    expect(
      (
        await http()
          .get('/api/managers/2')
          .auth(admin, { type: 'bearer' })
          .expect(200)
      ).body.password,
    ).toBe(fresh);
    expect(lastAudit().action).toBe('manager.credentials_view');
    expect(JSON.stringify(lastAudit())).not.toContain(fresh);
    const explicit = await http()
      .put('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .send({ password: 'manually-updated-123' })
      .expect(200);
    expect(explicit.body.editor.password).toBe('manually-updated-123');
    expect(lastAudit()).toMatchObject({
      action: 'manager.update',
      payload: { fields: ['password'] },
    });
    expect(JSON.stringify(lastAudit())).not.toContain('manually-updated-123');
    const changed = await http()
      .get('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .expect(200);
    expect(changed.body.password).toBe('manually-updated-123');
    expect(
      await argon2.verify(db.rows[1].passwordHash, changed.body.password),
    ).toBe(true);
  });

  it('rejects an explicit password together with regeneration and malformed password fields', async () => {
    const both = await http()
      .put('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .send({ password: 'manually-updated-123', regenerate_password: true })
      .expect(400);
    expect(both.body.message).toContain('одновременно нельзя');
    await http()
      .put('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .send({ password: 'short' })
      .expect(400);
    await http()
      .put('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .send({ regenerate_password: 'yes' })
      .expect(400);
    expect(db.rows[1].passwordHash).toBe('old-manager-hash');
    expect(db.rows[1].passwordEncrypted).toBeNull();
  });

  it('renames a login, also your own, and keeps the password', async () => {
    const renamed = await http()
      .put('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .send({ username: 'anna' })
      .expect(200);
    expect(renamed.body.editor.username).toBe('anna');
    expect(renamed.body.editor).not.toHaveProperty('password');
    expect(renamed.body.items.find((u) => u.user_id === 2).username).toBe(
      'anna',
    );
    expect(db.rows[1].passwordHash).toBe('old-manager-hash');
    await http()
      .put('/api/managers/1')
      .auth(admin, { type: 'bearer' })
      .send({ username: 'root' })
      .expect(200);
    expect(db.rows[0].username).toBe('root');
    // Тот же логин — не переименование и не конфликт с самим собой.
    await http()
      .put('/api/managers/1')
      .auth(admin, { type: 'bearer' })
      .send({ username: 'root' })
      .expect(200);
    for (const username of ['', 'x'.repeat(65), 5]) {
      await http()
        .put('/api/managers/2')
        .auth(admin, { type: 'bearer' })
        .send({ username })
        .expect(400);
    }
    expect(db.rows[1].username).toBe('anna');
  });

  it('answers 409 in Russian when the login belongs to another account and changes nothing', async () => {
    const conflict = await http()
      .put('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .send({ username: 'voice', region_code: '0077', account_ids: [8] })
      .expect(409);
    expect(conflict.body.message).toBe("логин 'voice' уже занят");
    expect(db.rows[1]).toMatchObject({ username: 'manager', regionCode: null });
    expect(db.links).toEqual([{ userId: 2, tgAccountId: 7 }]);
    // Гонка: проверка логина прошла, а уникальный индекс сработал уже при записи.
    prisma.dashboardUser.findUnique.mockImplementation(async (args) =>
      args.where.username !== undefined ? null : findUser(args),
    );
    try {
      const race = await http()
        .put('/api/managers/2')
        .auth(admin, { type: 'bearer' })
        .send({ username: 'voice', region_code: '0077' })
        .expect(409);
      expect(race.body.message).toBe("логин 'voice' уже занят");
    } finally {
      prisma.dashboardUser.findUnique.mockImplementation(findUser);
    }
    expect(db.rows[1]).toMatchObject({ username: 'manager', regionCode: null });
  });

  it('calls a unique violation a taken login only for the username index', async () => {
    const unique = (target: unknown) =>
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target },
      });
    // Имя индекса строкой — тоже логин.
    for (const target of [['username'], 'dashboard_users_username_key']) {
      prisma.dashboardUser.update.mockRejectedValueOnce(unique(target));
      const taken = await http()
        .put('/api/managers/2')
        .auth(admin, { type: 'bearer' })
        .send({ username: 'anna' })
        .expect(409);
      expect(taken.body.message).toBe("логин 'anna' уже занят");
    }
    // Другой уникальный индекс при том же запросе с переименованием — не «логин занят».
    for (const target of [['tg_account_id'], ['voicer_id', 'username'], null]) {
      prisma.dashboardUser.update.mockRejectedValueOnce(unique(target));
      const other = await http()
        .put('/api/managers/2')
        .auth(admin, { type: 'bearer' })
        .send({ username: 'anna' })
        .expect(500);
      expect(JSON.stringify(other.body)).not.toContain('уже занят');
    }
    expect(db.rows[1].username).toBe('manager');
    // То же при создании учётки.
    prisma.dashboardUser.create.mockRejectedValueOnce(unique(['username']));
    const taken = await http()
      .post('/api/managers')
      .auth(admin, { type: 'bearer' })
      .send({ username: 'voice', role: 'admin' })
      .expect(409);
    expect(taken.body.message).toBe("логин 'voice' уже занят");
    prisma.dashboardUser.create.mockRejectedValueOnce(unique(['voicer_id']));
    const other = await http()
      .post('/api/managers')
      .auth(admin, { type: 'bearer' })
      .send({ username: 'fresh', role: 'admin' })
      .expect(500);
    expect(JSON.stringify(other.body)).not.toContain('уже занят');
    expect(db.rows).toHaveLength(3);
  });

  it('changes login, role, region, password and accounts in one request', async () => {
    const saved = await http()
      .put('/api/managers/3')
      .auth(admin, { type: 'bearer' })
      .send({
        username: 'promoted',
        role: 'manager',
        region_code: '0123',
        account_ids: [7, 8],
        password: 'promoted-pass-123',
      })
      .expect(200);
    expect(saved.body.editor).toEqual({
      user_id: 3,
      username: 'promoted',
      role: 'manager',
      region_code: '0123',
      voicer_id: null,
      account_ids: [7, 8],
      password: 'promoted-pass-123',
    });
    expect(saved.body.items.find((u) => u.user_id === 2).account_ids).toEqual(
      [],
    );
    expect(owner(7)).toBe(3);
    expect(owner(8)).toBe(3);
  });

  it('rolls login, role, password and accounts back together when one part fails', async () => {
    const untouched = { ...db.rows[2] };
    // Учётка уже переписана, первый аккаунт уже перенесён — и тут запись падает.
    prisma.managerAccount.create
      .mockImplementationOnce(async ({ data }) => {
        db.links.push({ ...data });
      })
      .mockRejectedValueOnce(new Error('connection lost'));
    await http()
      .put('/api/managers/3')
      .auth(admin, { type: 'bearer' })
      .send({
        username: 'promoted',
        role: 'manager',
        region_code: '0123',
        account_ids: [7, 8],
        regenerate_password: true,
      })
      .expect(500);
    expect(db.rows[2]).toEqual(untouched);
    expect(db.links).toEqual([{ userId: 2, tgAccountId: 7 }]);
    // Исчезнувший аккаунт останавливает всё ещё до первой записи.
    await http()
      .put('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .send({ username: 'anna', account_ids: [7, 999] })
      .expect(404);
    expect(db.rows[1].username).toBe('manager');
    expect(db.links).toEqual([{ userId: 2, tgAccountId: 7 }]);
    // Аккаунты не остаются у того, кто перестал быть менеджером.
    await http()
      .put('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .send({ username: 'anna', role: 'admin', account_ids: [7] })
      .expect(422);
    expect(db.rows[1]).toMatchObject({ username: 'manager', role: 'manager' });
    expect(db.links).toEqual([{ userId: 2, tgAccountId: 7 }]);
  });
});
