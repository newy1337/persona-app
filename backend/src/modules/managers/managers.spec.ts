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
  let rows: any[];
  let admin: string;
  let manager: string;
  let voice: string;
  const previousKey = appConfig.sessionEncKey;
  const previousJwt = process.env.JWT_SECRET;
  const prisma = {
    $transaction: async (fn) => fn(prisma),
    dashboardUser: {
      findUnique: jest.fn(async ({ where }) =>
        rows.find((r) => r.id === where.id),
      ),
      findMany: jest.fn(async () => rows),
      create: jest.fn(async ({ data }) => {
        const row = { ...data, id: rows.length + 1, accounts: [] };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
  };
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
        { provide: AuditService, useValue: { wrap: (_meta, fn) => fn() } },
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
    rows = [
      {
        id: 1,
        username: 'admin',
        role: 'admin',
        passwordHash: 'old-admin-hash',
        passwordEncrypted: null,
        regionCode: null,
        accounts: [],
      },
      {
        id: 2,
        username: 'manager',
        role: 'manager',
        passwordHash: 'old-manager-hash',
        passwordEncrypted: null,
        regionCode: null,
        accounts: [],
      },
      {
        id: 3,
        username: 'voice',
        role: 'voice',
        passwordHash: 'old-voice-hash',
        passwordEncrypted: null,
        regionCode: null,
        accounts: [],
      },
    ];
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
      const created = await request(app.getHttpServer())
        .post('/api/managers')
        .auth(admin, { type: 'bearer' })
        .send({ username, role: 'manager', region_code: '0077' })
        .expect(200);
      expect(JSON.stringify(created.body)).not.toMatch(
        /password_hash|passwordHash|passwordEncrypted|password_encrypted/,
      );
      const id = created.body.created_user_id;
      const result = await request(app.getHttpServer())
        .get(`/api/managers/${id}/credentials`)
        .auth(admin, { type: 'bearer' })
        .expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.region_code).toBe('0077');
      expect(result.body.password).toMatch(/^[A-Za-z0-9_-]{16}$/);
      const row = rows.find((r) => r.id === id);
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
      await request(app.getHttpServer())
        .post('/api/managers')
        .auth(admin, { type: 'bearer' })
        .send({ username: 'invalid', role: 'manager', region_code })
        .expect(400);
    }
    expect(rows).toHaveLength(3);
  });

  it('denies credentials and password regeneration to managers, voice users and anonymous users', async () => {
    for (const token of [manager, voice]) {
      await request(app.getHttpServer())
        .get('/api/managers/2/credentials')
        .auth(token, { type: 'bearer' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/managers/2/password')
        .auth(token, { type: 'bearer' })
        .send({})
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/managers')
        .auth(token, { type: 'bearer' })
        .expect(403);
    }
    await request(app.getHttpServer())
      .get('/api/managers/2/credentials')
      .expect(401);
    expect(rows[1].passwordHash).toBe('old-manager-hash');
  });

  it('keeps old passwords until an explicit reset and keeps hash and encrypted copy in sync', async () => {
    const old = await request(app.getHttpServer())
      .get('/api/managers/2/credentials')
      .auth(admin, { type: 'bearer' })
      .expect(200);
    expect(old.body.password).toBeNull();
    expect(rows[1].passwordHash).toBe('old-manager-hash');
    await request(app.getHttpServer())
      .put('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .send({ region_code: '077' })
      .expect(200);
    expect(rows[1].passwordHash).toBe('old-manager-hash');
    const reset = await request(app.getHttpServer())
      .post('/api/managers/2/password')
      .auth(admin, { type: 'bearer' })
      .send({})
      .expect(200);
    expect(reset.headers['cache-control']).toBe('no-store');
    expect(await argon2.verify(rows[1].passwordHash, reset.body.password)).toBe(
      true,
    );
    await request(app.getHttpServer())
      .put('/api/managers/2')
      .auth(admin, { type: 'bearer' })
      .send({ password: 'manually-updated-123' })
      .expect(200);
    const changed = await request(app.getHttpServer())
      .get('/api/managers/2/credentials')
      .auth(admin, { type: 'bearer' })
      .expect(200);
    expect(changed.body.password).toBe('manually-updated-123');
    expect(
      await argon2.verify(rows[1].passwordHash, changed.body.password),
    ).toBe(true);
  });
});
