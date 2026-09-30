import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Cron } from '@nestjs/schedule';
import { DashboardUser } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import { Api, TelegramClient } from 'telegram';
import { Raw } from 'telegram/events';
import bigInt from 'big-integer';
import { WebSocket, WebSocketServer } from 'ws';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { PauseService } from 'src/shared/pause.service';
import { GlobalGateService } from 'src/shared/global-gate.service';
import { TakeoverReason } from 'src/domain/pause';
import { VoicerChatService } from './voicer-chat.service';
import { VoicerAutomationService } from './voicer-automation.service';
import { TelegramService } from '../telegram/telegram.service';
import { CallMedia } from './voicer-call-media';
import { credentialTag } from 'src/shared/session-claims';
import { VoicerCallOutcomeService } from './voicer-call-outcome.service';
import { REPLY_BRAIN, ReplyBrain } from 'src/brain/reply-brain.port';

type Ticket = {
  userId: number;
  credential: string;
  taskId: number;
  revision: number;
  accountId: number;
  expires: number;
};
type LiveCall = Ticket & {
  id: string;
  chatId: bigint;
  socket: WebSocket;
  client: TelegramClient;
  media: CallMedia;
  peer?: Api.InputPhoneCall;
  protocol?: Api.PhoneCallProtocol;
  handler?: (u: any) => Promise<void>;
  raw?: Raw;
  ended: boolean;
  accepted: boolean;
  connectedAt?: number;
  createdAt: number;
  lastPong: number;
  bytes: number;
  byteWindow: number;
  signalQueue: Buffer[];
  incomingSignals: Buffer[];
  earlyUpdates: any[];
  mediaReady: boolean;
  dialPending: boolean;
  discarded?: boolean;
  endStatus?: string;
  draining?: Promise<void>;
  timer?: NodeJS.Timeout;
};
const wsSend = (socket: WebSocket, data: unknown) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
};
export const callError = (e: any) => {
  const code = String(e?.errorMessage || e?.message || '');
  if (/USER_PRIVACY_RESTRICTED|USER_IS_BLOCKED/.test(code))
    return 'Настройки собеседника запрещают этот звонок';
  if (/PARTICIPANT_VERSION_OUTDATED/.test(code))
    return 'Собеседнику нужно обновить Telegram для звонка';
  if (/USER_NOT_MUTUAL_CONTACT/.test(code))
    return 'Telegram разрешает звонок только взаимным контактам';
  if (/FLOOD_WAIT/.test(code))
    return 'Telegram просит подождать перед следующим звонком';
  if (/CALL_PROTOCOL|LAYER_INVALID/.test(code))
    return 'Telegram не принял протокол звонка';
  if (/[а-яА-Я]/.test(code)) return code.slice(0, 200);
  return 'Не удалось установить звонок. Проверьте подключение и повторите';
};

@Injectable()
export class VoicerCallService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private log = new Logger(VoicerCallService.name);
  private finishing = false;
  private tickets = new Map<string, Ticket>();
  private live = new Map<string, LiveCall>();
  private wss?: WebSocketServer;
  private server: any;
  private upgrade: any;
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private chats: VoicerChatService,
    private telegram: TelegramService,
    private pause: PauseService,
    private autoVoice: VoicerAutomationService,
    private gate: GlobalGateService,
    private http: HttpAdapterHost,
    private outcomes: VoicerCallOutcomeService,
    @Inject(REPLY_BRAIN) private brain: ReplyBrain,
  ) {}

  async onApplicationBootstrap() {
    await this.prisma.voiceCall.updateMany({
      where: { endedAt: null },
      data: {
        status: 'interrupted',
        reason: 'Сервер перезапущен; автоматического повторного вызова нет',
        endedAt: this.clock.ts(),
      },
    });
    this.server = this.http.httpAdapter.getHttpServer();
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 4096,
      perMessageDeflate: false,
    });
    this.upgrade = (request, socket, head) => {
      if (request.url !== '/api/voicer/call/ws') return;
      this.wss!.handleUpgrade(request, socket, head, (ws) => this.attach(ws));
    };
    this.server.on('upgrade', this.upgrade);
  }
  async onModuleDestroy() {
    this.server?.off('upgrade', this.upgrade);
    await Promise.all(
      [...this.live.values()].map((c) =>
        this.end(c, 'ended', 'Соединение закрыто сервером'),
      ),
    );
    this.wss?.clients.forEach((ws) => ws.terminate());
    this.wss?.close();
  }

  private async allowed(user: DashboardUser, taskId: number) {
    if (user.role !== 'voice')
      throw new ForbiddenException('Звонит назначенный войсер');
    const { task, contact } = await this.chats.context(user, taskId);
    if (
      task.kind !== 'call' ||
      task.status !== 'in_progress' ||
      task.voicerId !== user.id
    )
      throw new ConflictException(
        'Сначала возьмите задание на звонок в работу',
      );
    if (!contact?.account || !task.chatId)
      throw new BadRequestException(
        'Менеджеру нужно привязать диалог к заданию',
      );
    if (contact.blockedByClientAt)
      throw new BadRequestException('Собеседник заблокировал аккаунт');
    if (contact.account.status !== 'active')
      throw new BadRequestException('Telegram-аккаунт не подключён');
    if (this.gate.stopped)
      throw new BadRequestException('Отправки остановлены администратором');
    return {
      task,
      contact,
      client: this.telegram.callClient(contact.account.id),
    };
  }
  async ticket(user: DashboardUser, taskId: number) {
    const { task, contact } = await this.allowed(user, taskId);
    this.checkBusy(user.id, contact.account!.id);
    for (const [key, t] of this.tickets)
      if (t.userId === user.id || t.expires <= this.clock.ts())
        this.tickets.delete(key);
    const ticket = randomBytes(32).toString('hex');
    this.tickets.set(ticket, {
      userId: user.id,
      credential: credentialTag(user),
      taskId,
      revision: task.revision,
      accountId: contact.account!.id,
      expires: this.clock.ts() + 30,
    });
    return { ticket, expires_at: this.clock.ts() + 30 };
  }
  private checkBusy(userId: number, accountId: number) {
    if (
      [...this.live.values()].some(
        (c) => c.userId === userId || c.accountId === accountId,
      )
    )
      throw new ConflictException(
        'Войсер или Telegram-аккаунт уже участвует в звонке',
      );
  }
  async status(user: DashboardUser, taskId: number) {
    await this.chats.context(user, taskId);
    const row = await this.prisma.voiceCall.findFirst({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    });
    return row
      ? {
          id: row.id,
          status: row.status,
          reason: row.reason,
          created_at: row.createdAt,
          connected_at: row.connectedAt,
          ended_at: row.endedAt,
        }
      : null;
  }
  private attach(socket: WebSocket) {
    let call: LiveCall | undefined,
      used = false;
    const authTimer = setTimeout(
      () => socket.close(1008, 'Authentication required'),
      5000,
    );
    socket.on('error', () => {});
    socket.on('pong', () => {
      if (call) call.lastPong = this.clock.ts();
    });
    socket.on('close', () => {
      clearTimeout(authTimer);
      if (call) void this.end(call, 'ended', 'Окно звонка закрыто');
    });
    socket.on('message', async (data, binary) => {
      try {
        if (!used) {
          used = true;
          clearTimeout(authTimer);
          if (binary) throw new ForbiddenException('Войдите в кабинет войсера');
          const ticket = JSON.parse(data.toString()).ticket;
          const t = this.tickets.get(ticket);
          this.tickets.delete(ticket);
          if (!t || t.expires <= this.clock.ts())
            throw new ForbiddenException(
              'Ссылка на звонок истекла — нажмите «Позвонить» ещё раз',
            );
          const user = await this.prisma.dashboardUser.findUnique({
            where: { id: t.userId },
          });
          if (!user || credentialTag(user) !== t.credential)
            throw new ForbiddenException('Войдите в кабинет заново');
          const { task, contact, client } = await this.allowed(user, t.taskId);
          if (
            task.revision !== t.revision ||
            contact.account!.id !== t.accountId
          )
            throw new ConflictException('Назначение звонка изменилось');
          if (socket.readyState !== WebSocket.OPEN) return;
          this.checkBusy(user.id, t.accountId);
          call = {
            ...t,
            id: randomUUID(),
            chatId: task.chatId!,
            socket,
            client,
            media: new CallMedia(),
            ended: false,
            accepted: false,
            createdAt: this.clock.ts(),
            lastPong: this.clock.ts(),
            bytes: 0,
            byteWindow: Date.now(),
            signalQueue: [],
            incomingSignals: [],
            earlyUpdates: [],
            mediaReady: false,
            dialPending: false,
          };
          this.live.set(call.id, call);
          await this.start(call);
        } else if (call && !call.ended) {
          if (binary) {
            if (Date.now() - call.byteWindow >= 1000) {
              call.bytes = 0;
              call.byteWindow = Date.now();
            }
            const pcm = Buffer.from(data as Buffer);
            call.bytes += pcm.length;
            if (pcm.length !== 960 || call.bytes > 192000)
              throw new BadRequestException('Некорректный поток микрофона');
            if (call.connectedAt) call.media.audio(pcm);
          } else if (JSON.parse(data.toString()).action === 'hangup')
            await this.end(call, 'ended', 'Войсер завершил звонок');
        }
      } catch (e) {
        if (call) await this.end(call, 'failed', callError(e));
        else {
          wsSend(socket, { status: 'failed', reason: callError(e) });
          socket.close(1008);
        }
      }
    });
  }
  private async start(c: LiveCall) {
    await this.prisma.voiceCall.create({
      data: {
        id: c.id,
        taskId: c.taskId,
        revision: c.revision,
        accountId: c.accountId,
        chatId: c.chatId,
        voicerId: c.userId,
        createdAt: c.createdAt,
      },
    });
    if (c.ended) {
      await this.prisma.voiceCall.update({
        where: { id: c.id },
        data: {
          status: 'ended',
          endedAt: this.clock.ts(),
          reason: 'Окно звонка закрыто',
        },
      });
      return;
    }
    c.media.on(
      'lost',
      () =>
        void this.end(
          c,
          'failed',
          'Модуль звука остановился. Повторите звонок',
        ),
    );
    c.media.on('signal', (data: Buffer) => {
      if (c.ended) return;
      if (!c.peer) {
        if (c.signalQueue.length < 100) c.signalQueue.push(data);
        return;
      }
      void c.client
        .invoke(new Api.phone.SendSignalingData({ peer: c.peer, data }))
        .catch((e) => this.end(c, 'failed', callError(e)));
    });
    c.media.on('audio', (data: Buffer) => {
      if (c.ended || c.socket.readyState !== WebSocket.OPEN) return;
      if (c.socket.bufferedAmount > 96000) {
        void this.end(c, 'failed', 'Соединение с браузером слишком медленное');
        return;
      }
      c.socket.send(data);
    });
    c.media.on('state', (state: string) => {
      if (c.ended) return;
      if (state === 'CONNECTED' && !c.connectedAt) {
        if (c.timer) clearTimeout(c.timer);
        c.connectedAt = this.clock.ts();
        void this.prisma.voiceCall
          .updateMany({
            where: { id: c.id, endedAt: null },
            data: { status: 'connected', connectedAt: c.connectedAt },
          })
          .then(() => {
            if (!c.ended)
              wsSend(c.socket, {
                status: 'connected',
                connected_at: c.connectedAt,
              });
          })
          .catch(() =>
            this.end(c, 'failed', 'Не удалось сохранить состояние звонка'),
          );
      } else if (['FAILED', 'TIMEOUT', 'CLOSED'].includes(state))
        void this.end(c, 'failed', 'Звуковое соединение прервано');
    });
    c.raw = new Raw({
      types: [Api.UpdatePhoneCall, Api.UpdatePhoneCallSignalingData],
    });
    c.handler = async (u) => {
      try {
        await this.update(c, u);
      } catch (e) {
        await this.end(c, 'failed', callError(e));
      }
    };
    c.client.addEventHandler(c.handler, c.raw);
    c.timer = setTimeout(
      () =>
        void this.end(
          c,
          'failed',
          'Telegram не ответил вовремя. Попробуйте позже',
        ),
      45000,
    );
    const dh = await c.client.invoke(
      new Api.messages.GetDhConfig({ version: 0, randomLength: 256 }),
    );
    if (!(dh instanceof Api.messages.DhConfig))
      throw Error('Telegram не выдал параметры звонка');
    const info = await c.media.request('init', {
      g: dh.g,
      p: dh.p,
      random: dh.random,
    });
    if (c.ended) return;
    c.protocol = new Api.PhoneCallProtocol({ ...info.protocol, udpP2p: false });
    const user = await this.prisma.dashboardUser.findUniqueOrThrow({
      where: { id: c.userId },
    });
    if (credentialTag(user) !== c.credential)
      throw Error('Войдите в кабинет заново');
    const scope = await this.allowed(user, c.taskId);
    if (
      scope.task.revision !== c.revision ||
      scope.contact.accountId !== c.accountId
    )
      throw Error('Назначение звонка изменилось');
    await this.autoVoice.cancelForChat(
      Number(c.chatId),
      'Начинается звонок с войсером',
    );
    await this.pause.pause(
      Number(c.chatId),
      TakeoverReason.MANUAL_TAKEOVER,
      `voicer:call:${c.id}`,
      {
        reasonText:
          'Идёт звонок с войсером. После завершения бот включится автоматически',
      },
    );
    const peer = await c.client.getInputEntity(bigInt(String(c.chatId)));
    if (c.ended) return;
    c.dialPending = true;
    try {
      const result = await c.client.invoke(
        new Api.phone.RequestCall({
          userId: peer as any,
          gAHash: info.hash,
          protocol: c.protocol,
          randomId: randomBytes(4).readInt32LE(),
        }),
      );
      const phone = result.phoneCall as Api.PhoneCallWaiting;
      c.peer = new Api.InputPhoneCall({
        id: phone.id,
        accessHash: phone.accessHash,
      });
    } finally {
      c.dialPending = false;
      if (c.ended) {
        try {
          await this.discard(c);
          await this.prisma.voiceCall.updateMany({
            where: { id: c.id },
            data: { status: c.endStatus ?? 'ended', endedAt: this.clock.ts() },
          });
        } finally {
          this.live.delete(c.id);
          await this.finalize(c.id);
        }
      }
    }
    if (c.ended) return;
    for (const data of c.signalQueue.splice(0))
      await c.client.invoke(
        new Api.phone.SendSignalingData({ peer: c.peer, data }),
      );
    for (const update of c.earlyUpdates.splice(0)) await this.update(c, update);
    if (c.ended || c.connectedAt) return;
    await this.prisma.voiceCall.updateMany({
      where: { id: c.id, status: 'connecting' },
      data: { status: 'ringing' },
    });
    if (c.ended || c.connectedAt) return;
    wsSend(c.socket, { status: 'ringing' });
    if (c.timer) clearTimeout(c.timer);
    c.timer = setTimeout(() => {
      if (!c.connectedAt) void this.end(c, 'missed', 'Собеседник не ответил');
    }, 60000);
  }
  private async update(c: LiveCall, u: any) {
    if (c.ended) return;
    if (!c.peer) {
      if (c.dialPending) {
        if (c.earlyUpdates.length >= 100)
          throw Error('Слишком много событий при подключении звонка');
        c.earlyUpdates.push(u);
      }
      return;
    }
    if (u instanceof Api.UpdatePhoneCallSignalingData) {
      if (c.peer.id.equals(u.phoneCallId)) {
        if (c.incomingSignals.length >= 100)
          throw Error('Переполнена очередь подключения звука');
        c.incomingSignals.push(u.data);
        if (c.mediaReady) await this.drainSignals(c);
      }
      return;
    }
    if (!(u instanceof Api.UpdatePhoneCall)) return;
    const phone = u.phoneCall;
    if (!c.peer.id.equals(phone.id)) return;
    if (phone instanceof Api.PhoneCallDiscarded) {
      await this.end(
        c,
        phone.reason instanceof Api.PhoneCallDiscardReasonBusy
          ? 'busy'
          : 'ended',
        phone.reason instanceof Api.PhoneCallDiscardReasonBusy
          ? 'Собеседник занят или отклонил вызов'
          : 'Собеседник завершил звонок',
        false,
      );
      return;
    }
    if (!(phone instanceof Api.PhoneCallAccepted) || c.accepted) return;
    c.accepted = true;
    c.peer = new Api.InputPhoneCall({
      id: phone.id,
      accessHash: phone.accessHash,
    });
    const keys = await c.media.request('exchange', phone.gB);
    if (c.ended) return;
    const res = await c.client.invoke(
      new Api.phone.ConfirmCall({
        peer: c.peer,
        gA: keys.gAOrB,
        keyFingerprint: bigInt(String(keys.keyFingerprint)),
        protocol: c.protocol!,
      }),
    );
    if (c.ended) return;
    if (!(res.phoneCall instanceof Api.PhoneCall))
      throw Error('Telegram не подтвердил соединение');
    const p = res.phoneCall;
    if (!p.protocol.libraryVersions.includes('9.0.0'))
      throw Error(
        'Telegram не согласовал поддерживаемую версию звукового соединения',
      );
    await c.media.request('connect', {
      servers: p.connections.map((s: any) => ({
        id: BigInt(String(s.id)),
        ipv4: s.ip,
        ipv6: s.ipv6,
        port: s.port,
        username: s.username,
        password: s.password,
        turn: s instanceof Api.PhoneConnection ? true : Boolean(s.turn),
        stun: Boolean(s.stun),
        tcp: Boolean(s.tcp),
        peerTag: s.peerTag,
      })),
      versions: p.protocol.libraryVersions,
      params: p.customParameters?.data,
    });
    if (!c.ended) {
      c.mediaReady = true;
      await this.drainSignals(c);
    }
  }
  private async drainSignals(c: LiveCall) {
    if (!c.draining) {
      c.draining = (async () => {
        while (!c.ended && c.incomingSignals.length)
          await c.media.request('signal', c.incomingSignals.shift());
      })().finally(() => {
        c.draining = undefined;
      });
    }
    await c.draining;
  }
  private async discard(c: LiveCall) {
    if (!c.peer || c.discarded) return;
    c.discarded = true;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        c.client
          .invoke(
            new Api.phone.DiscardCall({
              peer: c.peer,
              duration: c.connectedAt
                ? Math.max(0, this.clock.ts() - c.connectedAt)
                : 0,
              reason: c.connectedAt
                ? new Api.PhoneCallDiscardReasonHangup()
                : new Api.PhoneCallDiscardReasonMissed(),
              connectionId: bigInt.zero,
            }),
          )
          .catch(() => {}),
        new Promise((resolve) => {
          timer = setTimeout(resolve, 3000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async end(
    c: LiveCall,
    status: string,
    reason: string,
    discard = true,
  ) {
    if (c.ended) return;
    c.ended = true;
    c.endStatus = status;
    if (c.timer) clearTimeout(c.timer);
    c.media.stop();
    if (c.handler && c.raw) c.client.removeEventHandler(c.handler, c.raw);
    wsSend(c.socket, { status, reason, ended: true });
    c.socket.close(1000);
    try {
      await this.prisma.voiceCall.updateMany({
        where: { id: c.id },
        data: {
          status: c.dialPending ? 'ending' : status,
          reason,
          connectedAt: c.connectedAt ?? null,
          endedAt: c.dialPending ? null : this.clock.ts(),
        },
      });
    } finally {
      if (discard) await this.discard(c);
      if (!c.dialPending) {
        this.live.delete(c.id);
        await this.finalize(c.id);
      }
    }
  }
  private async finalize(id: string) {
    try {
      await this.outcomes.finalize(id);
    } catch {
      this.log.warn('Не удалось сохранить итог звонка; повторим автоматически');
    }
  }
  @Cron('*/5 * * * * *')
  async finishCalls() {
    if (this.finishing) return;
    this.finishing = true;
    try {
      const ended = await this.prisma.voiceCall.findMany({
        where: {
          endedAt: { not: null },
          OR: [{ finalizedAt: null }, { resumeStatus: 'pending' }],
        },
        take: 20,
      });
      for (const call of ended)
        if (!this.live.has(call.id)) await this.finalize(call.id);
      const due = await this.prisma.voiceCall.findMany({
        where: {
          followupStatus: { in: ['pending', 'resume'] },
          endedAt: { lte: this.clock.ts() - 45 },
        },
        take: 5,
      });
      for (const call of due) await this.brain.answerAfterCall?.(call.id);
    } catch {
      this.log.warn('Обработка итогов звонков будет повторена');
    } finally {
      this.finishing = false;
    }
  }
  @Cron('*/5 * * * * *')
  async checkCalls() {
    for (const [key, t] of this.tickets)
      if (t.expires <= this.clock.ts()) this.tickets.delete(key);
    for (const c of this.live.values()) {
      if (c.ended) continue;
      if (
        this.clock.ts() - c.lastPong > 20 ||
        this.clock.ts() - c.createdAt > 3600
      ) {
        await this.end(c, 'ended', 'Звонок закрыт по таймауту');
        continue;
      }
      try {
        const user = await this.prisma.dashboardUser.findUniqueOrThrow({
          where: { id: c.userId },
        });
        if (credentialTag(user) !== c.credential)
          throw Error('Пароль кабинета изменён. Войдите заново');
        const { task, contact, client } = await this.allowed(user, c.taskId);
        if (client !== c.client)
          throw Error('Подключение Telegram-аккаунта изменилось');
        if (task.revision !== c.revision || contact.accountId !== c.accountId)
          throw Error('Назначение звонка изменилось');
        c.socket.ping();
      } catch (e) {
        await this.end(c, 'ended', callError(e));
      }
    }
  }
}
