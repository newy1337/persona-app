import { useTestDatabase } from './database';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { json, raw } from 'express';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// A fresh schema per run: it comes from the real migrations.
const dir = mkdtempSync(join(tmpdir(), 'nastya-e2e-'));
process.env.DATA_DIR = dir;
process.env.JWT_SECRET = 'e2e-secret';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin12345';
process.env.SESSION_ENC_KEY = '00'.repeat(32);
// No Telegram in tests even if the developer's .env has real keys.
process.env.TG_API_ID = '';
process.env.TG_API_HASH = '';
process.env.PERSONA_ID = 'nastya';
process.env.PERSONAS_DIR = resolve(__dirname, 'fixtures', 'personas');
useTestDatabase('app');

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma.service';
import { HistoryService } from './../src/shared/history.service';
import { PROMPT_KEYS } from './../src/brain/nastya/config/prompts';
import { DEFAULT_RHYTHM } from './../src/brain/nastya/config/rhythm';
import {
  PERSONA_SECTIONS,
  PersonaService,
} from './../src/brain/persona.service';
import { OutreachWorker } from './../src/modules/leads/outreach.worker';
import { REPLY_BRAIN as REPLY_BRAIN_TOKEN } from './../src/brain/reply-brain.port';
import { TelegramService } from './../src/modules/telegram/telegram.service';
import { RelayWorker } from './../src/modules/telegram/relay.worker';
import { TelegramTimeoutError } from './../src/domain/timeout';
import { appConfig } from './../src/config/app.config';

describe('Manager panel API (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    // Как в main.ts: свой разбор тела, иначе лимиты в тестах и в бою разные.
    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.use('/api/personas', json({ limit: '8mb' }));
    app.use(
      '/api/tg-accounts',
      raw({ type: ['application/octet-stream', 'image/*'], limit: '15mb' }),
    );
    app.use(json({ limit: '2mb' }));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /health', () =>
    request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('ok')));

  it('POST /auth/login seeds the admin and returns tokens', async () => {
    const r = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'admin', password: 'admin12345' })
      .expect(200);
    expect(r.body.user).toMatchObject({ username: 'admin', role: 'admin' });
    token = r.body.tokens.accessToken;
    expect(token).toBeTruthy();
  });

  it('wrong password is 401 and audited', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'admin', password: 'nope' })
      .expect(401);
  });

  it('protected routes refuse without a token', () =>
    request(app.getHttpServer()).get('/api/manager/stats').expect(401));

  it('GET /auth/me returns the panel user shape', async () => {
    const r = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(r.body).toMatchObject({
      username: 'admin',
      role: 'admin',
      user_id: expect.any(Number),
    });
  });

  it('does not interchange access and refresh tokens', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'admin', password: 'admin12345' })
      .expect(200);
    const { accessToken, refreshToken } = login.body.tokens;
    await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken: accessToken })
      .expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${refreshToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken })
      .expect(200);
  });

  it('revokes both old tokens when the manager password is reset', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const created = await request(app.getHttpServer())
      .post('/api/managers')
      .set(h)
      .send({
        username: 'auth-reset-qa',
        password: 'old-password-123',
        role: 'manager',
        region_code: '0077',
      })
      .expect(200);
    try {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'auth-reset-qa', password: 'old-password-123' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/managers/${created.body.created_user_id}/password`)
        .set(h)
        .send({})
        .expect(200);
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
        .expect(401);
      await request(app.getHttpServer())
        .post('/auth/token/refresh')
        .send({ refreshToken: login.body.tokens.refreshToken })
        .expect(401);
    } finally {
      await request(app.getHttpServer())
        .delete(`/api/managers/${created.body.created_user_id}`)
        .set(h)
        .expect(200);
    }
  });

  it('empty database: stats, queue and conversations are empty', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const stats = await request(app.getHttpServer())
      .get('/api/manager/stats')
      .set(h)
      .expect(200);
    expect(stats.body).toEqual({
      need_manager: 0,
      total: 0,
      active_now: 0,
      leads: 0,
      accounts: 0,
    });
    // (accounts for the admin = the whole fleet; it is checked after an account is added below)
    const queue = await request(app.getHttpServer())
      .get('/api/manager/queue')
      .set(h)
      .expect(200);
    expect(queue.body).toEqual({ items: [] });
  });

  it('managers: create, assign, list, delete', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const created = await request(app.getHttpServer())
      .post('/api/managers')
      .set(h)
      .send({
        username: 'anna',
        password: 'anna12345',
        role: 'manager',
        region_code: '0077',
      })
      .expect(200);
    const anna = created.body.items.find((m) => m.username === 'anna');
    expect(anna.role).toBe('manager');

    const acc = await request(app.getHttpServer())
      .post('/api/tg-accounts')
      .set(h)
      .send({ phone_e164: '+79001234567', persona_id: 'nastya' })
      .expect(200);
    expect(acc.body.status).toBe('unauthorized');

    // Прокси: HTTP Telegram не умеет — отказ словами; SOCKS5 сохраняется, пароль наружу не выходит.
    const http = await request(app.getHttpServer())
      .post(`/api/tg-accounts/${acc.body.id}/set-proxy`)
      .set(h)
      .send({ proxy_config: { type: 'http', host: '1.2.3.4', port: 3128 } })
      .expect(400);
    expect(JSON.stringify(http.body)).toMatch(/HTTP Telegram не поддерживает/);
    const socks = await request(app.getHttpServer())
      .post(`/api/tg-accounts/${acc.body.id}/set-proxy`)
      .set(h)
      .send({
        proxy_config: {
          type: 'socks5',
          host: '1.2.3.4',
          port: 1080,
          username: 'user',
          password: 'top-secret',
        },
      })
      .expect(200);
    expect(socks.body).toMatchObject({
      needs_proxy_setup: false,
      proxy_label: 'socks5 1.2.3.4:1080 · user',
      reconnect_error: null,
    });
    const accounts = await request(app.getHttpServer())
      .get('/api/tg-accounts')
      .set(h)
      .expect(200);
    expect(JSON.stringify(accounts.body)).not.toContain('top-secret');

    const assigned = await request(app.getHttpServer())
      .put(`/api/managers/accounts/${acc.body.id}`)
      .set(h)
      .send({ user_id: anna.user_id })
      .expect(200);
    expect(
      assigned.body.items.find((m) => m.user_id === anna.user_id).account_ids,
    ).toEqual([acc.body.id]);
    const adminStats = await request(app.getHttpServer())
      .get('/api/manager/stats')
      .set(h)
      .expect(200);
    expect(adminStats.body.accounts).toBe(1);

    // A manager sees only chats of her accounts — none yet.
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'anna', password: 'anna12345' })
      .expect(200);
    const stats = await request(app.getHttpServer())
      .get('/api/manager/stats')
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .expect(200);
    expect(stats.body.accounts).toBe(1);
    await request(app.getHttpServer())
      .get('/api/managers')
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/managers/${anna.user_id}`)
      .set(h)
      .expect(200);
  });

  it('restored auto-password and region work with the real database and login', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const created = await request(app.getHttpServer())
      .post('/api/managers')
      .set(h)
      .send({
        username: 'restored-manager',
        role: 'manager',
        region_code: '0123',
      })
      .expect(200);
    const id = created.body.created_user_id;
    const credentials = await request(app.getHttpServer())
      .get(`/api/managers/${id}/credentials`)
      .set(h)
      .expect(200);
    expect(credentials.body).toMatchObject({
      username: 'restored-manager',
      region_code: '0123',
    });
    expect(credentials.body.password).toMatch(/^[A-Za-z0-9_-]{16}$/);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'restored-manager',
        password: credentials.body.password,
      })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/managers/${id}/credentials`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/managers/${id}`)
      .set(h)
      .expect(200);
  });

  it('does not partially reassign accounts or change a password when one account has disappeared', async () => {
    const h = { Authorization: `Bearer ${token}` },
      db = app.get(PrismaService);
    const first = (
      await request(app.getHttpServer())
        .post('/api/managers')
        .set(h)
        .send({
          username: 'atomic-first',
          password: 'original-pass-123',
          role: 'manager',
          region_code: '0077',
        })
        .expect(200)
    ).body.created_user_id;
    const second = (
      await request(app.getHttpServer())
        .post('/api/managers')
        .set(h)
        .send({
          username: 'atomic-second',
          role: 'manager',
          region_code: '0077',
        })
        .expect(200)
    ).body.created_user_id;
    const acc = await db.tgAccount.create({
      data: {
        phoneE164: '+10000008881',
        personaId: 'nastya',
        addedAt: 1,
        manager: { create: { userId: first } },
      },
    });
    try {
      await request(app.getHttpServer())
        .put('/api/managers/accounts')
        .set(h)
        .send({ user_id: second, tg_account_ids: [acc.id, 2147483647] })
        .expect(404);
      expect(
        (
          await db.managerAccount.findUniqueOrThrow({
            where: { tgAccountId: acc.id },
          })
        ).userId,
      ).toBe(first);
      await request(app.getHttpServer())
        .put(`/api/managers/${first}`)
        .set(h)
        .send({ password: 'changed-pass-456', account_ids: [2147483647] })
        .expect(404);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'atomic-first', password: 'original-pass-123' })
        .expect(200);
      expect(
        (
          await db.managerAccount.findUniqueOrThrow({
            where: { tgAccountId: acc.id },
          })
        ).userId,
      ).toBe(first);
    } finally {
      await db.tgAccount.delete({ where: { id: acc.id } });
      await db.dashboardUser.deleteMany({
        where: { id: { in: [first, second] } },
      });
    }
  });

  it('conversation detail 404s for an unknown chat to a manager, 200 for admin', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const r = await request(app.getHttpServer())
      .get('/api/conversations/424242')
      .set(h)
      .expect(200);
    expect(r.body).toMatchObject({
      chat_id: 424242,
      is_paused: false,
      funnel_stage: 'cold',
      messages: [],
    });
  });

  it('этап сделки: ставится руками, архив требует причину, статистика считает по дням', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const chatId = 424242;
    await request(app.getHttpServer())
      .post(`/api/conversations/${chatId}/deal-stage`)
      .set(h)
      .send({ stage: 'soglas' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/conversations/${chatId}/deal-stage`)
      .set(h)
      .send({ stage: 'archive' })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/conversations/${chatId}/deal-stage`)
      .set(h)
      .send({ stage: 'nope' })
      .expect(400);
    const card = await request(app.getHttpServer())
      .get(`/api/conversations/${chatId}`)
      .set(h)
      .expect(200);
    expect(card.body.pinned_facts.deal_stage).toBe('soglas');

    await request(app.getHttpServer())
      .post(`/api/conversations/${chatId}/deal-stage`)
      .set(h)
      .send({ stage: 'lead' })
      .expect(200);
    const stats = await request(app.getHttpServer())
      .get('/api/stats/stages')
      .set(h)
      .expect(200);
    // соглас → лид: вброс и предлога пройдены по пути, каждый этап — один раз
    expect(stats.body.totals).toMatchObject({
      vbros: 1,
      predloga: 1,
      soglas: 1,
      lead: 1,
      archive: 0,
    });
    expect(stats.body.reached).toMatchObject({
      soglas: 1,
      lead: 1,
      archive: 0,
    });
    expect(stats.body.days.length).toBe(1);
    expect(stats.body.days[0].counts.lead).toBe(1);

    // откат назад ничего не снимает и второй раз не считает
    await request(app.getHttpServer())
      .post(`/api/conversations/${chatId}/deal-stage`)
      .set(h)
      .send({ stage: 'vbros' })
      .expect(200);
    const again = await request(app.getHttpServer())
      .get('/api/stats/stages')
      .set(h)
      .expect(200);
    expect(again.body.totals).toMatchObject({ vbros: 1, lead: 1 });

    await request(app.getHttpServer())
      .post(`/api/conversations/${chatId}/deal-stage`)
      .set(h)
      .send({ stage: 'archive', note: 'перестал отвечать' })
      .expect(200);
    const after = await request(app.getHttpServer())
      .get(`/api/conversations/${chatId}`)
      .set(h)
      .expect(200);
    expect(after.body.pinned_facts).toMatchObject({
      deal_stage: 'archive',
      deal_note: 'перестал отвечать',
    });
    expect(after.body.archived).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/conversations/${chatId}/unhide`)
      .set(h)
      .expect(200);
    const back = await request(app.getHttpServer())
      .get(`/api/conversations/${chatId}`)
      .set(h)
      .expect(200);
    expect(back.body.archived).toBe(false);
    expect(back.body.pinned_facts.deal_stage).toBeUndefined();

    const managers = await request(app.getHttpServer())
      .get('/api/stats/managers')
      .set(h)
      .expect(200);
    const none = managers.body.by_manager.find(
      (r: any) => r.manager_id === null,
    );
    expect(none.stages).toMatchObject({
      vbros: 1,
      soglas: 1,
      lead: 1,
      archive: 1,
    });
  });

  it('расход по менеджерам: чат без закреплённого аккаунта попадает в строку «без менеджера»', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const stats = await request(app.getHttpServer())
      .get('/api/stats/managers')
      .set(h)
      .expect(200);
    expect(Array.isArray(stats.body.by_manager)).toBe(true);
    for (const row of stats.body.by_manager) {
      expect(row).toMatchObject({
        username: expect.any(String),
        cost_usd: expect.any(Number),
        days: expect.any(Array),
      });
      // Дни без единого события в строку не попадают.
      for (const day of row.days)
        expect(
          day.calls +
            day.messages_in +
            day.messages_out +
            day.leads_uploaded +
            Object.values(day.stages as Record<string, number>).reduce(
              (a, b) => a + b,
              0,
            ),
        ).toBeGreaterThan(0);
    }
    if (stats.body.by_manager.length) {
      expect(
        stats.body.by_manager.find((row: any) => row.manager_id === null)
          ?.username ?? 'Без менеджера',
      ).toBe('Без менеджера');
    }
  });

  it('заметка о диалоге сохраняется, приходит вместе с перепиской и стирается пустой строкой', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const saved = await request(app.getHttpServer())
      .put('/api/conversations/424242/note')
      .set(h)
      .send({ text: '  Просил не писать до пятницы  ' })
      .expect(200);
    expect(saved.body).toMatchObject({
      note: 'Просил не писать до пятницы',
      note_by: expect.any(String),
      note_at: expect.any(Number),
    });

    const chat = await request(app.getHttpServer())
      .get('/api/conversations/424242')
      .set(h)
      .expect(200);
    expect(chat.body.note).toBe('Просил не писать до пятницы');
    expect(chat.body.note_by).toBe(saved.body.note_by);

    const cleared = await request(app.getHttpServer())
      .put('/api/conversations/424242/note')
      .set(h)
      .send({ text: '' })
      .expect(200);
    expect(cleared.body).toMatchObject({
      note: null,
      note_by: null,
      note_at: null,
    });
    const after = await request(app.getHttpServer())
      .get('/api/conversations/424242')
      .set(h)
      .expect(200);
    expect(after.body.note).toBeNull();
  });

  it('отпечаток переписки меняется от паузы и остаётся прежним, пока ничего не менялось', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const first = await request(app.getHttpServer())
      .get('/api/conversations/424242/revision')
      .set(h)
      .expect(200);
    expect(first.body).toMatchObject({
      revision: expect.any(String),
      is_paused: false,
    });

    const again = await request(app.getHttpServer())
      .get('/api/conversations/424242/revision')
      .set(h)
      .expect(200);
    expect(again.body.revision).toBe(first.body.revision);

    await request(app.getHttpServer())
      .post('/api/conversations/424242/pause')
      .set(h)
      .expect(200);
    const paused = await request(app.getHttpServer())
      .get('/api/conversations/424242/revision')
      .set(h)
      .expect(200);
    expect(paused.body.revision).not.toBe(first.body.revision);
    expect(paused.body.is_paused).toBe(true);
    await request(app.getHttpServer())
      .post('/api/conversations/424242/resume')
      .set(h)
      .expect(200);
  });

  it('после стоп-фразы бот включается только после ответа менеджера', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const prisma = app.get(PrismaService);
    const history = app.get(HistoryService);
    const chatId = 424242;
    const ts = Math.floor(Date.now() / 1000);
    await history.mergeLeadFacts(
      chatId,
      { _handoff_trigger: { phrase: 'менеджер', ts } },
      false,
    );
    await request(app.getHttpServer())
      .post(`/api/conversations/${chatId}/pause`)
      .set(h)
      .expect(200);
    const refused = await request(app.getHttpServer())
      .post(`/api/conversations/${chatId}/resume`)
      .set(h)
      .expect(422);
    expect(refused.body.message).toContain('Сработал триггер');
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/operator/status/${chatId}`)
          .set(h)
      ).body.status,
    ).toBe('paused');

    await prisma.message.create({
      data: {
        chatId: BigInt(chatId),
        ts: ts + 1,
        role: 'assistant',
        text: 'Сейчас подключусь',
        author: 'operator:web',
      },
    });
    await request(app.getHttpServer())
      .post(`/api/conversations/${chatId}/resume`)
      .set(h)
      .expect(200);
    const facts = await history.getLeadFacts(chatId);
    expect(facts._handoff_trigger).toBeUndefined();
    await prisma.message.deleteMany({
      where: { chatId: BigInt(chatId), author: 'operator:web', ts: ts + 1 },
    });
  });

  it('pause/resume are idempotent and visible in operator status', async () => {
    const h = { Authorization: `Bearer ${token}` };
    await request(app.getHttpServer())
      .post('/api/conversations/424242/pause')
      .set(h)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/conversations/424242/pause')
      .set(h)
      .expect(200);
    const st = await request(app.getHttpServer())
      .get('/api/operator/status/424242')
      .set(h)
      .expect(200);
    expect(st.body).toMatchObject({
      status: 'paused',
      reason: 'operator_hold',
      actor: 'operator:web',
    });
    await request(app.getHttpServer())
      .post('/api/conversations/424242/resume')
      .set(h)
      .expect(200);
    const st2 = await request(app.getHttpServer())
      .get('/api/operator/status/424242')
      .set(h)
      .expect(200);
    expect(st2.body.status).toBe('active');
  });

  it('manual message is queued and hide/unhide toggles the row', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const m = await request(app.getHttpServer())
      .post('/api/conversations/424242/message')
      .set(h)
      .send({ text: 'привет от менеджера' })
      .expect(200);
    expect(m.body).toMatchObject({
      ok: true,
      pending_reply_id: expect.any(Number),
    });
    await request(app.getHttpServer())
      .post('/api/conversations/424242/hide')
      .set(h)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/conversations/424242/unhide')
      .set(h)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/conversations/424242/set-stage')
      .set(h)
      .send({ stage: 'bogus' })
      .expect(422);
    await request(app.getHttpServer())
      .post('/api/conversations/424242/set-stage')
      .set(h)
      .send({ stage: 'rapport' })
      .expect(200);
    const d = await request(app.getHttpServer())
      .get('/api/conversations/424242')
      .set(h)
      .expect(200);
    expect(d.body.funnel_stage).toBe('rapport');
    expect(
      d.body.funnel_events.some((e) => e.event_type === 'stage_transition'),
    ).toBe(true);
  });

  it('beats snapshot uses the persona rubric', async () => {
    const h = { Authorization: `Bearer ${token}` };
    const r = await request(app.getHttpServer())
      .get('/api/conversations/424242/beats')
      .set(h)
      .expect(200);
    expect(r.body.chat_id).toBe(424242);
    expect(r.body.total).toBeGreaterThan(0);
    expect(r.body.beats.length).toBeGreaterThanOrEqual(r.body.total);
  });

  describe('leads pool', () => {
    let leadId: number;

    it('creates a lead, normalising the phone', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const r = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({
          phone: '8 900 555-00-11',
          first_name: 'Олег',
          city: 'Москва',
          age: 34,
        })
        .expect(200);
      expect(r.body).toMatchObject({
        phone_e164: '+79005550011',
        first_name: 'Олег',
        status: 'pending',
        telegram_user_id: null,
      });
      leadId = r.body.id;
      await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ phone: '+79005550011' })
        .expect(422);
      await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ phone: '12345' })
        .expect(422);
    });

    it('imports pasted lines, skipping duplicates and reporting bad rows', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const r = await request(app.getHttpServer())
        .post('/api/leads/import')
        .set(h)
        .send({
          text: '+79005550011;Олег\n+79005550022;Ира;Казань;28\n8 900 555 00 22\nabc\n+79005550033',
          queue: true,
        })
        .expect(200);
      expect(r.body).toEqual({
        created: 2,
        duplicates: 2,
        errors: ['строка 4: не похоже на телефон или @username — «abc»'],
      });
      const list = await request(app.getHttpServer())
        .get('/api/leads?status=queued')
        .set(h)
        .expect(200);
      expect(list.body.items.map((l) => l.phone_e164).sort()).toEqual([
        '+79005550022',
        '+79005550033',
      ]);
      expect(list.body.counts).toMatchObject({
        pending: 1,
        queued: 2,
        total: 3,
      });
    });

    it('queue / unqueue move leads between pending and queued', async () => {
      const h = { Authorization: `Bearer ${token}` };
      expect(
        (
          await request(app.getHttpServer())
            .post('/api/leads/start')
            .set(h)
            .send({})
            .expect(200)
        ).body,
      ).toEqual({ queued: 1 });
      expect(
        (
          await request(app.getHttpServer())
            .post('/api/leads/stop')
            .set(h)
            .send({ ids: [leadId] })
            .expect(200)
        ).body,
      ).toEqual({ unqueued: 1 });
      const l = await request(app.getHttpServer())
        .get(`/api/leads?q=${encodeURIComponent('Олег')}`)
        .set(h)
        .expect(200);
      expect(l.body.items).toHaveLength(1);
      expect(l.body.items[0].status).toBe('pending');
    });

    it('edit, outreach status, delete', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const u = await request(app.getHttpServer())
        .put(`/api/leads/${leadId}`)
        .set(h)
        .send({ city: 'Тверь', age: 35 })
        .expect(200);
      expect(u.body).toMatchObject({
        city: 'Тверь',
        age: 35,
        first_name: 'Олег',
      });
      const st = await request(app.getHttpServer())
        .get('/api/leads/outreach')
        .set(h)
        .expect(200);
      expect(st.body).toMatchObject({
        enabled: false,
        daily_per_account: expect.any(Number),
        accounts: [],
      });
      await request(app.getHttpServer())
        .delete(`/api/leads/${leadId}`)
        .set(h)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/leads/${leadId}`)
        .set(h)
        .expect(404);
    });

    it('сводка прозвона у менеджера — только его аккаунты', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const a1 = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110041', persona_id: 'nastya' })
        .expect(200);
      const a2 = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110042', persona_id: 'nastya' })
        .expect(200);
      await prisma.tgAccount.updateMany({
        where: { id: { in: [a1.body.id, a2.body.id] } },
        data: { status: 'active' },
      });
      const created = await request(app.getHttpServer())
        .post('/api/managers')
        .set(h)
        .send({
          username: 'olga',
          password: 'olga12345',
          role: 'manager',
          region_code: '0077',
        })
        .expect(200);
      const olga = created.body.items.find((m) => m.username === 'olga');
      await request(app.getHttpServer())
        .put(`/api/managers/accounts/${a1.body.id}`)
        .set(h)
        .send({ user_id: olga.user_id })
        .expect(200);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'olga', password: 'olga12345' })
        .expect(200);
      const mh = { Authorization: `Bearer ${login.body.tokens.accessToken}` };

      const ids = (body) => body.accounts.map((a) => a.account_id);
      const admin = await request(app.getHttpServer())
        .get('/api/leads/outreach')
        .set(h)
        .expect(200);
      expect(ids(admin.body)).toEqual(
        expect.arrayContaining([a1.body.id, a2.body.id]),
      );
      const mine = await request(app.getHttpServer())
        .get('/api/leads/outreach')
        .set(mh)
        .expect(200);
      expect(ids(mine.body)).toEqual([a1.body.id]);

      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${a1.body.id}`)
        .set(h)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${a2.body.id}`)
        .set(h)
        .expect(200);
    });

    it('менеджеры не видят лидов друг друга, рассылка пишет лиду только с аккаунта его менеджера', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const worker = app.get(OutreachWorker);
      const telegram = app.get(TelegramService);
      const now = Math.floor(Date.now() / 1000);
      const loginAs = async (username: string) => {
        const created = await request(app.getHttpServer())
          .post('/api/managers')
          .set(h)
          .send({
            username,
            password: `${username}12345`,
            role: 'manager',
            region_code: '0077',
          })
          .expect(200);
        const login = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ username, password: `${username}12345` })
          .expect(200);
        return {
          id: created.body.items.find((m) => m.username === username).user_id,
          h: { Authorization: `Bearer ${login.body.tokens.accessToken}` },
        };
      };
      const ira = await loginAs('ira');
      const lena = await loginAs('lena');
      const accIra = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110051', persona_id: 'nastya' })
        .expect(200);
      await request(app.getHttpServer())
        .put(`/api/managers/accounts/${accIra.body.id}`)
        .set(h)
        .send({ user_id: ira.id })
        .expect(200);

      const leadIra = await request(app.getHttpServer())
        .post('/api/leads')
        .set(ira.h)
        .send({ username: '@ira_lead' })
        .expect(200);
      const imported = await request(app.getHttpServer())
        .post('/api/leads/import')
        .set(lena.h)
        .send({ text: '@lena_lead' })
        .expect(200);
      expect(imported.body.created).toBe(1);
      const leadLena = await prisma.phoneNumber.findUnique({
        where: { usernameKey: 'lena_lead' },
      });
      expect(leadLena!.ownerUserId).toBe(lena.id);

      const seen = async (hh) =>
        (
          await request(app.getHttpServer())
            .get('/api/leads')
            .set(hh)
            .expect(200)
        ).body.items.map((l) => l.username);
      expect(await seen(ira.h)).toEqual(['ira_lead']);
      expect(await seen(lena.h)).toEqual(['lena_lead']);
      expect(await seen(h)).toEqual(
        expect.arrayContaining(['ira_lead', 'lena_lead']),
      );
      // Чужой лид нельзя ни изменить, ни поставить в очередь, ни удалить; дубль — без номера и статуса чужого лида.
      await request(app.getHttpServer())
        .put(`/api/leads/${leadLena!.id}`)
        .set(ira.h)
        .send({ city: 'Омск' })
        .expect(404);
      expect(
        (
          await request(app.getHttpServer())
            .post('/api/leads/start')
            .set(ira.h)
            .send({ ids: [leadLena!.id] })
            .expect(200)
        ).body,
      ).toEqual({ queued: 0 });
      await request(app.getHttpServer())
        .delete(`/api/leads/${leadLena!.id}`)
        .set(ira.h)
        .expect(404);
      const dup = await request(app.getHttpServer())
        .post('/api/leads')
        .set(ira.h)
        .send({ username: '@lena_lead' })
        .expect(422);
      expect(JSON.stringify(dup.body)).toMatch(/у другого пользователя/);
      expect(JSON.stringify(dup.body)).not.toMatch(/лид #/);

      // Оба лида в очереди, но аккаунт Иры берёт только лида Иры.
      await prisma.phoneNumber.updateMany({
        where: { status: 'queued' },
        data: { status: 'pending' },
      });
      await prisma.phoneNumber.updateMany({
        where: { id: { in: [leadIra.body.id, leadLena!.id] } },
        data: { status: 'queued' },
      });
      const resolve = jest
        .spyOn(telegram, 'resolveUsername')
        .mockResolvedValue({ kind: 'not_found' } as any);
      await (worker as any).processOne(accIra.body.id, now);
      await (worker as any).processOne(accIra.body.id, now + 400);
      const calls = resolve.mock.calls.map((c) => c[1]);
      resolve.mockRestore();
      expect(calls).toEqual(['ira_lead']);
      expect(
        (await prisma.phoneNumber.findUnique({ where: { id: leadLena!.id } }))!
          .status,
      ).toBe('queued');

      await request(app.getHttpServer())
        .delete(`/api/leads/${leadIra.body.id}`)
        .set(h)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/leads/${leadLena!.id}`)
        .set(h)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${accIra.body.id}`)
        .set(h)
        .expect(200);
    });

    it('флуд на аккаунте: метка «флуд до …», лид сразу свободен другому; «написать с другого»; «снять флуд»', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const worker = app.get(OutreachWorker);
      const telegram = app.get(TelegramService);
      const now = Math.floor(Date.now() / 1000);

      const a1 = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110001', persona_id: 'nastya' })
        .expect(200);
      const a2 = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110002', persona_id: 'nastya' })
        .expect(200);
      await prisma.tgAccount.update({
        where: { id: a1.body.id },
        data: { status: 'active', username: 'nastyayasz1' },
      });
      const lead = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ phone: '+7 900 555-66-77', first_name: 'Антон' })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/leads/start')
        .set(h)
        .send({ ids: [lead.body.id] })
        .expect(200);
      // Воркер берёт самого старого в очереди — остальные лиды из прошлых проверок выводим из неё.
      await prisma.phoneNumber.updateMany({
        where: { status: 'queued', id: { not: lead.body.id } },
        data: { status: 'pending' },
      });

      // Telegram отвечает FLOOD_WAIT на 6 часов — ровно тот случай.
      const flood = Object.assign(
        new Error('A wait of 21600 seconds is required (FLOOD_WAIT_21600)'),
        { errorMessage: 'FLOOD_WAIT', seconds: 21600 },
      );
      const resolveSpy = jest
        .spyOn(telegram, 'resolvePhone')
        .mockRejectedValueOnce(flood);
      await (worker as any).processOne(a1.body.id, now);
      resolveSpy.mockRestore();

      const afterFlood = (
        await request(app.getHttpServer()).get('/api/leads').set(h).expect(200)
      ).body.items.find((l) => l.id === lead.body.id);
      // Лид не ждёт 6 часов на этом аккаунте: в очереди, ни к кому не привязан, в ошибке — кто и до скольки.
      expect(afterFlood).toMatchObject({
        status: 'queued',
        assigned_account_id: null,
        next_attempt_at: null,
      });
      expect(afterFlood.last_error).toMatch(
        /@nastyayasz1: флуд от Telegram до \d\d:\d\d МСК — отдан другому аккаунту/,
      );

      const accounts = (
        await request(app.getHttpServer())
          .get('/api/tg-accounts')
          .set(h)
          .expect(200)
      ).body;
      const limited = accounts.find((a) => a.id === a1.body.id);
      expect(limited.flood_until).toBeGreaterThanOrEqual(now + 21600);
      expect(limited.flood_reason).toBe('флуд от Telegram');

      // Ограниченный аккаунт в рассылку не берётся, свободный — берётся.
      jest
        .spyOn(telegram, 'onlineIds')
        .mockReturnValue([a1.body.id, a2.body.id]);
      await prisma.tgAccount.update({
        where: { id: a2.body.id },
        data: { status: 'active' },
      });
      const eligible = await (worker as any).eligibleAccounts(now);
      expect(eligible).toEqual([a2.body.id]);
      (telegram.onlineIds as jest.Mock).mockRestore();

      // «Написать с другого»: лид привязан к аккаунту, первого сообщения не было.
      await prisma.phoneNumber.update({
        where: { id: lead.body.id },
        data: { assignedAccountId: a2.body.id, status: 'assigned' },
      });
      const moved = await request(app.getHttpServer())
        .post(`/api/leads/${lead.body.id}/write-from-another`)
        .set(h)
        .expect(200);
      expect(moved.body).toMatchObject({
        status: 'queued',
        assigned_account_id: null,
        avoid_account_id: a2.body.id,
        last_error: null,
      });
      // Этот аккаунт лид больше не возьмёт.
      const claim = await prisma.phoneNumber.findFirst({
        where: {
          id: lead.body.id,
          OR: [
            { avoidAccountId: null },
            { avoidAccountId: { not: a2.body.id } },
          ],
        },
      });
      expect(claim).toBeNull();

      // Уже написали — второе «первое» сообщение с другого аккаунта не отправляем.
      await prisma.phoneNumber.update({
        where: { id: lead.body.id },
        data: { firstContactAt: now, status: 'contacted' },
      });
      await request(app.getHttpServer())
        .post(`/api/leads/${lead.body.id}/write-from-another`)
        .set(h)
        .expect(422);

      // Снять флуд вручную.
      const cleared = await request(app.getHttpServer())
        .post(`/api/tg-accounts/${a1.body.id}/clear-flood`)
        .set(h)
        .expect(200);
      expect(cleared.body).toMatchObject({
        flood_until: null,
        flood_reason: null,
      });

      await request(app.getHttpServer())
        .delete(`/api/leads/${lead.body.id}`)
        .set(h)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${a1.body.id}`)
        .set(h)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${a2.body.id}`)
        .set(h)
        .expect(200);
    });

    it('лид с выбранной личностью пишет только аккаунт этой личности', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const worker = app.get(OutreachWorker);
      const telegram = app.get(TelegramService);
      const now = Math.floor(Date.now() / 1000);

      const lena = await request(app.getHttpServer())
        .post('/api/personas')
        .set(h)
        .send({ name: 'Лена', slug: 'lena-outreach' })
        .expect(200);
      const aNastya = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110011', persona_id: 'nastya' })
        .expect(200);
      const aLena = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110012', persona_id: 'lena-outreach' })
        .expect(200);
      await prisma.tgAccount.updateMany({
        where: { id: { in: [aNastya.body.id, aLena.body.id] } },
        data: { status: 'active' },
      });

      // Выбор у лида: личности с числом аккаунтов, несуществующая — отказ словами.
      const choices = await request(app.getHttpServer())
        .get('/api/leads/personas')
        .set(h)
        .expect(200);
      expect(
        choices.body.items.find((x) => x.slug === 'lena-outreach'),
      ).toMatchObject({ name: 'Лена', accounts: 1 });
      const bad = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ phone: '+7 900 555-77-01', persona_id: 'nope' })
        .expect(422);
      expect(JSON.stringify(bad.body)).toMatch(/личности «nope» нет/);

      const lead = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({
          phone: '+7 900 555-77-02',
          first_name: 'Игорь',
          persona_id: 'lena-outreach',
        })
        .expect(200);
      expect(lead.body).toMatchObject({
        persona_id: 'lena-outreach',
        persona_name: 'Лена',
      });
      await request(app.getHttpServer())
        .post('/api/leads/start')
        .set(h)
        .send({ ids: [lead.body.id] })
        .expect(200);
      await prisma.phoneNumber.updateMany({
        where: { status: 'queued', id: { not: lead.body.id } },
        data: { status: 'pending' },
      });

      const resolve = jest
        .spyOn(telegram, 'resolvePhone')
        .mockResolvedValue({ kind: 'not_found' });
      // Аккаунт Насти лида Лены не берёт.
      await (worker as any).processOne(aNastya.body.id, now);
      expect(resolve).not.toHaveBeenCalled();
      // Аккаунт Лены — берёт (номер «не найден» — лишь чтобы не отправлять сообщение в тесте).
      await (worker as any).processOne(aLena.body.id, now);
      expect(resolve).toHaveBeenCalledWith(
        aLena.body.id,
        '+79005557702',
        'Игорь',
      );
      resolve.mockRestore();
      const taken = await prisma.phoneNumber.findUnique({
        where: { id: lead.body.id },
      });
      expect(taken).toMatchObject({
        assignedAccountId: aLena.body.id,
        status: 'dead',
      });

      // Лид без личности берёт любой аккаунт — поведение как раньше.
      const any = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ phone: '+7 900 555-77-03' })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/leads/start')
        .set(h)
        .send({ ids: [any.body.id] })
        .expect(200);
      const resolveAny = jest
        .spyOn(telegram, 'resolvePhone')
        .mockResolvedValue({ kind: 'not_found' });
      await (worker as any).processOne(aNastya.body.id, now);
      expect(resolveAny).toHaveBeenCalledWith(
        aNastya.body.id,
        '+79005557703',
        undefined,
      );
      resolveAny.mockRestore();

      // Сменить личность можно до первого сообщения, после — нельзя.
      const changed = await request(app.getHttpServer())
        .put(`/api/leads/${lead.body.id}`)
        .set(h)
        .send({ persona_id: 'nastya' })
        .expect(200);
      expect(changed.body).toMatchObject({
        persona_id: 'nastya',
        persona_name: 'Настя',
        assigned_account_id: null,
      });
      await prisma.phoneNumber.update({
        where: { id: lead.body.id },
        data: { firstContactAt: now, status: 'contacted' },
      });
      await request(app.getHttpServer())
        .put(`/api/leads/${lead.body.id}`)
        .set(h)
        .send({ persona_id: 'lena-outreach' })
        .expect(422);

      for (const id of [lead.body.id, any.body.id])
        await request(app.getHttpServer())
          .delete(`/api/leads/${id}`)
          .set(h)
          .expect(200);
      for (const id of [aNastya.body.id, aLena.body.id])
        await request(app.getHttpServer())
          .delete(`/api/tg-accounts/${id}`)
          .set(h)
          .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/personas/${lena.body.id}`)
        .set(h)
        .expect(200);
    });

    describe('выбор Telegram-аккаунта при добавлении лида', () => {
      let h: Record<string, string>, mh: Record<string, string>;
      let managerId: number, own: number, other: number, foreign: number;
      const created: number[] = [];
      beforeAll(async () => {
        h = { Authorization: `Bearer ${token}` };
        const manager = await request(app.getHttpServer())
          .post('/api/managers')
          .set(h)
          .send({
            username: 'sender-choice',
            password: 'sender-choice-pass',
            role: 'manager',
            region_code: '0777',
          })
          .expect(200);
        managerId = manager.body.created_user_id;
        const login = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ username: 'sender-choice', password: 'sender-choice-pass' })
          .expect(200);
        mh = { Authorization: `Bearer ${login.body.tokens.accessToken}` };
        const ids: number[] = [];
        for (const suffix of ['81', '82', '83']) {
          const a = await request(app.getHttpServer())
            .post('/api/tg-accounts')
            .set(h)
            .send({ phone_e164: `+790011101${suffix}`, persona_id: 'nastya' })
            .expect(200);
          ids.push(a.body.id);
        }
        [own, other, foreign] = ids;
        await app.get(PrismaService).tgAccount.updateMany({
          where: { id: { in: ids } },
          data: { status: 'active' },
        });
        await app.get(PrismaService).managerAccount.createMany({
          data: [own, other].map((tgAccountId) => ({
            userId: managerId,
            tgAccountId,
          })),
        });
      });
      afterEach(async () => {
        jest.restoreAllMocks();
        for (const id of created.splice(0))
          await request(app.getHttpServer())
            .delete(`/api/leads/${id}`)
            .set(h)
            .expect(200);
        await app.get(PrismaService).tgAccount.updateMany({
          where: { id: { in: [own, other, foreign] } },
          data: { floodUntil: null, floodReason: null, status: 'active' },
        });
      });
      afterAll(async () => {
        for (const id of [own, other, foreign])
          await request(app.getHttpServer())
            .delete(`/api/tg-accounts/${id}`)
            .set(h)
            .expect(200);
        await request(app.getHttpServer())
          .delete(`/api/managers/${managerId}`)
          .set(h)
          .expect(200);
      });
      async function create(username: string, extra = {}) {
        const result = await request(app.getHttpServer())
          .post('/api/leads')
          .set(mh)
          .send({ username, ...extra })
          .expect(200);
        created.push(result.body.id);
        return result.body;
      }
      async function queue(id: number) {
        await app.get(PrismaService).phoneNumber.updateMany({
          where: { status: 'queued' },
          data: { status: 'pending' },
        });
        await request(app.getHttpServer())
          .post('/api/leads/start')
          .set(mh)
          .send({ ids: [id] })
          .expect(200);
      }
      it('отклоняет чужой, выключенный, неверный аккаунт и несовместимую личность', async () => {
        const post = (data) =>
          request(app.getHttpServer())
            .post('/api/leads')
            .set(mh)
            .send({ username: '@sender_validation', ...data });
        await post({ preferred_account_id: foreign }).expect(422);
        await post({ preferred_account_id: 999999 }).expect(422);
        await post({ preferred_account_id: -1 }).expect(400);
        await post({ preferred_account_id: String(own) }).expect(400);
        await app
          .get(PrismaService)
          .tgAccount.update({ where: { id: own }, data: { status: 'paused' } });
        await post({ preferred_account_id: own }).expect(422);
        await app
          .get(PrismaService)
          .tgAccount.update({ where: { id: own }, data: { status: 'active' } });
        const persona = await request(app.getHttpServer())
          .post('/api/personas')
          .set(h)
          .send({ name: 'Другой отправитель', slug: 'sender-other' })
          .expect(200);
        await post({
          preferred_account_id: own,
          persona_id: 'sender-other',
        }).expect(422);
        await request(app.getHttpServer())
          .delete(`/api/personas/${persona.body.id}`)
          .set(h)
          .expect(200);
        await request(app.getHttpServer())
          .post('/api/leads/import')
          .set(mh)
          .send({
            items: [
              {
                username: '@sender_import_foreign',
                preferred_account_id: foreign,
              },
            ],
          })
          .expect(422);
        expect(
          await app.get(PrismaService).phoneNumber.count({
            where: { usernameKey: { startsWith: 'sender_' } },
          }),
        ).toBe(0);
      });
      it('выбранный аккаунт сохраняется после снятия с очереди; без выбора действует прежний подбор', async () => {
        const lead = await create('@sender_explicit', {
          preferred_account_id: own,
        });
        expect(lead).toMatchObject({
          preferred_account_id: own,
          assigned_account_id: null,
          persona_id: 'nastya',
          manager_id: managerId,
        });
        await queue(lead.id);
        await request(app.getHttpServer())
          .post('/api/leads/stop')
          .set(mh)
          .send({ ids: [lead.id] })
          .expect(200);
        expect(
          (
            await app
              .get(PrismaService)
              .phoneNumber.findUniqueOrThrow({ where: { id: lead.id } })
          ).preferredAccountId,
        ).toBe(own);
        await queue(lead.id);
        const resolve = jest
          .spyOn(app.get(TelegramService), 'resolveUsername')
          .mockResolvedValue({ kind: 'not_found' } as any);
        const worker = app.get(OutreachWorker) as any,
          now = Math.floor(Date.now() / 1000);
        await worker.processOne(other, now);
        expect(resolve).not.toHaveBeenCalled();
        await worker.processOne(own, now);
        expect(resolve).toHaveBeenCalledWith(own, 'sender_explicit');
        const automatic = await create('@sender_automatic');
        expect(automatic.preferred_account_id).toBeNull();
        await queue(automatic.id);
        resolve.mockClear();
        await worker.processOne(other, now);
        expect(resolve).toHaveBeenCalledWith(other, 'sender_automatic');
      });
      it('при флуде ждёт выбранный аккаунт; смена владельца не даёт чужому писать; ручной перенос отменяет выбор', async () => {
        const lead = await create('@sender_flood', {
          preferred_account_id: own,
        });
        await queue(lead.id);
        const now = Math.floor(Date.now() / 1000),
          worker = app.get(OutreachWorker) as any;
        const resolve = jest
          .spyOn(app.get(TelegramService), 'resolveUsername')
          .mockRejectedValueOnce(
            Object.assign(new Error('FLOOD_WAIT_3600'), {
              errorMessage: 'FLOOD_WAIT',
              seconds: 3600,
            }),
          );
        await worker.processOne(own, now);
        const waiting = await app
          .get(PrismaService)
          .phoneNumber.findUniqueOrThrow({ where: { id: lead.id } });
        expect(waiting).toMatchObject({
          status: 'queued',
          assignedAccountId: null,
          preferredAccountId: own,
          nextAttemptAt: now + 3600,
        });
        expect(waiting.lastError).toContain('ждём выбранный аккаунт');
        resolve.mockClear();
        await worker.processOne(other, now + 4000);
        expect(resolve).not.toHaveBeenCalled();
        await app
          .get(PrismaService)
          .managerAccount.delete({ where: { tgAccountId: own } });
        await worker.processOne(own, now + 4000);
        expect(resolve).not.toHaveBeenCalled();
        await app.get(PrismaService).managerAccount.create({
          data: { userId: managerId, tgAccountId: own },
        });
        const moved = await request(app.getHttpServer())
          .post(`/api/leads/${lead.id}/write-from-another`)
          .set(mh)
          .expect(200);
        expect(moved.body).toMatchObject({
          preferred_account_id: null,
          avoid_account_id: own,
          status: 'queued',
        });
        resolve.mockResolvedValue({ kind: 'not_found' } as any);
        await worker.processOne(other, now + 4000);
        expect(resolve).toHaveBeenCalledWith(other, 'sender_flood');
      });
    });

    it('аккаунт можно изменить: сменить личность, назначение и лимит', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const dasha = await request(app.getHttpServer())
        .post('/api/personas')
        .set(h)
        .send({ name: 'Даша', slug: 'dasha-edit' })
        .expect(200);
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110021', persona_id: 'nastya' })
        .expect(200);
      // Несуществующую личность не принимаем ни при добавлении, ни при правке.
      await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110022', persona_id: 'nope' })
        .expect(422);
      await request(app.getHttpServer())
        .put(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .send({ persona_id: 'nope' })
        .expect(422);

      // У аккаунта диалог и два лида: один взят под Настю, другой — без личности; оба ещё не написаны.
      await prisma.contact.create({
        data: {
          chatId: BigInt(777000111),
          accountId: acc.body.id,
          createdAt: 1,
        },
      });
      const leadNastya = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ phone: '+7 900 555-88-01', persona_id: 'nastya' })
        .expect(200);
      const leadAny = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ phone: '+7 900 555-88-02' })
        .expect(200);
      await prisma.phoneNumber.updateMany({
        where: { id: { in: [leadNastya.body.id, leadAny.body.id] } },
        data: { assignedAccountId: acc.body.id, status: 'queued' },
      });

      const listed = (
        await request(app.getHttpServer())
          .get('/api/tg-accounts')
          .set(h)
          .expect(200)
      ).body.find((a) => a.id === acc.body.id);
      expect(listed).toMatchObject({
        persona_id: 'nastya',
        persona_name: 'Настя',
        chats: 1,
      });

      const updated = await request(app.getHttpServer())
        .put(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .send({
          persona_id: 'dasha-edit',
          purpose: 'test',
          daily_msg_quota: 25,
        })
        .expect(200);
      expect(updated.body).toMatchObject({
        persona_id: 'dasha-edit',
        persona_name: 'Даша',
        purpose: 'test',
        daily_msg_quota: 25,
        chats: 1,
        released_leads: 1,
      });

      // Лид под Настю отпущен — его напишет аккаунт Насти; лид без личности остался за аккаунтом.
      const rows = await prisma.phoneNumber.findMany({
        where: { id: { in: [leadNastya.body.id, leadAny.body.id] } },
      });
      expect(
        rows.find((r) => r.id === leadNastya.body.id)!.assignedAccountId,
      ).toBeNull();
      expect(
        rows.find((r) => r.id === leadAny.body.id)!.assignedAccountId,
      ).toBe(acc.body.id);

      // Диалоги аккаунта ведёт новая личность — со следующего сообщения.
      const persona = await app.get(PersonaService).forAccount(acc.body.id);
      expect(persona.slug).toBe('dasha-edit');

      // Лимит можно снять.
      const unlimited = await request(app.getHttpServer())
        .put(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .send({ daily_msg_quota: null })
        .expect(200);
      expect(unlimited.body.daily_msg_quota).toBeNull();

      await prisma.contact.delete({ where: { chatId: BigInt(777000111) } });
      for (const id of [leadNastya.body.id, leadAny.body.id])
        await request(app.getHttpServer())
          .delete(`/api/leads/${id}`)
          .set(h)
          .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/personas/${dasha.body.id}`)
        .set(h)
        .expect(200);
    });

    it('удаление лида стирает его чат: добавленный снова, он начинает знакомство заново', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const chatId = 7026943191;
      const id = BigInt(chatId);

      // Так было у Антона: лиду написали, он ответил, бот ответил, в очереди отложенный ответ.
      const lead = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ phone: '+7 900 555-99-01', first_name: 'Антон' })
        .expect(200);
      await prisma.phoneNumber.update({
        where: { id: lead.body.id },
        data: { telegramUserId: id, status: 'replied', firstContactAt: 1 },
      });
      await prisma.contact.create({
        data: { chatId: id, createdAt: 1, pauseState: 'paused' },
      });
      await prisma.message.createMany({
        data: [
          {
            chatId: id,
            ts: 1,
            role: 'assistant',
            text: 'Привет, это Настя с beboo',
            author: 'outreach',
          },
          {
            chatId: id,
            ts: 2,
            role: 'user',
            text: 'Приветики',
            author: 'client',
          },
        ],
      });
      await prisma.brainState.create({
        data: {
          chatId: id,
          stateJson: JSON.stringify({
            history: [{ role: 'assistant', content: 'Привет' }],
          }),
          updatedAt: 1,
        },
      });
      await prisma.leadFacts.create({
        data: { chatId: id, facts: JSON.stringify({ name: 'Антон' }) },
      });
      await prisma.replySchedule.create({
        data: {
          chatId: id,
          accountId: 1,
          dueAt: 9,
          baseDueAt: 9,
          reason: 'normal',
          createdAt: 1,
        },
      });

      const removed = await request(app.getHttpServer())
        .delete(`/api/leads/${lead.body.id}`)
        .set(h)
        .expect(200);
      expect(removed.body).toMatchObject({
        ok: true,
        wiped_chat: chatId,
        messages: 2,
      });
      for (const [name, count] of [
        ['messages', await prisma.message.count({ where: { chatId: id } })],
        [
          'brain_state',
          await prisma.brainState.count({ where: { chatId: id } }),
        ],
        [
          'pinned_facts',
          await prisma.leadFacts.count({ where: { chatId: id } }),
        ],
        [
          'reply_schedule',
          await prisma.replySchedule.count({ where: { chatId: id } }),
        ],
        ['contacts', await prisma.contact.count({ where: { chatId: id } })],
      ] as const) {
        expect([name, count]).toEqual([name, 0]);
      }

      // Тот же человек снова: первое сообщение уходит, ошибки «already has a transcript» нет.
      const brain = app.get(REPLY_BRAIN_TOKEN);
      const telegram = app.get(TelegramService);
      const send = jest.spyOn(telegram, 'sendText').mockResolvedValue([1]);
      const text = await brain.openLead(chatId, 1, { firstName: 'Антон' });
      expect(text).toMatch(/Привет/);
      expect(send).toHaveBeenCalled();
      send.mockRestore();

      // Если на чат ссылается другой лид — там живая переписка, чат не трогаем.
      const a = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ phone: '+7 900 555-99-02' })
        .expect(200);
      const b = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ phone: '+7 900 555-99-03' })
        .expect(200);
      await prisma.phoneNumber.updateMany({
        where: { id: { in: [a.body.id, b.body.id] } },
        data: { telegramUserId: id },
      });
      const kept = await request(app.getHttpServer())
        .delete(`/api/leads/${a.body.id}`)
        .set(h)
        .expect(200);
      expect(kept.body).toMatchObject({ wiped_chat: null });
      expect(
        await prisma.message.count({ where: { chatId: id } }),
      ).toBeGreaterThan(0);
      await request(app.getHttpServer())
        .delete(`/api/leads/${b.body.id}`)
        .set(h)
        .expect(200);
      expect(await prisma.message.count({ where: { chatId: id } })).toBe(0);
    });

    it('случай 14.09: удалили лида по-старому, сменили личность у нового, удалили, добавили — рассылка начинает заново', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const worker = app.get(OutreachWorker);
      const telegram = app.get(TelegramService);
      const chatId = 7026943192;
      const id = BigInt(chatId);
      const now = Math.floor(Date.now() / 1000);

      // Чат остался от лида №7, удалённого до исправления: 2 сообщения, пометка рассылки в карточке.
      await prisma.contact.create({ data: { chatId: id, createdAt: 1 } });
      await prisma.message.createMany({
        data: [
          {
            chatId: id,
            ts: 1,
            role: 'assistant',
            text: 'Привет, это Настя с beboo',
            author: 'outreach',
          },
          {
            chatId: id,
            ts: 2,
            role: 'user',
            text: 'Приветики',
            author: 'client',
          },
        ],
      });
      await prisma.leadFacts.create({
        data: {
          chatId: id,
          facts: JSON.stringify({ name: 'Антон', _outreach_lead_id: 999777 }),
        },
      });
      await prisma.brainState.create({
        data: {
          chatId: id,
          stateJson: JSON.stringify({
            history: [{ role: 'assistant', content: 'Привет' }],
          }),
          updatedAt: 1,
        },
      });

      // Новый лид на того же человека: смена личности больше не рвёт связь с чатом.
      const lead = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ username: '@aladin_test', first_name: 'Саша' })
        .expect(200);
      await prisma.phoneNumber.update({
        where: { id: lead.body.id },
        data: { telegramUserId: id, assignedAccountId: null, status: 'queued' },
      });
      await request(app.getHttpServer())
        .put(`/api/leads/${lead.body.id}`)
        .set(h)
        .send({ persona_id: 'nastya' })
        .expect(200);
      expect(
        (await prisma.phoneNumber.findUnique({ where: { id: lead.body.id } }))!
          .telegramUserId,
      ).toBe(id);

      // Рассылка берёт этого лида: чат от удалённого — стирается, первое сообщение уходит.
      await prisma.phoneNumber.updateMany({
        where: { status: 'queued', id: { not: lead.body.id } },
        data: { status: 'pending' },
      });
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110031', persona_id: 'nastya' })
        .expect(200);
      const resolve = jest
        .spyOn(telegram, 'resolveUsername')
        .mockResolvedValue({
          kind: 'found',
          userId: chatId,
          username: 'aladin_test',
          deleted: false,
        });
      const send = jest.spyOn(telegram, 'sendText').mockResolvedValue([1]);
      await (worker as any).processOne(acc.body.id, now);
      resolve.mockRestore();
      send.mockRestore();

      const sent = await prisma.phoneNumber.findUnique({
        where: { id: lead.body.id },
      });
      expect(sent).toMatchObject({ status: 'contacted', lastError: null });
      const messages = await prisma.message.findMany({ where: { chatId: id } });
      // Старых «Приветики» нет — только новое первое сообщение.
      expect(messages.map((m) => m.author)).toEqual(['outreach']);

      // Живой чат (человек писал сам, без пометки рассылки) рассылка не стирает — отказ словами.
      const liveId = BigInt(7026943193);
      await prisma.message.create({
        data: {
          chatId: liveId,
          ts: 1,
          role: 'user',
          text: 'привет, это я сам',
          author: 'client',
        },
      });
      await prisma.brainState.create({
        data: {
          chatId: liveId,
          stateJson: JSON.stringify({
            history: [{ role: 'user', content: 'привет, это я сам' }],
          }),
          updatedAt: 1,
        },
      });
      const live = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ username: '@live_test', first_name: 'Лёша' })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/leads/start')
        .set(h)
        .send({ ids: [live.body.id] })
        .expect(200);
      await prisma.phoneNumber.updateMany({
        where: { status: 'queued', id: { not: live.body.id } },
        data: { status: 'pending' },
      });
      const resolveLive = jest
        .spyOn(telegram, 'resolveUsername')
        .mockResolvedValue({
          kind: 'found',
          userId: 7026943193,
          username: 'live_test',
          deleted: false,
        });
      await (worker as any).processOne(acc.body.id, now + 400);
      resolveLive.mockRestore();
      const liveRow = await prisma.phoneNumber.findUnique({
        where: { id: live.body.id },
      });
      expect(liveRow!.status).toBe('dead');
      expect(liveRow!.lastError).toMatch(/уже есть переписка/);
      expect(await prisma.message.count({ where: { chatId: liveId } })).toBe(1);

      // Удаление лида находит чат, даже если связь в лиде уже пуста, — по пометке в карточке.
      await prisma.phoneNumber.update({
        where: { id: lead.body.id },
        data: { telegramUserId: null },
      });
      const removed = await request(app.getHttpServer())
        .delete(`/api/leads/${lead.body.id}`)
        .set(h)
        .expect(200);
      expect(removed.body).toMatchObject({ wiped_chat: chatId });
      expect(await prisma.message.count({ where: { chatId: id } })).toBe(0);

      await request(app.getHttpServer())
        .delete(`/api/leads/${live.body.id}`)
        .set(h)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('голосовое клиента играет в панели: файл по ссылке с ?token=, без токена — 401, менять по ссылке нельзя', async () => {
      const prisma = app.get(PrismaService);
      const chatId = 777000222;
      const mediaDir = join(process.env.DATA_DIR!, 'media', 'inbound', 'e2e');
      mkdirSync(mediaDir, { recursive: true });
      const path = join(mediaDir, `${chatId}_1.ogg`);
      writeFileSync(path, Buffer.from('OggS-e2e-voice'));
      await prisma.contact.create({
        data: { chatId: BigInt(chatId), createdAt: 1 },
      });
      await prisma.inboundMedia.create({
        data: {
          chatId: BigInt(chatId),
          msgTs: 1789391755,
          kind: 'voice',
          path,
          savedAt: 1789391755,
        },
      });

      const url = `/api/conversations/${chatId}/media/1789391755`;
      await request(app.getHttpServer()).get(url).expect(401);
      const ok = await request(app.getHttpServer())
        .get(`${url}?token=${encodeURIComponent(token)}`)
        .expect(200);
      expect(ok.headers['content-type']).toMatch(/^audio\/ogg/);
      await request(app.getHttpServer())
        .get(`${url}?token=испорченный`)
        .expect(401);
      // Токен в адресе — только на чтение.
      await request(app.getHttpServer())
        .post(`/api/leads?token=${encodeURIComponent(token)}`)
        .send({ phone: '+7 900 000-00-99' })
        .expect(401);

      await prisma.inboundMedia.deleteMany({
        where: { chatId: BigInt(chatId) },
      });
      await prisma.contact.delete({ where: { chatId: BigInt(chatId) } });
      rmSync(mediaDir, { recursive: true, force: true });
    });

    it('просит фото — бот молчит, чат в очереди менеджера с причиной; вернули боту — метка снята', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const persona = app.get(PersonaService);
      const brain = app.get(REPLY_BRAIN_TOKEN) as any;
      const chatId = 777000333;
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110051', persona_id: 'nastya' })
        .expect(200);
      await prisma.contact.create({
        data: { chatId: BigInt(chatId), accountId: acc.body.id, createdAt: 1 },
      });
      const sentAt = Math.floor(Date.now() / 1000) - 60;
      await prisma.message.create({
        data: {
          chatId: BigInt(chatId),
          ts: sentAt,
          role: 'user',
          text: 'скинь фотку свою',
          author: 'client',
          sourceMessageId: 5,
          tgMsgId: 5,
        },
      });

      // Судья видит просьбу: дальше генератор и проверка не вызываются вовсе — деньги не тратятся.
      const calls: string[] = [];
      const create = jest
        .spyOn(persona.anthropic.messages, 'create')
        .mockImplementation((async (body: any) => {
          const system = body.system[0].text;
          calls.push(
            system.includes('media_request')
              ? 'judge_plan'
              : system.includes('местонахождение')
                ? 'time_location'
                : 'other',
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  intent: 'просит фото',
                  goal: 'respond',
                  media_request: 'photo',
                }),
              },
            ],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }) as any);
      const ready = jest.spyOn(persona, 'ready', 'get').mockReturnValue(true);
      const reply = await brain.generateReply(chatId, 'скинь фотку свою', '');
      create.mockRestore();
      ready.mockRestore();
      expect(reply).toBeNull();
      // Определение города для часов кешируется на неделю; дорогие этапы —
      // генератор и проверка — не вызываются вовсе.
      expect(calls.filter((c) => c !== 'time_location')).toEqual([
        'judge_plan',
      ]);

      const detail = await request(app.getHttpServer())
        .get(`/api/conversations/${chatId}`)
        .set(h)
        .expect(200);
      expect(detail.body.is_paused).toBe(true);
      const queue = await request(app.getHttpServer())
        .get('/api/manager/queue')
        .set(h)
        .expect(200);
      expect(queue.body.items.find((x) => x.chat_id === chatId)).toMatchObject({
        queue_reason: 'media_photo',
      });
      const pause = await prisma.contact.findUnique({
        where: { chatId: BigInt(chatId) },
      });
      expect(pause!.pauseReason).toMatch(/просит фото/);
      // Вернули боту — метка снята, а его неотвеченное сообщение встаёт в очередь ответа (случай 15.09:
      // после возврата бот молчал, пока человек не напишет снова).
      const readyAgain = jest
        .spyOn(persona, 'ready', 'get')
        .mockReturnValue(true);
      await request(app.getHttpServer())
        .post(`/api/conversations/${chatId}/resume`)
        .set(h)
        .expect((r) => expect(r.status).toBeLessThan(300));
      readyAgain.mockRestore();
      const facts = JSON.parse(
        (await prisma.leadFacts.findUnique({
          where: { chatId: BigInt(chatId) },
        }))!.facts,
      );
      expect(facts._media_request).toBeUndefined();
      const scheduled = await prisma.replySchedule.findUnique({
        where: { chatId: BigInt(chatId) },
      });
      expect(scheduled).not.toBeNull();
      expect(
        JSON.parse(scheduled!.turns as unknown as string).map(
          (t: any) => t.text,
        ),
      ).toEqual(['скинь фотку свою']);
      // Строка сообщения не задвоилась.
      expect(
        await prisma.message.count({
          where: { chatId: BigInt(chatId), role: 'user' },
        }),
      ).toBe(1);

      // «Договорились )» после обещания фото — модель может увидеть «просьбу», но слов про медиа нет: чат не отдаётся.
      await prisma.replySchedule.deleteMany({
        where: { chatId: BigInt(chatId) },
      });
      const create2 = jest
        .spyOn(persona.anthropic.messages, 'create')
        .mockImplementation((async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                intent: 'согласие',
                goal: 'respond',
                media_request: 'photo',
              }),
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        })) as any);
      const ready2 = jest.spyOn(persona, 'ready', 'get').mockReturnValue(true);
      await brain
        .generateReply(
          chatId,
          ['Договорились )', 'Так что там по брату? Все хорошо?'].join('\n'),
          '',
        )
        .catch(() => null);
      create2.mockRestore();
      ready2.mockRestore();
      expect(
        (await prisma.contact.findUnique({
          where: { chatId: BigInt(chatId) },
        }))!.pauseState,
      ).toBe('active');

      await app.get(TelegramService)['history'].wipeChat(chatId);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);

      // Чат, аккаунт которого удалён, в очередь не попадает: ответить в нём некому.
      const orphan = 777000334;
      await prisma.contact.create({
        data: {
          chatId: BigInt(orphan),
          accountId: null,
          createdAt: 1,
          pauseState: 'paused',
          pauseReason: 'human_takeover',
          pausedTs: 1,
        },
      });
      const q2 = await request(app.getHttpServer())
        .get('/api/manager/queue')
        .set(h)
        .expect(200);
      expect(q2.body.items.find((x) => x.chat_id === orphan)).toBeUndefined();
      await prisma.contact.delete({ where: { chatId: BigInt(orphan) } });
    });

    it('голосовое расшифровывается: текст в истории и в панели, расход — в статистике; повтор доставки не платится', async () => {
      const prisma = app.get(PrismaService);
      const brain = app.get(REPLY_BRAIN_TOKEN) as any;
      const chatId = 777000337;
      const h = { Authorization: `Bearer ${token}` };
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110199', persona_id: 'nastya' })
        .expect(200);
      const dir = mkdtempSync(join(tmpdir(), 'voice-'));
      const path = join(dir, 'v.ogg');
      writeFileSync(path, Buffer.from('OggS fake voice'));
      const key = appConfig.openaiApiKey;
      (appConfig as any).openaiApiKey = 'sk-test';
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation((async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            text: 'Привет, я сегодня на рыбалке был',
            usage: { input_tokens: 90, output_tokens: 11 },
          }),
        })) as any);
      const turn = () => ({
        chatId,
        accountId: acc.body.id,
        messageId: 41,
        ts: Math.floor(Date.now() / 1000),
        text: '',
        media: { kind: 'voice', path, duration: 4 },
      });
      await brain.handleInbound(turn());
      await brain.handleInbound(turn()); // Telegram прислал то же сообщение ещё раз
      const fetchCalls = fetchSpy.mock.calls.length;
      fetchSpy.mockRestore();
      (appConfig as any).openaiApiKey = key;

      const stored = await prisma.message.findMany({
        where: { chatId: BigInt(chatId), role: 'user' },
      });
      expect(stored.map((m) => m.text)).toEqual([
        '[Голосовое сообщение]\nПривет, я сегодня на рыбалке был',
      ]);
      expect(fetchCalls).toBe(1);
      const usage = await prisma.modelUsage.findMany({
        where: { chatId: BigInt(chatId) },
      });
      expect(usage).toEqual([
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o-mini-transcribe',
          stage: 'transcribe',
          inputTokens: 90,
        }),
      ]);

      await prisma.modelUsage.deleteMany({ where: { chatId: BigInt(chatId) } });
      await app.get(TelegramService)['history'].wipeChat(chatId);
      rmSync(dir, { recursive: true, force: true });
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('выгрузка переписки в HTML: сообщения, кружок и голосовое с расшифровкой внутри файла, чужой файл не выносится', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const chatId = 777000338;
      const id = BigInt(chatId);
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110198', persona_id: 'nastya' })
        .expect(200);
      await prisma.contact.create({
        data: {
          chatId: id,
          accountId: acc.body.id,
          createdAt: 1,
          readOutboxMaxId: 5,
        },
      });
      await prisma.leadFacts.create({
        data: {
          chatId: id,
          facts: JSON.stringify({ name: 'Олег <script>', city: 'Тверь' }),
        },
      });
      const mediaDir = join(
        process.env.DATA_DIR!,
        'media',
        'inbound',
        String(acc.body.id),
      );
      mkdirSync(mediaDir, { recursive: true });
      const round = join(mediaDir, `${chatId}_2.mp4`);
      const voice = join(mediaDir, `${chatId}_3.ogg`);
      writeFileSync(round, Buffer.from('fake mp4'));
      writeFileSync(voice, Buffer.from('fake ogg'));
      await prisma.inboundMedia.createMany({
        data: [
          {
            chatId: id,
            msgTs: 1789000100,
            kind: 'video_note',
            path: round,
            savedAt: 1,
          },
          {
            chatId: id,
            msgTs: 1789000200,
            kind: 'voice',
            path: voice,
            savedAt: 1,
          },
          // Путь за пределами данных — в файл не попадает.
          {
            chatId: id,
            msgTs: 1789000300,
            kind: 'photo',
            path: '/etc/passwd',
            savedAt: 1,
          },
        ],
      });
      await prisma.message.createMany({
        data: [
          {
            chatId: id,
            ts: 1789000000,
            role: 'assistant',
            text: 'Привет) это Настя',
            author: 'outreach',
            tgMsgId: 5,
          },
          {
            chatId: id,
            ts: 1789000100,
            role: 'user',
            text: '[Кружок]',
            author: 'client',
            sourceMessageId: 2,
            tgMsgId: 2,
          },
          {
            chatId: id,
            ts: 1789000200,
            role: 'user',
            text: '[Голосовое сообщение]\nя на рыбалке',
            author: 'client',
            sourceMessageId: 3,
            tgMsgId: 3,
          },
          {
            chatId: id,
            ts: 1789000300,
            role: 'user',
            text: '[Фото]',
            author: 'client',
            sourceMessageId: 4,
            tgMsgId: 4,
          },
          {
            chatId: id,
            ts: 1789000400,
            role: 'assistant',
            text: 'ого, клёво',
            author: 'operator:web',
            tgMsgId: 6,
          },
        ],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/conversations/${chatId}/export.html`)
        .set(h)
        .expect(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      const html = res.text;
      expect(html).toContain('Олег &lt;script&gt;');
      expect(html).not.toContain('Олег <script>');
      expect(html).toContain('Привет) это Настя');
      expect(html).toContain('Бот · первое сообщение');
      expect(html).toContain('Менеджер');
      expect(html).toContain(
        `<video class="round" src="data:video/mp4;base64,${Buffer.from('fake mp4').toString('base64')}"`,
      );
      expect(html).toContain(
        `data:audio/ogg;base64,${Buffer.from('fake ogg').toString('base64')}`,
      );
      expect(html).toContain('я на рыбалке');
      expect(html).toContain('ticks--read');
      // Фото с путём вне каталога данных: подпись вместо файла, содержимого чужого файла нет.
      expect(html).not.toContain('root:');
      expect(html).toContain('>Фото<');

      await app.get(TelegramService)['history'].wipeChat(chatId);
      rmSync(mediaDir, { recursive: true, force: true });
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('альбом из трёх фото: у каждого сообщения свой файл, вкладка «Медиа» их показывает, файл отдаётся по id', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const brain = app.get(REPLY_BRAIN_TOKEN) as any;
      const chatId = 777000339;
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110197', persona_id: 'nastya' })
        .expect(200);
      const dir = join(
        process.env.DATA_DIR!,
        'media',
        'inbound',
        String(acc.body.id),
      );
      mkdirSync(dir, { recursive: true });
      const ts = Math.floor(Date.now() / 1000);
      for (const n of [189, 190, 191]) {
        const path = join(dir, `${chatId}_${n}.jpg`);
        writeFileSync(path, Buffer.from(`photo-${n}`));
        await brain.handleInbound({
          chatId,
          accountId: acc.body.id,
          messageId: n,
          ts,
          text: '',
          media: { kind: 'photo', path },
        });
      }
      const rows = await prisma.message.findMany({
        where: { chatId: BigInt(chatId) },
        orderBy: { id: 'asc' },
      });
      expect(rows.map((r) => r.filePath?.split(/[\\/]/).pop())).toEqual([
        `${chatId}_189.jpg`,
        `${chatId}_190.jpg`,
        `${chatId}_191.jpg`,
      ]);

      const gallery = await request(app.getHttpServer())
        .get(`/api/conversations/${chatId}/media-gallery`)
        .set(h)
        .expect(200);
      expect(gallery.body.items).toHaveLength(3);
      const file = await request(app.getHttpServer())
        .get(gallery.body.items[0].url)
        .set(h)
        .expect(200);
      expect(Buffer.from(file.body).toString()).toBe('photo-191');
      // Детали чата отдают ссылку на свой файл у каждого сообщения альбома — не одну на всех.
      const detail = await request(app.getHttpServer())
        .get(`/api/conversations/${chatId}`)
        .set(h)
        .expect(200);
      expect(new Set(detail.body.messages.map((m) => m.media_url)).size).toBe(
        3,
      );

      await app.get(TelegramService)['history'].wipeChat(chatId);
      rmSync(dir, { recursive: true, force: true });
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('несколько фото из панели уходят одним альбомом: по строке в ленте на каждое, подпись у первого', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const telegram = app.get(TelegramService);
      const relay = app.get(RelayWorker) as any;
      const chatId = 777000340;
      await prisma.contact.create({
        data: { chatId: BigInt(chatId), createdAt: 1 },
      });
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );
      const up = async (name: string) =>
        (
          await request(app.getHttpServer())
            .post(`/api/conversations/${chatId}/upload?name=${name}`)
            .set(h)
            .set('Content-Type', 'image/png')
            .send(png)
            .expect(200)
        ).body.path;
      const a = await up('a.png');
      const b = await up('b.png');
      await request(app.getHttpServer())
        .post(`/api/conversations/${chatId}/album`)
        .set(h)
        .send({ sources: [a] })
        .expect(400);
      const doc = join(process.env.DATA_DIR!, 'x.txt');
      await request(app.getHttpServer())
        .post(`/api/conversations/${chatId}/album`)
        .set(h)
        .send({ sources: [a, doc] })
        .expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
      await request(app.getHttpServer())
        .post(`/api/conversations/${chatId}/album`)
        .set(h)
        .send({ sources: [a, b], caption: 'мы на море' })
        .expect(200);

      const sendAlbum = jest
        .spyOn(telegram, 'sendAlbum')
        .mockResolvedValue([501, 502]);
      await relay.deliverManualReplies();
      const albumCalls = sendAlbum.mock.calls;
      sendAlbum.mockRestore();
      expect(albumCalls).toEqual([
        [chatId, [a, b], expect.objectContaining({ caption: 'мы на море' })],
      ]);
      const rows = await prisma.message.findMany({
        where: { chatId: BigInt(chatId) },
        orderBy: { id: 'asc' },
      });
      expect(
        rows.map((r) => [r.text, r.tgMsgId, r.mediaKind, r.filePath]),
      ).toEqual([
        ['мы на море', 501, 'photo', a],
        ['[фото]', 502, 'photo', b],
      ]);
      await app.get(TelegramService)['history'].wipeChat(chatId);
    });

    it('архив: бот выключается; вернули — снова ведёт; клиент написал сам — чат остаётся в архиве', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const brain = app.get(REPLY_BRAIN_TOKEN) as any;
      const chatId = 777000341;
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110196', persona_id: 'nastya' })
        .expect(200);
      await prisma.contact.create({
        data: { chatId: BigInt(chatId), accountId: acc.body.id, createdAt: 1 },
      });
      await prisma.message.create({
        data: {
          chatId: BigInt(chatId),
          ts: 1,
          role: 'user',
          text: 'привет',
          author: 'client',
          sourceMessageId: 1,
        },
      });
      const status = async () =>
        (
          await request(app.getHttpServer())
            .get(`/api/conversations/${chatId}`)
            .set(h)
            .expect(200)
        ).body;

      await request(app.getHttpServer())
        .post(`/api/conversations/${chatId}/hide`)
        .set(h)
        .expect((r) => expect(r.status).toBeLessThan(300));
      let d = await status();
      expect(d.archived).toBe(true);
      expect(d.is_paused).toBe(true);
      expect(
        (await prisma.contact.findUnique({
          where: { chatId: BigInt(chatId) },
        }))!.pauseReason,
      ).toBe('archived');
      const list = await request(app.getHttpServer())
        .get('/api/manager/conversations')
        .set(h)
        .expect(200);
      expect(list.body.items.find((r) => r.chat_id === chatId)).toBeUndefined();
      const archive = await request(app.getHttpServer())
        .get('/api/manager/conversations?hidden=1')
        .set(h)
        .expect(200);
      expect(archive.body.items.find((r) => r.chat_id === chatId)).toBeTruthy();

      await request(app.getHttpServer())
        .post(`/api/conversations/${chatId}/unhide`)
        .set(h)
        .expect((r) => expect(r.status).toBeLessThan(300));
      d = await status();
      expect(d.archived).toBe(false);
      expect(d.is_paused).toBe(false);

      // Снова в архив, и клиент пишет сам: сообщение сохраняется, но чат
      // остаётся в архиве и бот молчит — менеджер убрал его сознательно.
      await request(app.getHttpServer())
        .post(`/api/conversations/${chatId}/hide`)
        .set(h)
        .expect((r) => expect(r.status).toBeLessThan(300));
      await brain.handleInbound({
        chatId,
        accountId: acc.body.id,
        messageId: 2,
        ts: Math.floor(Date.now() / 1000),
        text: 'я вернулся',
        media: null,
      });
      d = await status();
      expect(d.archived).toBe(true);
      expect(d.is_paused).toBe(true);
      expect(
        d.messages.some((m: { content: string }) => m.content === 'я вернулся'),
      ).toBe(true);
      const dashboard = await request(app.getHttpServer())
        .get('/api/manager/conversations')
        .set(h)
        .expect(200);
      expect(
        dashboard.body.items.find((x) => x.chat_id === chatId),
      ).toBeUndefined();
      const queue = await request(app.getHttpServer())
        .get('/api/manager/queue')
        .set(h)
        .expect(200);
      expect(
        queue.body.items.find((x) => x.chat_id === chatId),
      ).toBeUndefined();

      await app.get(TelegramService)['history'].wipeChat(chatId);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('после её «спокойной ночи» его «и тебе)» — реакция, а не новое прощание; модель не зовётся', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const persona = app.get(PersonaService);
      const telegram = app.get(TelegramService);
      const brain = app.get(REPLY_BRAIN_TOKEN) as any;
      const chatId = 777000342;
      const id = BigInt(chatId);
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110195', persona_id: 'nastya' })
        .expect(200);
      await prisma.contact.create({
        data: { chatId: id, accountId: acc.body.id, createdAt: 1 },
      });
      const now = Math.floor(Date.now() / 1000);
      await prisma.brainState.create({
        data: {
          chatId: id,
          updatedAt: now,
          stateJson: JSON.stringify({
            history: [
              { role: 'user', content: 'пора спать', created_at: now - 900 },
              {
                role: 'assistant',
                content: 'спокойной ночи, Саш🤗',
                created_at: now - 600,
              },
            ],
          }),
        },
      });
      await prisma.message.create({
        data: {
          chatId: id,
          ts: now - 30,
          role: 'user',
          text: 'и тебе)',
          author: 'client',
          sourceMessageId: 9,
          tgMsgId: 9,
        },
      });
      const turn = {
        turn: {
          chatId,
          accountId: acc.body.id,
          messageId: 9,
          ts: now - 30,
          text: 'и тебе)',
        },
        text: 'и тебе)',
        modality: 'text',
      };
      await prisma.replySchedule.create({
        data: {
          chatId: id,
          accountId: acc.body.id,
          dueAt: now - 1,
          baseDueAt: now - 1,
          openedAt: now - 1,
          reason: 'normal',
          turns: JSON.stringify([turn]),
          createdAt: now - 30,
        },
      });

      const online = jest.spyOn(telegram, 'isOnline').mockReturnValue(true);
      const ready = jest.spyOn(persona, 'ready', 'get').mockReturnValue(true);
      const create = jest.spyOn(persona.anthropic.messages, 'create');
      const react = jest
        .spyOn(telegram, 'sendReaction')
        .mockResolvedValue(undefined);
      await brain.runDueReplies();
      const reactCalls = react.mock.calls.map((c) => c[2]);
      const modelCalls = create.mock.calls.length;
      [online, ready, create, react].forEach((m) => m.mockRestore());
      expect(modelCalls).toBe(0);
      expect(reactCalls).toEqual(['🥰']);

      await app.get(TelegramService)['history'].wipeChat(chatId);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('новые от клиента в списке: считаются после нашего ответа и после открытия переписки', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const chatId = 777000343;
      const id = BigInt(chatId);
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110194', persona_id: 'nastya' })
        .expect(200);
      const now = Math.floor(Date.now() / 1000);
      await prisma.contact.create({
        data: {
          chatId: id,
          accountId: acc.body.id,
          createdAt: 1,
          pauseState: 'paused',
          pauseReason: 'human_takeover',
          pausedTs: now - 900,
        },
      });
      await prisma.message.createMany({
        data: [
          {
            chatId: id,
            ts: now - 600,
            role: 'user',
            text: 'привет',
            author: 'client',
            sourceMessageId: 1,
          },
          {
            chatId: id,
            ts: now - 500,
            role: 'assistant',
            text: 'привет)',
            author: 'operator:web',
          },
          {
            chatId: id,
            ts: now - 400,
            role: 'user',
            text: 'как дела?',
            author: 'client',
            sourceMessageId: 2,
          },
          {
            chatId: id,
            ts: now - 300,
            role: 'assistant',
            text: '[Реакция: 👍]',
            author: 'llm',
          },
          {
            chatId: id,
            ts: now - 200,
            role: 'user',
            text: 'ау',
            author: 'client',
            sourceMessageId: 3,
          },
        ],
      });
      const row = async () =>
        (
          await request(app.getHttpServer())
            .get('/api/manager/conversations')
            .set(h)
            .expect(200)
        ).body.items.find((r) => r.chat_id === chatId);
      // Реакция — не ответ: оба сообщения после «привет)» новые.
      expect(await row()).toMatchObject({ is_paused: true, unread_count: 2 });

      // Открыли переписку — всё просмотрено.
      await request(app.getHttpServer())
        .get(`/api/conversations/${chatId}`)
        .set(h)
        .expect(200);
      expect((await row()).unread_count).toBe(0);

      // Пришло ещё одно после открытия — снова 1.
      await prisma.message.create({
        data: {
          chatId: id,
          ts: Math.floor(Date.now() / 1000) + 5,
          role: 'user',
          text: 'ты тут?',
          author: 'client',
          sourceMessageId: 4,
        },
      });
      expect((await row()).unread_count).toBe(1);

      await app.get(TelegramService)['history'].wipeChat(chatId);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('менеджер добавляет аккаунт — он сразу его; чужие аккаунты ему не видны и недоступны', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const created = await request(app.getHttpServer())
        .post('/api/managers')
        .set(h)
        .send({
          username: 'vera',
          password: 'vera12345',
          role: 'manager',
          region_code: '0077',
        })
        .expect(200);
      const vera = created.body.items.find((m) => m.username === 'vera');
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'vera', password: 'vera12345' })
        .expect(200);
      const mh = { Authorization: `Bearer ${login.body.tokens.accessToken}` };

      const foreign = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110301', persona_id: 'nastya' })
        .expect(200);
      const mine = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(mh)
        .send({ phone_e164: '+79001110302', persona_id: 'nastya' })
        .expect(200);
      expect(
        await prisma.managerAccount.findUnique({
          where: { tgAccountId: mine.body.id },
        }),
      ).toMatchObject({ userId: vera.user_id });
      expect(
        await prisma.managerAccount.findUnique({
          where: { tgAccountId: foreign.body.id },
        }),
      ).toBeNull();

      const list = await request(app.getHttpServer())
        .get('/api/tg-accounts')
        .set(mh)
        .expect(200);
      expect(list.body.map((a) => a.id)).toEqual([mine.body.id]);
      const all = await request(app.getHttpServer())
        .get('/api/tg-accounts')
        .set(h)
        .expect(200);
      expect(all.body.map((a) => a.id)).toEqual(
        expect.arrayContaining([mine.body.id, foreign.body.id]),
      );

      // Свой — можно; чужой — «не найден».
      await request(app.getHttpServer())
        .put(`/api/tg-accounts/${mine.body.id}`)
        .set(mh)
        .send({ daily_msg_quota: 5 })
        .expect(200);
      await request(app.getHttpServer())
        .put(`/api/tg-accounts/${foreign.body.id}`)
        .set(mh)
        .send({ daily_msg_quota: 5 })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${foreign.body.id}`)
        .set(mh)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/tg-accounts/${foreign.body.id}/auth`)
        .set(mh)
        .expect(404);
      // Сводка для шапки — только админу.
      await request(app.getHttpServer()).get('/api/state').set(mh).expect(403);

      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${mine.body.id}`)
        .set(mh)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${foreign.body.id}`)
        .set(h)
        .expect(200);
    });

    it('правка своего сообщения: в Telegram, в ленте с «изменено» и в памяти бота; чужое и вложения — нельзя', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const telegram = app.get(TelegramService);
      const chatId = 777000344;
      const id = BigInt(chatId);
      await prisma.contact.create({ data: { chatId: id, createdAt: 1 } });
      const now = Math.floor(Date.now() / 1000);
      const ours = await prisma.message.create({
        data: {
          chatId: id,
          ts: now - 60,
          role: 'assistant',
          text: 'я в Мардиде',
          author: 'llm',
          tgMsgId: 50,
        },
      });
      const theirs = await prisma.message.create({
        data: {
          chatId: id,
          ts: now - 30,
          role: 'user',
          text: 'где?',
          author: 'client',
          sourceMessageId: 51,
          tgMsgId: 51,
        },
      });
      const photo = await prisma.message.create({
        data: {
          chatId: id,
          ts: now - 20,
          role: 'assistant',
          text: '[фото]',
          author: 'operator:web',
          tgMsgId: 52,
          mediaKind: 'photo',
          filePath: '/x.jpg',
        },
      });
      await prisma.brainState.create({
        data: {
          chatId: id,
          updatedAt: now,
          stateJson: JSON.stringify({
            history: [
              {
                role: 'assistant',
                content: 'я в Мардиде',
                created_at: now - 60,
              },
              { role: 'user', content: 'где?', created_at: now - 30 },
            ],
          }),
        },
      });

      const edit = jest
        .spyOn(telegram, 'editText')
        .mockResolvedValue(undefined);
      const r = await request(app.getHttpServer())
        .put(`/api/conversations/${chatId}/messages/${ours.id}`)
        .set(h)
        .send({ text: 'я в Мадриде' })
        .expect(200);
      const calls = edit.mock.calls;
      edit.mockRestore();
      expect(calls).toEqual([[chatId, 50, 'я в Мадриде']]);
      expect(r.body).toMatchObject({
        id: ours.id,
        text: 'я в Мадриде',
        edited_at: expect.any(Number),
      });
      const detail = await request(app.getHttpServer())
        .get(`/api/conversations/${chatId}`)
        .set(h)
        .expect(200);
      expect(detail.body.messages.find((m) => m.id === ours.id)).toMatchObject({
        content: 'я в Мадриде',
        edited_at: expect.any(Number),
      });
      const state = JSON.parse(
        (await prisma.brainState.findUnique({ where: { chatId: id } }))!
          .stateJson,
      );
      expect(state.history[0].content).toBe('я в Мадриде');

      await request(app.getHttpServer())
        .put(`/api/conversations/${chatId}/messages/${theirs.id}`)
        .set(h)
        .send({ text: 'x' })
        .expect(422);
      await request(app.getHttpServer())
        .put(`/api/conversations/${chatId}/messages/${photo.id}`)
        .set(h)
        .send({ text: 'x' })
        .expect(422);

      // Собеседник исправил своё сообщение в Telegram — лента и память бота видят новый текст.
      const brain = app.get(REPLY_BRAIN_TOKEN) as any;
      const changed = await app
        .get(TelegramService)
        ['history'].editMessageText(chatId, { tgMsgId: 51 }, 'где ты?', now);
      await brain.noteEdited(chatId, 'user', changed.old, 'где ты?');
      const state2 = JSON.parse(
        (await prisma.brainState.findUnique({ where: { chatId: id } }))!
          .stateJson,
      );
      expect(state2.history[1].content).toBe('где ты?');

      await app.get(TelegramService)['history'].wipeChat(chatId);
    });

    it('«почистил диалог»: разом удалил почти всё — метка в чате и списке; написал снова — метка снята', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const brain = app.get(REPLY_BRAIN_TOKEN) as any;
      const chatId = 777000345;
      const id = BigInt(chatId);
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110303', persona_id: 'nastya' })
        .expect(200);
      await prisma.contact.create({
        data: { chatId: id, accountId: acc.body.id, createdAt: 1 },
      });
      await prisma.message.createMany({
        data: Array.from({ length: 8 }, (_, i) => ({
          chatId: id,
          ts: 100 + i,
          role: i % 2 ? 'assistant' : 'user',
          text: `m${i}`,
          author: i % 2 ? 'llm' : 'client',
          tgMsgId: 700 + i,
          sourceMessageId: i % 2 ? null : 700 + i,
        })),
      });
      // Одно удаление — это не «почистил».
      await brain.handleDeleted(acc.body.id, [700]);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/conversations/${chatId}`)
            .set(h)
            .expect(200)
        ).body.cleared_by_client_at,
      ).toBeNull();
      // Всё остальное разом — почистил.
      await brain.handleDeleted(
        acc.body.id,
        [701, 702, 703, 704, 705, 706, 707],
      );
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/conversations/${chatId}`)
            .set(h)
            .expect(200)
        ).body.cleared_by_client_at,
      ).toEqual(expect.any(Number));
      const row = (
        await request(app.getHttpServer())
          .get('/api/manager/conversations')
          .set(h)
          .expect(200)
      ).body.items.find((r) => r.chat_id === chatId);
      expect(row.cleared_by_client_at).toEqual(expect.any(Number));
      // Написал снова — метка снята.
      await app.get(TelegramService)['history'].clearClearedByClient(chatId);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/conversations/${chatId}`)
            .set(h)
            .expect(200)
        ).body.cleared_by_client_at,
      ).toBeNull();

      await app.get(TelegramService)['history'].wipeChat(chatId);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('кружок из панели: уходит видеосообщением, в ленте — «[кружок]» со своим файлом', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const telegram = app.get(TelegramService);
      const relay = app.get(RelayWorker) as any;
      const chatId = 777000346;
      await prisma.contact.create({
        data: { chatId: BigInt(chatId), createdAt: 1 },
      });
      const path = (
        await request(app.getHttpServer())
          .post(`/api/conversations/${chatId}/upload?name=clip.mp4`)
          .set(h)
          .set('Content-Type', 'video/mp4')
          .send(Buffer.from('fake mp4'))
          .expect(200)
      ).body.path;
      const queued = await request(app.getHttpServer())
        .post(`/api/conversations/${chatId}/attachment`)
        .set(h)
        .send({ kind: 'video_note', source: path })
        .expect(200);
      expect(queued.body).toMatchObject({ kind: 'video_note' });

      const send = jest.spyOn(telegram, 'sendMedia').mockResolvedValue(901);
      await relay.deliverManualReplies();
      const calls = send.mock.calls;
      send.mockRestore();
      expect(calls).toEqual([
        [chatId, expect.objectContaining({ kind: 'video_note', source: path })],
      ]);
      const rows = await prisma.message.findMany({
        where: { chatId: BigInt(chatId) },
      });
      expect(rows).toEqual([
        expect.objectContaining({
          text: '[кружок]',
          mediaKind: 'video_note',
          filePath: path,
          tgMsgId: 901,
        }),
      ]);

      await app.get(TelegramService)['history'].wipeChat(chatId);
    });

    it('модель не ответила (обрыв сети) — ответ возвращается в очередь с повтором, а не пропадает', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const persona = app.get(PersonaService);
      const brain = app.get(REPLY_BRAIN_TOKEN) as any;
      const chatId = 777000335;
      const id = BigInt(chatId);
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110061', persona_id: 'nastya' })
        .expect(200);
      await prisma.contact.create({
        data: { chatId: id, accountId: acc.body.id, createdAt: 1 },
      });
      const now = Math.floor(Date.now() / 1000);
      await prisma.message.create({
        data: {
          chatId: id,
          ts: now - 30,
          role: 'user',
          text: 'Молодец',
          author: 'client',
          sourceMessageId: 7,
          tgMsgId: 7,
        },
      });
      const turn = {
        turn: {
          chatId,
          accountId: acc.body.id,
          messageId: 7,
          ts: now - 30,
          text: 'Молодец',
        },
        text: 'Молодец',
        modality: 'text',
      };
      await prisma.replySchedule.create({
        data: {
          chatId: id,
          accountId: acc.body.id,
          dueAt: now - 1,
          baseDueAt: now - 1,
          openedAt: now - 1,
          reason: 'warmup',
          turns: JSON.stringify([turn]),
          createdAt: now - 30,
        },
      });

      const telegram = app.get(TelegramService);
      const ready = jest.spyOn(persona, 'ready', 'get').mockReturnValue(true);

      // Аккаунт не в сети: модель не зовётся (деньги не тратятся), ответ ждёт в очереди.
      const offline = jest.spyOn(persona.anthropic.messages, 'create');
      await brain.runDueReplies();
      expect(offline).not.toHaveBeenCalled();
      offline.mockRestore();
      const waiting = await prisma.replySchedule.findUnique({
        where: { chatId: id },
      });
      expect(waiting).toMatchObject({ reason: 'offline' });
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/conversations/${chatId}`)
            .set(h)
            .expect(200)
        ).body.next_bot_action,
      ).toEqual({ kind: 'account_offline' });

      // Подключился — срок наступил, модель не ответила: ответ возвращается в очередь с повтором.
      await prisma.replySchedule.update({
        where: { chatId: id },
        data: { dueAt: now - 1 },
      });
      const online = jest.spyOn(telegram, 'isOnline').mockReturnValue(true);
      const create = jest
        .spyOn(persona.anthropic.messages, 'create')
        .mockRejectedValue(
          Object.assign(new TypeError('fetch failed'), {
            cause: { code: 'ECONNRESET' },
          }),
        );
      await brain.runDueReplies();
      create.mockRestore();

      const back = await prisma.replySchedule.findUnique({
        where: { chatId: id },
      });
      expect(back).toMatchObject({ reason: 'retry' });
      expect(back!.dueAt).toBeGreaterThanOrEqual(now + 55);
      expect(
        JSON.parse(back!.turns as unknown as string).map((t: any) => t.text),
      ).toEqual(['Молодец']);
      // Ничего не отправлено и в историю не записано.
      expect(
        await prisma.message.count({
          where: { chatId: id, role: 'assistant' },
        }),
      ).toBe(0);
      const detail = await request(app.getHttpServer())
        .get(`/api/conversations/${chatId}`)
        .set(h)
        .expect(200);
      expect(detail.body.next_bot_action).toMatchObject({
        kind: 'reply',
        reason: 'retry',
      });
      online.mockRestore();
      ready.mockRestore();

      await app.get(TelegramService)['history'].wipeChat(chatId);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('был в сети, «заблокировал нас» и бан аккаунта — в чате, в списке и во вкладке аккаунтов', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const telegram = app.get(TelegramService) as any;
      const chatId = 777000336;
      const id = BigInt(chatId);
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110071', persona_id: 'nastya' })
        .expect(200);
      await prisma.tgAccount.update({
        where: { id: acc.body.id },
        data: { status: 'active' },
      });
      await prisma.contact.create({
        data: { chatId: id, accountId: acc.body.id, createdAt: 1 },
      });
      await prisma.message.create({
        data: {
          chatId: id,
          ts: Math.floor(Date.now() / 1000) - 60,
          role: 'user',
          text: 'привет',
          author: 'client',
          sourceMessageId: 3,
          tgMsgId: 3,
        },
      });
      const detail = async () =>
        (
          await request(app.getHttpServer())
            .get(`/api/conversations/${chatId}`)
            .set(h)
            .expect(200)
        ).body;
      const row = async () =>
        (
          await request(app.getHttpServer())
            .get('/api/manager/conversations')
            .set(h)
            .expect(200)
        ).body.items.find((x) => x.chat_id === chatId);

      // Статус из Telegram: «в сети» истёк — значит, был в сети тогда.
      const wasOnline = Math.floor(Date.now() / 1000) - 600;
      await telegram.onUserStatus({
        userId: chatId,
        status: { className: 'UserStatusOnline', expires: wasOnline },
      });
      expect((await detail()).client_presence).toEqual({
        kind: 'offline',
        at: wasOnline,
      });
      expect((await row()).client_presence).toEqual({
        kind: 'offline',
        at: wasOnline,
      });

      // Отправка упала с USER_IS_BLOCKED — чат помечен, ошибка словами, бот сюда не пишет.
      const err = await telegram
        .deliver(chatId, () =>
          Promise.reject(
            Object.assign(new Error('400: USER_IS_BLOCKED'), {
              errorMessage: 'USER_IS_BLOCKED',
            }),
          ),
        )
        .catch((e) => e);
      expect(err.message).toMatch(/заблокировал аккаунт/);
      expect((await detail()).blocked_by_client_at).toEqual(expect.any(Number));
      expect((await row()).blocked_by_client_at).toEqual(expect.any(Number));
      const online = jest.spyOn(telegram, 'isOnline').mockReturnValue(true);
      expect((await detail()).next_bot_action).toEqual({
        kind: 'client_blocked',
      });
      // Дошло — разблокировал.
      await telegram.deliver(chatId, async () => 1);
      expect((await detail()).blocked_by_client_at).toBeNull();

      // Telegram заблокировал наш аккаунт: статус «бан» с причиной, во всех его чатах — словами.
      await telegram.onAccountLost(acc.body.id, {
        kind: 'banned',
        reason: 'Telegram заблокировал аккаунт',
      });
      online.mockRestore();
      const d = await detail();
      expect(d.account_lost).toMatchObject({
        kind: 'banned',
        reason: 'Telegram заблокировал аккаунт',
      });
      expect(d.next_bot_action).toEqual({ kind: 'account_banned' });
      expect((await row()).account_lost).toBe('banned');
      const accounts = await request(app.getHttpServer())
        .get('/api/tg-accounts')
        .set(h)
        .expect(200);
      const mine = (accounts.body.items ?? accounts.body).find(
        (a) => a.id === acc.body.id,
      );
      expect(mine).toMatchObject({
        status: 'banned',
        lost_reason: 'Telegram заблокировал аккаунт',
        lost_at: expect.any(Number),
      });
      // Включили снова (например, после разбана) — отметка снята.
      await prisma.tgAccount.update({
        where: { id: acc.body.id },
        data: { sessionEncrypted: null },
      });
      await request(app.getHttpServer())
        .put(`/api/tg-accounts/${acc.body.id}/status`)
        .set(h)
        .send({ status: 'active' })
        .expect((r) => expect(r.status).toBeLessThan(300));
      expect((await detail()).account_lost).toBeNull();

      await app.get(TelegramService)['history'].wipeChat(chatId);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('галочки Telegram: наше прочитано до max id собеседника, его — до max id аккаунта; значения только растут', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const history = app.get(TelegramService)['history'];
      const chatId = 777000444;
      const id = BigInt(chatId);
      await prisma.contact.create({ data: { chatId: id, createdAt: 1 } });
      await prisma.leadFacts.create({
        data: {
          chatId: id,
          facts: JSON.stringify({
            name: 'Олег',
            phone: '+79001112233',
            tg_username: 'oleg_tg',
          }),
        },
      });
      await prisma.message.createMany({
        data: [
          {
            chatId: id,
            ts: 1,
            role: 'assistant',
            text: 'привет',
            author: 'outreach',
            tgMsgId: 10,
          },
          {
            chatId: id,
            ts: 2,
            role: 'user',
            text: 'привет)',
            author: 'client',
            sourceMessageId: 11,
            tgMsgId: 11,
          },
          {
            chatId: id,
            ts: 3,
            role: 'assistant',
            text: 'как дела?',
            author: 'llm',
            tgMsgId: 12,
          },
          {
            chatId: id,
            ts: 4,
            role: 'user',
            text: 'норм',
            author: 'client',
            sourceMessageId: 13,
            tgMsgId: 13,
          },
          {
            chatId: id,
            ts: 5,
            role: 'assistant',
            text: 'ещё не ушло',
            author: 'operator:1',
          },
        ],
      });
      await history.markTelegramRead(chatId, 'outbox', 10);
      await history.markTelegramRead(chatId, 'inbox', 11);
      await history.markTelegramRead(chatId, 'outbox', 7); // старое значение из догона не откатывает

      const read = async () =>
        (
          await request(app.getHttpServer())
            .get(`/api/conversations/${chatId}`)
            .set(h)
            .expect(200)
        ).body.messages.map((m) => m.tg_read);
      expect(await read()).toEqual([true, true, false, false, null]);
      await history.markTelegramRead(chatId, 'outbox', 12);
      await history.markTelegramRead(
        chatId,
        'inbox',
        await history.latestClientTgId(chatId),
      );
      expect(await read()).toEqual([true, true, true, true, null]);

      // Номер и ник собеседника — в списке диалогов и в карточке.
      const detail = await request(app.getHttpServer())
        .get(`/api/conversations/${chatId}`)
        .set(h)
        .expect(200);
      expect(detail.body).toMatchObject({
        client_phone: '+79001112233',
        client_username: 'oleg_tg',
      });
      const list = await request(app.getHttpServer())
        .get('/api/manager/conversations')
        .set(h)
        .expect(200);
      expect(list.body.items.find((x) => x.chat_id === chatId)).toMatchObject({
        phone: '+79001112233',
        client_username: 'oleg_tg',
      });

      await history.wipeChat(chatId);
    });

    it('случай 15.09: аккаунт завис на запросе @username — лид уходит другому, очередь не встаёт', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const worker = app.get(OutreachWorker);
      const telegram = app.get(TelegramService);
      const now = Math.floor(Date.now() / 1000);

      const stuck = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110041', persona_id: 'nastya' })
        .expect(200);
      const healthy = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110042', persona_id: 'nastya' })
        .expect(200);
      const lead = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ username: '@ira_timeout', first_name: 'Ира' })
        .expect(200);
      await prisma.phoneNumber.updateMany({
        where: { status: 'queued' },
        data: { status: 'pending' },
      });
      await request(app.getHttpServer())
        .post('/api/leads/start')
        .set(h)
        .send({ ids: [lead.body.id] })
        .expect(200);

      // Зависший аккаунт: Telegram не отвечает — сервис бросает таймаут, а не ждёт вечно.
      const resolve = jest
        .spyOn(telegram, 'resolveUsername')
        .mockRejectedValueOnce(
          new TelegramTimeoutError(
            stuck.body.id,
            'getEntity @ira_timeout',
            60000,
          ),
        )
        .mockResolvedValueOnce({
          kind: 'found',
          userId: 777000555,
          username: 'ira_timeout',
          deleted: false,
        });
      const send = jest.spyOn(telegram, 'sendText').mockResolvedValue([1]);

      await (worker as any).processOne(stuck.body.id, now);
      const released = await prisma.phoneNumber.findUnique({
        where: { id: lead.body.id },
      });
      expect(released).toMatchObject({
        status: 'queued',
        assignedAccountId: null,
        nextAttemptAt: null,
      });
      expect(released!.lastError).toMatch(/Telegram не отвечает/);
      const paused = await prisma.tgAccount.findUnique({
        where: { id: stuck.body.id },
      });
      expect(paused!.floodUntil).toBeGreaterThan(now);
      expect(paused!.floodReason).toMatch(/Telegram не отвечает/);

      // Следующий аккаунт берёт того же лида сразу.
      await (worker as any).processOne(healthy.body.id, now + 1);
      resolve.mockRestore();
      send.mockRestore();
      expect(
        await prisma.phoneNumber.findUnique({ where: { id: lead.body.id } }),
      ).toMatchObject({
        status: 'contacted',
        assignedAccountId: healthy.body.id,
      });

      // Тик, зависший дольше 10 минут, не блокирует следующий.
      const hours = appConfig.outreachHours;
      appConfig.outreachHours = [0, 24];
      const configured = jest
        .spyOn(telegram, 'configured', 'get')
        .mockReturnValue(true);
      (worker as any).runningSince = Math.floor(Date.now() / 1000) - 11 * 60;
      const eligible = jest
        .spyOn(worker as any, 'eligibleAccounts')
        .mockResolvedValue([]);
      await worker.tick();
      expect(eligible).toHaveBeenCalled();
      expect((worker as any).runningSince).toBeNull();
      eligible.mockRestore();
      configured.mockRestore();
      appConfig.outreachHours = hours;

      await app.get(TelegramService)['history'].wipeChat(777000555);
      await request(app.getHttpServer())
        .delete(`/api/leads/${lead.body.id}`)
        .set(h)
        .expect(200);
      for (const a of [stuck, healthy])
        await request(app.getHttpServer())
          .delete(`/api/tg-accounts/${a.body.id}`)
          .set(h)
          .expect(200);
    });

    it('ответ частями: каждая часть в истории сразу после отправки, со своим временем и id Telegram — галочки видны', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const brain = app.get(REPLY_BRAIN_TOKEN) as any;
      const telegram = app.get(TelegramService);
      const chatId = 777000666;
      await prisma.contact.create({
        data: { chatId: BigInt(chatId), createdAt: 1 },
      });

      // Транспорт как настоящий: часть «печатается», уходит, и только тогда следующая.
      const storedWhenSent: number[] = [];
      const send = jest.spyOn(telegram, 'sendText').mockImplementation((async (
        chat: number,
        parts: string[],
        opts: any,
      ) => {
        const ids: number[] = [];
        // Фоновые воркеры теста могут отправлять в другие чаты — считаем только свой.
        if (chat !== chatId) return parts.map(() => 1);
        for (const [i] of parts.entries()) {
          storedWhenSent.push(
            await prisma.message.count({ where: { chatId: BigInt(chatId) } }),
          );
          ids.push(500 + i);
          await opts.onPart?.(i, 500 + i);
          await new Promise((r) => setTimeout(r, 1100));
        }
        return ids;
      }) as any);
      await brain.deliverParts(
        chatId,
        [
          'ого, токарь',
          'это же надо руками чувствовать',
          'давно этим занимаешься?',
        ],
        null,
        { enabled: true },
        'llm',
      );
      send.mockRestore();

      // К отправке второй части первая уже в истории — панель показывает ответ по мере набора.
      expect(storedWhenSent).toEqual([0, 1, 2]);
      const rows = await prisma.message.findMany({
        where: { chatId: BigInt(chatId) },
        orderBy: { id: 'asc' },
      });
      expect(rows.map((r) => r.tgMsgId)).toEqual([500, 501, 502]);
      expect(rows[2].ts).toBeGreaterThan(rows[0].ts);

      await app
        .get(TelegramService)
        ['history'].markTelegramRead(chatId, 'outbox', 501);
      const detail = await request(app.getHttpServer())
        .get(`/api/conversations/${chatId}`)
        .set(h)
        .expect(200);
      expect(detail.body.messages.map((m) => m.tg_read)).toEqual([
        true,
        true,
        false,
      ]);

      await app.get(TelegramService)['history'].wipeChat(chatId);
    });

    it('случай 15.09: сообщение из диалога другого аккаунта не попадает к боту и не трогает галочки', async () => {
      const prisma = app.get(PrismaService);
      const telegram = app.get(TelegramService) as any;
      const brain = app.get(REPLY_BRAIN_TOKEN) as any;
      const chatId = 777000777;
      // Чат ведёт аккаунт 14; у аккаунта 1 остался старый диалог с тем же человеком.
      await prisma.contact.create({
        data: { chatId: BigInt(chatId), accountId: null, createdAt: 1 },
      });
      await prisma.$executeRaw`UPDATE contacts SET account_id = 14 WHERE chat_id = ${BigInt(chatId)}`.catch(
        () => undefined,
      );
      const owner = await prisma.contact.findUnique({
        where: { chatId: BigInt(chatId) },
      });
      jest
        .spyOn(telegram.history, 'chatOwnerAccount')
        .mockImplementation(async (id: number) =>
          id === chatId ? 14 : owner!.accountId,
        );

      const inbound = jest
        .spyOn(brain, 'handleInbound')
        .mockResolvedValue(undefined);
      const event = {
        isPrivate: true,
        message: {
          out: false,
          chatId,
          senderId: chatId,
          id: 33092,
          message: 'ахаха, а ты смешная',
          date: 1788967132,
          media: null,
          getSender: async () => null,
        },
      };
      await telegram.onInbound({ id: 1, client: {}, telegramUserId: 1 }, event);
      expect(inbound).not.toHaveBeenCalled();
      // Свой аккаунт — проходит как обычно.
      await telegram.onInbound(
        { id: 14, client: {}, telegramUserId: 14 },
        { ...event, message: { ...event.message, id: 65 } },
      );
      expect(inbound).toHaveBeenCalledTimes(1);
      inbound.mockRestore();

      // Галочки чужого диалога (номера сообщений другого аккаунта) не записываются.
      const { Api } = require('telegram');
      const bigInt = require('big-integer');
      await telegram.onReadHistory(
        { id: 1 },
        new Api.UpdateReadHistoryOutbox({
          peer: new Api.PeerUser({ userId: bigInt(chatId) }),
          maxId: 33097,
          pts: 1,
          ptsCount: 1,
        }),
      );
      expect(
        (await telegram.history.telegramReadMarks(chatId)).outbox,
      ).toBeNull();
      await telegram.onReadHistory(
        { id: 14 },
        new Api.UpdateReadHistoryOutbox({
          peer: new Api.PeerUser({ userId: bigInt(chatId) }),
          maxId: 64,
          pts: 1,
          ptsCount: 1,
        }),
      );
      expect((await telegram.history.telegramReadMarks(chatId)).outbox).toBe(
        64,
      );

      jest.restoreAllMocks();
      await telegram.history.wipeChat(chatId);
    });

    it('лента — по времени сообщений: написанное, пока бот печатал, стоит выше его ответа', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const chatId = 777000888;
      await prisma.contact.create({
        data: { chatId: BigInt(chatId), createdAt: 1 },
      });
      // Порядок записи как в бою 15.09: ответ бота (10:34:43) записан раньше, чем сообщения, отправленные в 10:33.
      for (const [ts, role, text] of [
        [1000, 'user', 'тайные клиенты'],
        [1283, 'assistant', 'вот кстати да'],
        [1233, 'user', 'Это и то, как общается персонал'],
        [1236, 'user', 'И тд'],
        [1291, 'user', 'Все равно есть моменты'],
      ] as const) {
        await prisma.message.create({
          data: {
            chatId: BigInt(chatId),
            ts,
            role,
            text,
            author: role === 'user' ? 'client' : 'llm',
          },
        });
      }
      const detail = await request(app.getHttpServer())
        .get(`/api/conversations/${chatId}`)
        .set(h)
        .expect(200);
      expect(detail.body.messages.map((m) => m.content)).toEqual([
        'тайные клиенты',
        'Это и то, как общается персонал',
        'И тд',
        'вот кстати да',
        'Все равно есть моменты',
      ]);
      await app.get(TelegramService)['history'].wipeChat(chatId);
    });

    it('собеседник печатает и его аватарка — видно в чате и в списке; чужой диалог не считается', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const telegram = app.get(TelegramService) as any;
      const presence = telegram.presence;
      const chatId = 777000999;
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110061', persona_id: 'nastya' })
        .expect(200);
      await prisma.contact.create({
        data: { chatId: BigInt(chatId), accountId: acc.body.id, createdAt: 1 },
      });
      await prisma.message.create({
        data: {
          chatId: BigInt(chatId),
          ts: 1,
          role: 'user',
          text: 'привет',
          author: 'client',
        },
      });
      const { Api } = require('telegram');
      const bigInt = require('big-integer');
      const typing = (action: unknown) =>
        new Api.UpdateUserTyping({ userId: bigInt(chatId), action });

      // Диалог другого аккаунта с тем же человеком — не показываем.
      await telegram.onUserTyping(
        { id: acc.body.id + 1000 },
        typing(new Api.SendMessageTypingAction()),
      );
      expect(presence.activityOf(chatId)).toBeNull();

      await telegram.onUserTyping(
        { id: acc.body.id },
        typing(new Api.SendMessageRecordAudioAction()),
      );
      let detail = await request(app.getHttpServer())
        .get(`/api/conversations/${chatId}`)
        .set(h)
        .expect(200);
      expect(detail.body.client_typing).toBe('voice');
      const list = await request(app.getHttpServer())
        .get('/api/manager/conversations')
        .set(h)
        .expect(200);
      expect(list.body.items.find((x) => x.chat_id === chatId)).toMatchObject({
        typing: 'voice',
      });

      // Отмена — сразу пусто; статус без подтверждения гаснет сам через ~6 с.
      await telegram.onUserTyping(
        { id: acc.body.id },
        typing(new Api.SendMessageCancelAction()),
      );
      expect(presence.activityOf(chatId)).toBeNull();
      presence.setActivity(chatId, 'typing', Date.now() - 7000);
      expect(presence.activityOf(chatId)).toBeNull();

      // Аватарки нет — инициалы (null), есть файл — ссылка и сама картинка по ?token=.
      expect(detail.body.client_avatar).toBeNull();
      mkdirSync(join(process.env.DATA_DIR!, 'media', 'avatars'), {
        recursive: true,
      });
      writeFileSync(
        presence.avatarPath(chatId),
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      );
      detail = await request(app.getHttpServer())
        .get(`/api/conversations/${chatId}`)
        .set(h)
        .expect(200);
      expect(detail.body.client_avatar).toMatch(
        /^\/api\/conversations\/777000999\/avatar\?v=\d+$/,
      );
      const img = await request(app.getHttpServer())
        .get(`${detail.body.client_avatar}&token=${encodeURIComponent(token)}`)
        .expect(200);
      expect(img.headers['content-type']).toMatch(/image\/jpeg/);

      rmSync(presence.avatarPath(chatId), { force: true });
      await request(app.getHttpServer())
        .get(
          `/api/conversations/${chatId}/avatar?token=${encodeURIComponent(token)}`,
        )
        .expect(404);
      await telegram.history.wipeChat(chatId);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('вкладка «Аккаунты»: имя и фото профиля из Telegram', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const presence = (app.get(TelegramService) as any).presence;
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110071', persona_id: 'nastya' })
        .expect(200);
      expect(acc.body).toMatchObject({ display_name: null, avatar_url: null });

      // Так пишет подключение: имя из getMe, фото — файлом.
      await prisma.tgAccount.update({
        where: { id: acc.body.id },
        data: { displayName: 'Настя Иванова', username: 'nastya_iv' },
      });
      mkdirSync(join(process.env.DATA_DIR!, 'media', 'avatars'), {
        recursive: true,
      });
      writeFileSync(
        presence.accountAvatarPath(acc.body.id),
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      );

      const listed = (
        await request(app.getHttpServer())
          .get('/api/tg-accounts')
          .set(h)
          .expect(200)
      ).body.find((a) => a.id === acc.body.id);
      expect(listed).toMatchObject({
        display_name: 'Настя Иванова',
        username: 'nastya_iv',
      });
      expect(listed.avatar_url).toMatch(
        new RegExp(`^/api/tg-accounts/${acc.body.id}/avatar\\?v=\\d+$`),
      );
      const img = await request(app.getHttpServer())
        .get(`${listed.avatar_url}&token=${encodeURIComponent(token)}`)
        .expect(200);
      expect(img.headers['content-type']).toMatch(/image\/jpeg/);

      rmSync(presence.accountAvatarPath(acc.body.id), { force: true });
      await request(app.getHttpServer())
        .get(
          `/api/tg-accounts/${acc.body.id}/avatar?token=${encodeURIComponent(token)}`,
        )
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('профиль аккаунта в Telegram: имя, ник и фото из панели; ошибки Telegram словами', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const telegram = app.get(TelegramService);
      const prisma = app.get(PrismaService);
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110081', persona_id: 'nastya' })
        .expect(200);

      // Ник проверяется до Telegram.
      const bad = await request(app.getHttpServer())
        .put(`/api/tg-accounts/${acc.body.id}/profile`)
        .set(h)
        .send({ username: '1x' })
        .expect(422);
      expect(bad.body.message).toMatch(/5–32/);

      const profile = jest
        .spyOn(telegram, 'updateOwnProfile')
        .mockImplementation((async (id: number, patch: any) => {
          await prisma.tgAccount.update({
            where: { id },
            data: {
              displayName: `${patch.firstName} ${patch.lastName}`.trim(),
              username: patch.username,
            },
          });
          return { displayName: null, username: null };
        }) as any);
      const ok = await request(app.getHttpServer())
        .put(`/api/tg-accounts/${acc.body.id}/profile`)
        .set(h)
        .send({
          first_name: ' Настя ',
          last_name: 'Иванова',
          username: '@nastya_iv',
        })
        .expect(200);
      expect(profile).toHaveBeenCalledWith(acc.body.id, {
        firstName: 'Настя',
        lastName: 'Иванова',
        username: 'nastya_iv',
      });
      expect(ok.body).toMatchObject({
        display_name: 'Настя Иванова',
        username: 'nastya_iv',
      });

      profile.mockRejectedValueOnce(
        Object.assign(new Error('USERNAME_OCCUPIED'), {
          errorMessage: 'USERNAME_OCCUPIED',
        }),
      );
      const taken = await request(app.getHttpServer())
        .put(`/api/tg-accounts/${acc.body.id}/profile`)
        .set(h)
        .send({ username: 'durov' })
        .expect(422);
      expect(taken.body.message).toBe('этот ник уже занят в Telegram');
      profile.mockRestore();

      // Фото: картинка любого формата уходит в Telegram JPEG-ом; не картинка — отказ.
      const photo = jest
        .spyOn(telegram, 'setOwnPhoto')
        .mockResolvedValue({ displayName: null, username: null });
      const sharp = require('sharp');
      const png = await sharp({
        create: { width: 300, height: 300, channels: 3, background: '#3366ff' },
      })
        .png()
        .toBuffer();
      await request(app.getHttpServer())
        .post(`/api/tg-accounts/${acc.body.id}/avatar`)
        .set(h)
        .set('content-type', 'image/png')
        .send(png)
        .expect(200);
      const sent = photo.mock.calls[0][1] as Buffer;
      expect(sent.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      await request(app.getHttpServer())
        .post(`/api/tg-accounts/${acc.body.id}/avatar`)
        .set(h)
        .set('content-type', 'application/octet-stream')
        .send(Buffer.from('не картинка'))
        .expect(422);
      photo.mockRestore();

      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('удаление лида: переписка в Telegram — только по галочке, у всех; ошибка Telegram не мешает удалению', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const telegram = app.get(TelegramService);
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110091', persona_id: 'nastya' })
        .expect(200);
      const del = jest
        .spyOn(telegram, 'deleteDialogForEveryone')
        .mockResolvedValue(undefined);

      const make = async (chatId: number, username: string) => {
        const lead = await request(app.getHttpServer())
          .post('/api/leads')
          .set(h)
          .send({ username })
          .expect(200);
        await prisma.phoneNumber.update({
          where: { id: lead.body.id },
          data: {
            telegramUserId: BigInt(chatId),
            assignedAccountId: acc.body.id,
            status: 'contacted',
          },
        });
        await prisma.contact.create({
          data: {
            chatId: BigInt(chatId),
            accountId: acc.body.id,
            createdAt: 1,
          },
        });
        await prisma.message.create({
          data: {
            chatId: BigInt(chatId),
            ts: 1,
            role: 'assistant',
            text: 'Привет',
            author: 'outreach',
          },
        });
        return lead.body.id;
      };

      // Без галочки — Telegram не трогаем, панель стирается как раньше.
      const plain = await make(777001001, '@del_plain');
      const r1 = await request(app.getHttpServer())
        .delete(`/api/leads/${plain}`)
        .set(h)
        .expect(200);
      expect(r1.body).toMatchObject({ wiped_chat: 777001001, telegram: null });
      expect(del).not.toHaveBeenCalled();

      // С галочкой — удаляем у всех в аккаунте, который ведёт чат.
      const withTg = await make(777001002, '@del_tg');
      const r2 = await request(app.getHttpServer())
        .delete(`/api/leads/${withTg}?telegram=1`)
        .set(h)
        .expect(200);
      expect(del).toHaveBeenCalledWith(acc.body.id, 777001002, {
        username: 'del_tg',
      });
      expect(r2.body.telegram).toEqual({
        deleted_in: [acc.body.id],
        failed: [],
      });

      // Telegram отказал — лид всё равно удалён, а причина видна.
      const failing = await make(777001003, '@del_fail');
      del.mockRejectedValueOnce(new Error('аккаунт #1 не в сети'));
      const r3 = await request(app.getHttpServer())
        .delete(`/api/leads/${failing}?telegram=1`)
        .set(h)
        .expect(200);
      expect(r3.body.telegram.failed).toEqual([
        { account_id: acc.body.id, error: 'аккаунт #1 не в сети' },
      ]);
      expect(await prisma.phoneNumber.count({ where: { id: failing } })).toBe(
        0,
      );
      expect(
        await prisma.message.count({ where: { chatId: BigInt(777001003) } }),
      ).toBe(0);

      del.mockRestore();
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('лиды, застрявшие на флуде до исправления, при старте уходят другим', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      const now = Math.floor(Date.now() / 1000);
      const acc = await request(app.getHttpServer())
        .post('/api/tg-accounts')
        .set(h)
        .send({ phone_e164: '+79001110003', persona_id: 'nastya' })
        .expect(200);
      const lead = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ phone: '+7 900 555-66-88' })
        .expect(200);
      // Так лид выглядел на проде: привязан к аккаунту и ждёт 6 часов.
      await prisma.phoneNumber.update({
        where: { id: lead.body.id },
        data: {
          status: 'queued',
          assignedAccountId: acc.body.id,
          nextAttemptAt: now + 21600,
          lastError: 'flood: ждём 21600s',
        },
      });
      await app.get(OutreachWorker).onModuleInit();
      const row = (
        await request(app.getHttpServer()).get('/api/leads').set(h).expect(200)
      ).body.items.find((l) => l.id === lead.body.id);
      expect(row).toMatchObject({
        status: 'queued',
        assigned_account_id: null,
        next_attempt_at: null,
      });
      const limited = (
        await request(app.getHttpServer())
          .get('/api/tg-accounts')
          .set(h)
          .expect(200)
      ).body.find((a) => a.id === acc.body.id);
      expect(limited.flood_until).toBe(now + 21600);
      // Повторный старт ничего не ломает.
      await app.get(OutreachWorker).onModuleInit();
      await request(app.getHttpServer())
        .delete(`/api/leads/${lead.body.id}`)
        .set(h)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/tg-accounts/${acc.body.id}`)
        .set(h)
        .expect(200);
    });

    it('username leads: create, dedupe against t.me link, import mixed', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const r = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ username: '@Test_User_1', first_name: 'Тест' })
        .expect(200);
      expect(r.body).toMatchObject({
        phone_e164: null,
        username: 'test_user_1',
        status: 'pending',
      });
      await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({ phone: 'https://t.me/test_user_1' })
        .expect(422);
      const imp = await request(app.getHttpServer())
        .post('/api/leads/import')
        .set(h)
        .send({ text: '@test_user_1\n@Another_One;Аня\n+79005550099' })
        .expect(200);
      expect(imp.body).toMatchObject({ created: 2, duplicates: 1, errors: [] });
      const list = await request(app.getHttpServer())
        .get('/api/leads?q=@ANOTHER')
        .set(h)
        .expect(200);
      expect(list.body.items.map((l) => l.username)).toEqual(['another_one']);
      for (const l of (
        await request(app.getHttpServer()).get('/api/leads').set(h)
      ).body.items) {
        await request(app.getHttpServer())
          .delete(`/api/leads/${l.id}`)
          .set(h)
          .expect(200);
      }
    });

    it('voice role has no access to leads', async () => {
      const h = { Authorization: `Bearer ${token}` };
      await request(app.getHttpServer())
        .post('/api/managers')
        .set(h)
        .send({ username: 'vova', password: 'vova12345', role: 'voice' })
        .expect(200);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'vova', password: 'vova12345' })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/leads')
        .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
        .expect(403);
    });
  });

  describe('personas', () => {
    let personaId: number;

    it('the folder under PERSONAS_DIR is imported on the first start', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const r = await request(app.getHttpServer())
        .get('/api/personas')
        .set(h)
        .expect(200);
      expect(r.body.total).toBeGreaterThan(0);
      const nastya = r.body.items.find((p) => p.slug === 'nastya');
      expect(nastya).toMatchObject({
        name: 'Настя',
        is_default: true,
        enabled: true,
      });
      expect(nastya.card_lines).toBeGreaterThan(0);
      personaId = nastya.id;
    });

    it('the whole persona comes back with its sections and effective prompts', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const r = await request(app.getHttpServer())
        .get(`/api/personas/${personaId}`)
        .set(h)
        .expect(200);
      expect(Object.keys(r.body.sections).sort()).toEqual(
        [...PERSONA_SECTIONS].sort(),
      );
      // Ритм лежит у личности целиком: в редакторе видны настоящие цифры.
      expect(r.body.sections.rhythm.reply_delay).toMatchObject({
        warmup_minutes: 90,
        min_minutes: 3,
        max_minutes: 20,
      });
      expect(r.body.sections.persona.name).toBe('Настя');
      // Тексты промптов лежат у личности целиком: редактор правит их, а не «переопределяет».
      expect(Object.keys(r.body.sections.prompts).sort()).toEqual(
        [...PROMPT_KEYS].sort(),
      );
      expect(r.body.sections.prompts.opener).toBe(
        'Привет, это {name} с {site}',
      );
      expect(r.body.edited_prompts).toBe(0);
      expect(r.body.effective_prompts.opener).toBe(
        'Привет, это {name} с {site}',
      );
      expect(r.body.effective_prompts.judge_plan.length).toBeGreaterThan(100);
    });

    it('defaults endpoint gives the texts and their labels', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const r = await request(app.getHttpServer())
        .get('/api/personas/prompts/defaults')
        .set(h)
        .expect(200);
      expect(r.body.keys).toContain('author_rules');
      expect(r.body.labels.author_rules.title).toBeTruthy();
      expect(r.body.defaults.author_rules.length).toBeGreaterThan(100);
    });

    it('a section is replaced whole, the previous one goes to history, restore brings it back', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const saved = await request(app.getHttpServer())
        .put(`/api/personas/${personaId}/sections/prompts`)
        .set(h)
        .send({
          data: { opener: 'Привет, это Настя с mamba' },
          note: 'смена сайта',
        })
        .expect(200);
      expect(saved.body).toMatchObject({ saved: true, section: 'prompts' });

      const after = await request(app.getHttpServer())
        .get(`/api/personas/${personaId}`)
        .set(h)
        .expect(200);
      expect(after.body.effective_prompts.opener).toBe(
        'Привет, это Настя с mamba',
      );
      // Остальные тексты по-прежнему из умолчаний.
      expect(after.body.effective_prompts.author_rules.length).toBeGreaterThan(
        100,
      );
      expect(after.body.edited_prompts).toBe(1);

      // Тот же документ второй раз — не версия.
      const again = await request(app.getHttpServer())
        .put(`/api/personas/${personaId}/sections/prompts`)
        .set(h)
        .send({ data: { opener: 'Привет, это Настя с mamba' } })
        .expect(200);
      expect(again.body).toMatchObject({ saved: false, unchanged: true });

      const versions = await request(app.getHttpServer())
        .get(`/api/personas/${personaId}/sections/prompts/versions`)
        .set(h)
        .expect(200);
      expect(versions.body.items).toHaveLength(1);
      expect(versions.body.items[0]).toMatchObject({
        note: 'смена сайта',
        saved_by: 'admin',
      });

      await request(app.getHttpServer())
        .post(
          `/api/personas/${personaId}/sections/prompts/versions/${versions.body.items[0].id}/restore`,
        )
        .set(h)
        .expect(200);
      const back = await request(app.getHttpServer())
        .get(`/api/personas/${personaId}`)
        .set(h)
        .expect(200);
      expect(back.body.effective_prompts.opener).toBe(
        'Привет, это {name} с {site}',
      );
    });

    it('rhythm defaults are the operator numbers', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const r = await request(app.getHttpServer())
        .get('/api/personas/rhythm/defaults')
        .set(h)
        .expect(200);
      expect(r.body.defaults).toEqual(DEFAULT_RHYTHM);
    });

    it('rhythm is validated in words, a good one is saved', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const bad = await request(app.getHttpServer())
        .put(`/api/personas/${personaId}/sections/rhythm`)
        .set(h)
        .send({
          data: {
            timezone: 'Mars/Olympus',
            reply_delay: { min_minutes: 30, max_minutes: 5 },
          },
        })
        .expect(422);
      expect(JSON.stringify(bad.body)).toMatch(/часовой пояс/);
      expect(JSON.stringify(bad.body)).toMatch(/«от» больше «до»/);
      const good = await request(app.getHttpServer())
        .put(`/api/personas/${personaId}/sections/rhythm`)
        .set(h)
        .send({
          data: {
            ...DEFAULT_RHYTHM,
            morning: { enabled: true, from: '08:00', to: '10:00' },
          },
          note: 'утро позже',
        })
        .expect(200);
      expect(good.body.saved).toBe(true);
      const back = await request(app.getHttpServer())
        .get(`/api/personas/${personaId}`)
        .set(h)
        .expect(200);
      expect(back.body.sections.rhythm.morning.from).toBe('08:00');
    });

    it('refuses a wrong shape and an unknown prompt key', async () => {
      const h = { Authorization: `Bearer ${token}` };
      await request(app.getHttpServer())
        .put(`/api/personas/${personaId}/sections/prompts`)
        .set(h)
        .send({ data: { nope: 'x' } })
        .expect(422);
      await request(app.getHttpServer())
        .put(`/api/personas/${personaId}/sections/prompts`)
        .set(h)
        .send({ data: { opener: 5 } })
        .expect(422);
      await request(app.getHttpServer())
        .put(`/api/personas/${personaId}/sections/beats`)
        .set(h)
        .send({ data: { a: 1 } })
        .expect(422);
      await request(app.getHttpServer())
        .put(`/api/personas/${personaId}/sections/nope`)
        .set(h)
        .send({ data: {} })
        .expect(400);
    });

    it('create as a copy, switch default, delete', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const created = await request(app.getHttpServer())
        .post('/api/personas')
        .set(h)
        .send({ name: 'Лена', copy_from: personaId })
        .expect(200);
      expect(created.body).toMatchObject({
        slug: 'lena',
        name: 'Лена',
        is_default: false,
      });
      expect(created.body.sections.persona.name).toBe('Настя'); // копия документов, имя правится отдельно

      // Основную удалить нельзя, а после смены — можно.
      await request(app.getHttpServer())
        .delete(`/api/personas/${personaId}`)
        .set(h)
        .expect(422);
      await request(app.getHttpServer())
        .post(`/api/personas/${created.body.id}/default`)
        .set(h)
        .expect(200);
      const list = await request(app.getHttpServer())
        .get('/api/personas')
        .set(h)
        .expect(200);
      expect(
        list.body.items.find((p) => p.id === created.body.id).is_default,
      ).toBe(true);

      await request(app.getHttpServer())
        .post(`/api/personas/${personaId}/default`)
        .set(h)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/personas/${created.body.id}`)
        .set(h)
        .expect(200);
    });

    it('duplicate copies every document under a free slug and keeps the accounts with the original', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const copy = await request(app.getHttpServer())
        .post(`/api/personas/${personaId}/duplicate`)
        .set(h)
        .expect(200);
      expect(copy.body).toMatchObject({
        slug: 'nastya-copy',
        name: 'Настя (копия)',
        is_default: false,
        accounts: 0,
      });
      expect(copy.body.sections.persona.name).toBe('Настя');
      expect(copy.body.sections.prompts.opener).toBe(
        'Привет, это {name} с {site}',
      );

      // Второй раз — свободный slug, а не 409.
      const again = await request(app.getHttpServer())
        .post(`/api/personas/${personaId}/duplicate`)
        .set(h)
        .expect(200);
      expect(again.body.slug).toBe('nastya-copy-2');

      await request(app.getHttpServer())
        .delete(`/api/personas/${copy.body.id}`)
        .set(h)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/personas/${again.body.id}`)
        .set(h)
        .expect(200);
    });

    it('export gives every section, import writes them back through history', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const dump = await request(app.getHttpServer())
        .get(`/api/personas/${personaId}/export`)
        .set(h)
        .expect(200);
      expect(dump.body).toMatchObject({
        kind: 'nastya.persona',
        version: 1,
        persona: { slug: 'nastya' },
      });
      expect(Object.keys(dump.body.sections).sort()).toEqual(
        [...PERSONA_SECTIONS].sort(),
      );
      expect(dump.body.sections.persona.name).toBe('Настя');

      // Файл в другую личность: она получает документы оригинала целиком.
      const empty = await request(app.getHttpServer())
        .post('/api/personas')
        .set(h)
        .send({ name: 'Вера' })
        .expect(200);
      const imported = await request(app.getHttpServer())
        .post(`/api/personas/${empty.body.id}/import`)
        .set(h)
        .send({
          sections: dump.body.sections,
          note: 'файл persona-nastya.json',
        })
        .expect(200);
      // Промпты у новой личности уже как в коде — значит этой секции файл не менял.
      expect(imported.body.applied).toEqual(
        expect.arrayContaining(['persona', 'goals', 'storylines']),
      );
      expect(imported.body.persona.sections.persona.name).toBe('Настя');
      expect(imported.body.persona.card_lines).toBeGreaterThan(0);
      // Имя и идентификатор — свои: файл переносит документы, а не личность целиком.
      expect(imported.body.persona.name).toBe('Вера');

      // Прежний документ каждой изменённой секции лежит в истории и возвращается.
      const versions = await request(app.getHttpServer())
        .get(`/api/personas/${empty.body.id}/sections/persona/versions`)
        .set(h)
        .expect(200);
      expect(versions.body.items[0]).toMatchObject({
        note: 'файл persona-nastya.json',
        saved_by: 'admin',
      });
      await request(app.getHttpServer())
        .post(
          `/api/personas/${empty.body.id}/sections/persona/versions/${versions.body.items[0].id}/restore`,
        )
        .set(h)
        .expect(200);
      const back = await request(app.getHttpServer())
        .get(`/api/personas/${empty.body.id}`)
        .set(h)
        .expect(200);
      expect(back.body.sections.persona).toEqual({});

      // Тот же файл второй раз — ничего не пишем и версий не плодим.
      const again = await request(app.getHttpServer())
        .post(`/api/personas/${empty.body.id}/import`)
        .set(h)
        .send({ sections: { goals: dump.body.sections.goals } })
        .expect(200);
      expect(again.body).toMatchObject({ applied: [], unchanged: ['goals'] });

      await request(app.getHttpServer())
        .delete(`/api/personas/${empty.body.id}`)
        .set(h)
        .expect(200);
    });

    it('import refuses a wrong shape whole: половины личности быть не должно', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const before = await request(app.getHttpServer())
        .get(`/api/personas/${personaId}`)
        .set(h)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/personas/${personaId}/import`)
        .set(h)
        .send({
          sections: { goals: { stages: [] }, beats: { нет: 'массива' } },
        })
        .expect(422);
      await request(app.getHttpServer())
        .post(`/api/personas/${personaId}/import`)
        .set(h)
        .send({ sections: { nope: {} } })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/personas/${personaId}/import`)
        .set(h)
        .send({ sections: {} })
        .expect(422);
      const after = await request(app.getHttpServer())
        .get(`/api/personas/${personaId}`)
        .set(h)
        .expect(200);
      // Ни одна секция не проехала: проверка идёт до записи, целиком.
      expect(after.body.sections).toEqual(before.body.sections);
    });

    it('a manager cannot read or edit personas', async () => {
      const h = { Authorization: `Bearer ${token}` };
      await request(app.getHttpServer())
        .post('/api/managers')
        .set(h)
        .send({
          username: 'kate',
          password: 'kate12345',
          role: 'manager',
          region_code: '0077',
        })
        .expect(200);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'kate', password: 'kate12345' })
        .expect(200);
      const mh = { Authorization: `Bearer ${login.body.tokens.accessToken}` };
      await request(app.getHttpServer())
        .get('/api/personas')
        .set(mh)
        .expect(403);
      await request(app.getHttpServer())
        .put(`/api/personas/${personaId}/sections/prompts`)
        .set(mh)
        .send({ data: {} })
        .expect(403);
    });
  });

  describe('вложения, ответы и реакции', () => {
    // Однопиксельный png: важен не он, а путь «загрузили → отправили».
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    let uploaded: string;

    it('файл принимается сырым телом, вид определяется по имени', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const r = await request(app.getHttpServer())
        .post('/api/conversations/424242/upload?name=dot.png')
        .set(h)
        .set('Content-Type', 'image/png')
        .send(png)
        .expect(200);
      expect(r.body).toMatchObject({ kind: 'photo', bytes: png.length });
      expect(r.body.path).toContain('uploads');
      uploaded = r.body.path;
    });

    it('вложение встаёт в очередь тем же путём, что и текст', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const r = await request(app.getHttpServer())
        .post('/api/conversations/424242/attachment')
        .set(h)
        .send({ kind: 'photo', source: uploaded, caption: 'вот' })
        .expect(200);
      expect(r.body).toMatchObject({
        ok: true,
        kind: 'photo',
        pending_reply_id: expect.any(Number),
      });
    });

    it('ссылку Telegram скачает сам, а чужой путь на диске мы не отправим', async () => {
      const h = { Authorization: `Bearer ${token}` };
      await request(app.getHttpServer())
        .post('/api/conversations/424242/attachment')
        .set(h)
        .send({ kind: 'animation', source: 'https://media.tenor.com/x.mp4' })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/conversations/424242/attachment')
        .set(h)
        .send({ kind: 'photo', source: '/etc/passwd' })
        .expect(422);
      await request(app.getHttpServer())
        .post('/api/conversations/424242/attachment')
        .set(h)
        .send({ kind: 'exe', source: uploaded })
        .expect(400);
    });

    it('реакция принимается только из списка Telegram', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const ok = await request(app.getHttpServer())
        .post('/api/conversations/424242/reaction')
        .set(h)
        .send({ message_id: 11, emoji: '👍' })
        .expect(200);
      expect(ok.body).toMatchObject({ ok: true, emoji: '👍' });
      // Пустая строка — снять реакцию, это разрешено.
      await request(app.getHttpServer())
        .post('/api/conversations/424242/reaction')
        .set(h)
        .send({ message_id: 11, emoji: '' })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/conversations/424242/reaction')
        .set(h)
        .send({ message_id: 11, emoji: '🥑' })
        .expect(422);
    });

    it('ответ на сообщение доезжает до очереди', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const r = await request(app.getHttpServer())
        .post('/api/conversations/424242/message')
        .set(h)
        .send({ text: 'отвечаю', reply_to: 77 })
        .expect(200);
      expect(r.body.ok).toBe(true);
      // Лента несёт поля вложения и ответа — панель рисует их без догадок.
      // Строку кладём напрямую: доставку делает воркер, а Telegram в тестах нет.
      const prisma = app.get(PrismaService);
      await prisma.message.create({
        data: {
          chatId: BigInt(424242),
          ts: 1,
          role: 'assistant',
          text: 'вот',
          author: 'operator:web',
          tgMsgId: 900,
          mediaKind: 'photo',
          filePath: 'C:/uploads/x.png',
          replyTo: 77,
        },
      });
      const detail = await request(app.getHttpServer())
        .get('/api/conversations/424242')
        .set(h)
        .expect(200);
      const row = detail.body.messages.find((m) => m.tg_msg_id === 900);
      expect(row).toMatchObject({
        media_kind: 'photo',
        reply_to: 77,
        reaction: null,
      });
      // Путь на диске наружу не выходит: панель ходит за файлом по ссылке.
      expect(row.media_url).toMatch(/^\/api\/files\/\d+$/);
    });

    it('в диалоге едут цели знакомства: темы личности и что бот спросит дальше', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const detail = await request(app.getHttpServer())
        .get('/api/conversations/424242')
        .set(h)
        .expect(200);
      const goals = detail.body.goals;
      // Список тем — из документа личности, а не из панели: ошибись здесь, и менеджер
      // увидит чужой чек-лист вместо целей той личности, которой говорят в этом чате.
      expect(goals.slots.map((s) => s.id)).toContain('work');
      expect(
        goals.slots.every((s) => typeof s.title === 'string' && s.title),
      ).toBe(true);
      expect(goals.stage.total).toBeGreaterThan(1);
      expect(goals.known).toBe(0);
      expect(goals.next).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
      });
      // Отложенного ответа нет — панель не рисует «ответит в …».
      expect(detail.body.scheduled_reply).toBeNull();
    });

    it('в списке диалогов — этап знакомства из личности, а не вечный «Холодный»', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const prisma = app.get(PrismaService);
      // В список менеджера попадают чаты, где собеседник хоть раз написал.
      await prisma.message.create({
        data: {
          chatId: BigInt(424242),
          ts: 2,
          role: 'user',
          text: 'привет',
          author: 'client',
        },
      });

      const first = await request(app.getHttpServer())
        .get('/api/manager/conversations')
        .set(h)
        .expect(200);
      const row = first.body.items.find((r) => r.chat_id === 424242);
      expect(row.stage).toMatchObject({
        id: 'knock',
        title: 'первое касание',
        index: 1,
      });
      expect(row.stage.total).toBeGreaterThan(1);

      // Движок перевёл чат на второй этап — список показывает его, а не свёрнутую воронку.
      const facts = await prisma.leadFacts.findUnique({
        where: { chatId: BigInt(424242) },
      });
      const next = {
        ...(facts ? JSON.parse(facts.facts) : {}),
        _brain_stage: 'smalltalk',
        funnel_stage: 'cold',
      };
      await prisma.leadFacts.upsert({
        where: { chatId: BigInt(424242) },
        create: { chatId: BigInt(424242), facts: JSON.stringify(next) },
        update: { facts: JSON.stringify(next) },
      });
      const second = await request(app.getHttpServer())
        .get('/api/manager/conversations')
        .set(h)
        .expect(200);
      expect(
        second.body.items.find((r) => r.chat_id === 424242).stage,
      ).toMatchObject({ id: 'smalltalk', title: 'разговорились', index: 2 });
    });

    it('переменная {site} из вкладки подставляется во все документы, в редакторе остаётся как есть', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const list = await request(app.getHttpServer())
        .get('/api/personas')
        .set(h)
        .expect(200);
      const id = list.body.items.find((x) => x.slug === 'nastya').id;
      const persona = await request(app.getHttpServer())
        .get(`/api/personas/${id}`)
        .set(h)
        .expect(200);

      // Ошибки словами: встроенную {name} задать нельзя, имя с цифры — тоже.
      const bad = await request(app.getHttpServer())
        .put(`/api/personas/${id}/sections/variables`)
        .set(h)
        .send({ data: { name: 'Лена', '1site': 'x' } })
        .expect(422);
      expect(JSON.stringify(bad.body)).toMatch(/встроенная/);

      await request(app.getHttpServer())
        .put(`/api/personas/${id}/sections/variables`)
        .set(h)
        .send({ data: { site: 'mamba', _site: 'сайт знакомств' } })
        .expect(200);

      // Тема «работа» спрашивает с переменной — в целях диалога уже значение.
      const goals = structuredClone(persona.body.sections.goals);
      const work = goals.slots.find((slot) => slot.id === 'work');
      work.hint = 'а на {site} ты кем себя записал? {name} интересно';
      await request(app.getHttpServer())
        .put(`/api/personas/${id}/sections/goals`)
        .set(h)
        .send({ data: goals })
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get('/api/conversations/424242')
        .set(h)
        .expect(200);
      const row = detail.body.goals.slots.find((slot) => slot.id === 'work');
      expect(row.title).toBe('а на mamba ты кем себя записал? Настя интересно');

      // Редактор получает документ как написан — с {site}, иначе правка затёрла бы переменную значением.
      const raw = await request(app.getHttpServer())
        .get(`/api/personas/${id}`)
        .set(h)
        .expect(200);
      expect(
        raw.body.sections.goals.slots.find((slot) => slot.id === 'work').hint,
      ).toContain('{site}');
      expect(raw.body.sections.variables).toEqual({
        site: 'mamba',
        _site: 'сайт знакомств',
      });

      // Возвращаем как было: остальные проверки не должны зависеть от этой.
      await request(app.getHttpServer())
        .put(`/api/personas/${id}/sections/goals`)
        .set(h)
        .send({ data: persona.body.sections.goals })
        .expect(200);
      await request(app.getHttpServer())
        .put(`/api/personas/${id}/sections/variables`)
        .set(h)
        .send({ data: {} })
        .expect(200);
    });

    it('{city} и {site} у каждого диалога свои: из карточки лида, личность — запасное значение', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const list = await request(app.getHttpServer())
        .get('/api/personas')
        .set(h)
        .expect(200);
      const id = list.body.items.find((x) => x.slug === 'nastya').id;
      const persona = await request(app.getHttpServer())
        .get(`/api/personas/${id}`)
        .set(h)
        .expect(200);

      // Лид с сайтом: поле хранится и отдаётся.
      const lead = await request(app.getHttpServer())
        .post('/api/leads')
        .set(h)
        .send({
          phone: '+7 900 777-11-22',
          first_name: 'Олег',
          city: 'Омск',
          site: 'mamba',
        })
        .expect(200);
      expect(lead.body).toMatchObject({ city: 'Омск', site: 'mamba' });
      // Аккаунт ещё не назначен — ника нет, но поле в ответе есть: панель рисует колонку без догадок.
      const leads = await request(app.getHttpServer())
        .get('/api/leads')
        .set(h)
        .expect(200);
      expect(leads.body.items.find((x) => x.id === lead.body.id)).toMatchObject(
        { assigned_account_id: null, assigned_account_username: null },
      );

      await request(app.getHttpServer())
        .put(`/api/personas/${id}/sections/variables`)
        .set(h)
        .send({ data: { site: 'beboo', city: 'ваш город' } })
        .expect(200);
      const goals = structuredClone(persona.body.sections.goals);
      goals.slots.find((slot) => slot.id === 'work').hint =
        'на {site} из {city}?';
      await request(app.getHttpServer())
        .put(`/api/personas/${id}/sections/goals`)
        .set(h)
        .send({ data: goals })
        .expect(200);
      const title = async () =>
        (
          await request(app.getHttpServer())
            .get('/api/conversations/424242')
            .set(h)
            .expect(200)
        ).body.goals.slots.find((slot) => slot.id === 'work').title;

      // В карточке пусто — запасные значения личности.
      await request(app.getHttpServer())
        .post('/api/conversations/424242/pin-fact')
        .set(h)
        .send({ key: 'city', value: '' })
        .expect(200);
      expect(await title()).toBe('на beboo из ваш город?');

      // Карточка лида заполнена — у этого диалога свои.
      await request(app.getHttpServer())
        .post('/api/conversations/424242/pin-fact')
        .set(h)
        .send({ key: 'site', value: 'mamba' })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/conversations/424242/pin-fact')
        .set(h)
        .send({ key: 'city', value: 'Омск' })
        .expect(200);
      expect(await title()).toBe('на mamba из Омск?');

      // Движку личность отдаётся со скобками: текст одинаков у всех чатов, кеш промпта читается.
      // Значения этого диалога — рядом, в `variables`.
      const loaded = await app.get(PersonaService).forChat(424242);
      expect(
        loaded.config.goals.slots.find((slot) => slot.id === 'work').hint,
      ).toBe('на {site} из {city}?');
      expect(loaded.variables).toMatchObject({
        site: 'mamba',
        city: 'Омск',
        name: 'Настя',
      });

      // Сайт из карточки — ещё и факт для бота: где познакомились.
      const state = await app
        .get(PrismaService)
        .brainState.findUnique({ where: { chatId: BigInt(424242) } });
      expect(JSON.parse(state!.stateJson).character.slots.dating_site).toBe(
        'mamba',
      );

      await request(app.getHttpServer())
        .put(`/api/personas/${id}/sections/goals`)
        .set(h)
        .send({ data: persona.body.sections.goals })
        .expect(200);
      await request(app.getHttpServer())
        .put(`/api/personas/${id}/sections/variables`)
        .set(h)
        .send({ data: {} })
        .expect(200);
    });

    it('ручная отметка темы и поля карточки доходит до памяти бота', async () => {
      const h = { Authorization: `Bearer ${token}` };
      const marked = await request(app.getHttpServer())
        .post('/api/conversations/424242/slot')
        .set(h)
        .send({ slot_id: 'work', value: 'водитель лимузина' })
        .expect(200);
      expect(marked.body).toMatchObject({
        ok: true,
        slot_id: 'work',
        value: 'водитель лимузина',
      });

      // Город из карточки — тема `location` у личности.
      await request(app.getHttpServer())
        .post('/api/conversations/424242/pin-fact')
        .set(h)
        .send({ key: 'city', value: 'Омск' })
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get('/api/conversations/424242')
        .set(h)
        .expect(200);
      const by = Object.fromEntries(
        detail.body.goals.slots.map((s) => [s.id, s]),
      );
      expect(by.work).toMatchObject({
        state: 'known',
        value: 'водитель лимузина',
      });
      expect(by.location).toMatchObject({ state: 'known', value: 'Омск' });
      // Карточка — зеркало тем: работа видна и там.
      expect(detail.body.pinned_facts).toMatchObject({
        job: 'водитель лимузина',
        city: 'Омск',
      });

      const state = await app
        .get(PrismaService)
        .brainState.findUnique({ where: { chatId: BigInt(424242) } });
      const brain = JSON.parse(state!.stateJson);
      expect(
        brain.memories.some(
          (m) => m.slot_id === 'work' && m.text === 'водитель лимузина',
        ),
      ).toBe(true);

      // Снять отметку — тема снова открыта; чужой темы у личности нет — 422.
      await request(app.getHttpServer())
        .post('/api/conversations/424242/slot')
        .set(h)
        .send({ slot_id: 'work', value: '' })
        .expect(200);
      const after = await request(app.getHttpServer())
        .get('/api/conversations/424242')
        .set(h)
        .expect(200);
      expect(
        after.body.goals.slots.find((s) => s.id === 'work').state,
      ).not.toBe('known');
      await request(app.getHttpServer())
        .post('/api/conversations/424242/slot')
        .set(h)
        .send({ slot_id: 'salary', value: '100' })
        .expect(422);
    });
  });
});
