import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DashboardUser } from '@prisma/client';
import { execFile } from 'child_process';
import { createWriteStream, WriteStream } from 'fs';
import { mkdir, readFile, rm, stat } from 'fs/promises';
import { isAbsolute, join, relative, resolve } from 'path';
import { promisify } from 'util';
import { appConfig } from 'src/config/app.config';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { panelTime } from 'src/shared/panel-time';
import { VoicerService } from './voicer.service';

const run = promisify(execFile);
const ENCODE_TIMEOUT_MS = 300_000;
export const SAMPLE_RATE = 48000;

/**
 * Диктофон одного звонка: микрофон войсера и голос собеседника пишутся в два
 * сырых файла PCM (48 кГц, моно, s16le) по мере прихода кадров. Так запись
 * не трогает ни задержку звонка, ни память: на диск уходят ровно те байты,
 * что и так проходят через сервер.
 */
export class CallRecorder {
  private readonly mic: WriteStream;
  private readonly peer: WriteStream;
  private closed = false;
  constructor(
    readonly micPath: string,
    readonly peerPath: string,
  ) {
    this.mic = createWriteStream(micPath);
    this.peer = createWriteStream(peerPath);
    this.mic.on('error', () => {});
    this.peer.on('error', () => {});
  }
  fromVoicer(pcm: Buffer): void {
    if (!this.closed) this.mic.write(pcm);
  }
  fromPeer(pcm: Buffer): void {
    if (!this.closed) this.peer.write(pcm);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all(
      [this.mic, this.peer].map(
        (s) => new Promise<void>((done) => s.end(() => done())),
      ),
    );
  }
}

/** Подпись по умолчанию: название задания и момент звонка, войсер потом поменяет. */
export function defaultCallTitle(
  taskTitle: string,
  connectedAt: number,
): string {
  return `${taskTitle} · звонок ${panelTime(connectedAt)}`;
}

/**
 * ffmpeg: два моно-потока в один стерео-файл opus. Левый канал — войсер,
 * правый — собеседник: так при прослушивании слышно, кто говорит. Короткий
 * поток добивается тишиной до длинного; потолок — час.
 */
export function mergeArgs(mic: string, peer: string, out: string): string[] {
  const pcm = ['-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1'];
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...pcm,
    '-i',
    mic,
    ...pcm,
    '-i',
    peer,
    '-filter_complex',
    '[0:a]apad[l];[1:a]apad[r];[l][r]amerge=inputs=2,atrim=0:3600[a]',
    '-map',
    '[a]',
    '-shortest',
    '-c:a',
    'libopus',
    '-b:a',
    '48k',
    '-vbr',
    'on',
    out,
  ];
}

export interface CallRecordingView {
  id: number;
  kind: 'call';
  call_id: string;
  title: string;
  titled: boolean;
  duration: number;
  createdAt: number;
  revision: null;
  current: false;
  last_delivery: null;
  task: unknown;
}

@Injectable()
export class VoicerCallRecordingService {
  private readonly log = new Logger(VoicerCallRecordingService.name);
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private voicer: VoicerService,
  ) {}

  private dir(): string {
    return resolve(appConfig.mediaDir, 'voicer', 'calls');
  }

  /** Начать запись: вызывается в момент, когда звонок соединился. */
  async start(callId: string): Promise<CallRecorder> {
    const dir = this.dir();
    await mkdir(dir, { recursive: true });
    return new CallRecorder(
      join(dir, `${callId}.mic.raw`),
      join(dir, `${callId}.peer.raw`),
    );
  }

  /** Звонок кончился: склеить в opus, положить в библиотеку, сырые файлы убрать. */
  async complete(
    call: { id: string; taskId: number; connectedAt: number; endedAt: number },
    recorder: CallRecorder,
  ): Promise<void> {
    await recorder.close();
    const cleanup = () =>
      Promise.all(
        [recorder.micPath, recorder.peerPath].map((p) =>
          rm(p, { force: true }),
        ),
      );
    try {
      const sizes = await Promise.all(
        [recorder.micPath, recorder.peerPath].map((p) =>
          stat(p)
            .then((s) => s.size)
            .catch(() => 0),
        ),
      );
      // Меньше четверти секунды с обеих сторон — записывать нечего.
      if (Math.max(...sizes) < SAMPLE_RATE * 2 * 0.25) {
        await cleanup();
        return;
      }
      const out = join(this.dir(), `${call.id}.ogg`);
      await run('ffmpeg', mergeArgs(recorder.micPath, recorder.peerPath, out), {
        timeout: ENCODE_TIMEOUT_MS,
        maxBuffer: 1 << 20,
      });
      const size = (await stat(out)).size;
      if (!size) throw new Error('ffmpeg вернул пустой файл');
      const task = await this.prisma.voiceTask.findUnique({
        where: { id: call.taskId },
        select: { title: true },
      });
      await this.prisma.voiceCallRecording.upsert({
        where: { callId: call.id },
        create: {
          callId: call.id,
          taskId: call.taskId,
          title: defaultCallTitle(task?.title ?? 'Звонок', call.connectedAt),
          filePath: out,
          duration: Math.max(1, call.endedAt - call.connectedAt),
          createdAt: this.clock.ts(),
        },
        update: { filePath: out },
      });
      this.log.log(`call ${call.id}: recording saved (${size} bytes)`);
    } catch (e) {
      this.log.error(`call ${call.id}: recording failed: ${e?.message ?? e}`);
    } finally {
      await cleanup();
    }
  }

  /** Звонок не состоялся — сырые файлы не нужны. */
  async discard(recorder: CallRecorder): Promise<void> {
    await recorder.close();
    await Promise.all(
      [recorder.micPath, recorder.peerPath].map((p) => rm(p, { force: true })),
    );
  }

  async byCall(user: DashboardUser, callId: string) {
    const row = await this.prisma.voiceCallRecording.findFirst({
      where: { callId, task: await this.voicer.scopeWhere(user) },
      include: { task: true },
    });
    if (!row) throw new NotFoundException('Запись звонка не найдена');
    return row;
  }

  async file(user: DashboardUser, callId: string) {
    const r = await this.byCall(user, callId);
    const path = resolve(r.filePath),
      rel = relative(this.dir(), path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new NotFoundException();
    return { data: await readFile(path), title: r.title };
  }

  /** Подпись записи: войсер, который звонил, или менеджер задания. */
  async rename(user: DashboardUser, callId: string, title: string) {
    const clean = title.trim();
    if (!clean) throw new BadRequestException('Укажите подпись записи');
    if (clean.length > 160)
      throw new BadRequestException('Подпись длиннее 160 символов');
    const call = await this.prisma.voiceCall.findFirst({
      where: { id: callId, task: await this.voicer.scopeWhere(user) },
      include: { recording: true },
    });
    if (!call) throw new NotFoundException('Звонок не найден');
    if (!call.recording) {
      if (call.connectedAt && !call.endedAt)
        throw new ConflictException('Звонок ещё идёт');
      if (
        call.connectedAt &&
        call.endedAt &&
        this.clock.ts() - call.endedAt < 120
      )
        throw new ConflictException(
          'Запись ещё собирается, попробуйте через пару секунд',
        );
      throw new NotFoundException('У этого звонка нет записи');
    }
    await this.prisma.voiceCallRecording.update({
      where: { callId },
      data: { title: clean, titledAt: this.clock.ts() },
    });
    return { ok: true, title: clean };
  }

  /** Записи звонков для библиотеки, в общем виде с голосовыми. */
  async list(
    user: DashboardUser,
    q = '',
    take = 40,
  ): Promise<CallRecordingView[]> {
    const rows = await this.prisma.voiceCallRecording.findMany({
      where: {
        task: await this.voicer.scopeWhere(user),
        ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
      },
      take,
      orderBy: { id: 'desc' },
      include: { task: true },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: 'call' as const,
      call_id: r.callId,
      title: r.title,
      titled: Boolean(r.titledAt),
      duration: r.duration,
      createdAt: r.createdAt,
      revision: null,
      current: false as const,
      last_delivery: null,
      task: this.voicer.publicTask(r.task),
    }));
  }
}
