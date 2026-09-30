import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { existsSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { promisify } from 'util';
import {
  AudioProbe,
  encodeArgs,
  isVoiceReady,
  parseProbe,
  probeArgs,
} from 'src/domain/voice-file';
import {
  isVideoFile,
  parseVideoProbe,
  roundDuration,
  roundEncodeArgs,
  videoProbeArgs,
  type VideoProbe,
} from 'src/domain/round-video';
import { UnprocessableEntityException } from '@nestjs/common';

const run = promisify(execFile);
const ENCODE_TIMEOUT_MS = 120_000;
const ROUND_TIMEOUT_MS = 300_000;

export interface VoiceFile {
  path: string;
  duration: number;
  temporary: boolean;
}

@Injectable()
export class VoiceEncoderService {
  private readonly log = new Logger(VoiceEncoderService.name);

  async probe(path: string): Promise<AudioProbe | null> {
    try {
      const { stdout } = await run('ffprobe', probeArgs(path), {
        timeout: ENCODE_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      });
      return parseProbe(stdout);
    } catch (e) {
      this.log.warn(
        `ffprobe unavailable or failed for ${path}: ${e?.message ?? e}`,
      );
      return null;
    }
  }

  async prepare(path: string): Promise<VoiceFile> {
    const asIs: VoiceFile = { path, duration: 0, temporary: false };
    const probe = await this.probe(path);
    if (!probe) return asIs;
    if (isVoiceReady(probe))
      return { path, duration: Math.round(probe.duration), temporary: false };

    const target = join(dirname(path), `${Date.now()}_voice.ogg`);
    try {
      await run('ffmpeg', encodeArgs(path, target), {
        timeout: ENCODE_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      });
      if (!existsSync(target) || statSync(target).size === 0)
        throw new Error('ffmpeg вернул пустой файл');
      this.log.log(
        `voice: ${probe.codec || '?'} → opus (${Math.round(probe.duration)}s)`,
      );
      return {
        path: target,
        duration: Math.round(probe.duration),
        temporary: true,
      };
    } catch (e) {
      this.log.warn(`voice encode failed for ${path}: ${e?.message ?? e}`);
      rmSync(target, { force: true });
      return { ...asIs, duration: Math.round(probe.duration) };
    }
  }

  async probeVideo(path: string): Promise<VideoProbe | null> {
    try {
      const { stdout } = await run('ffprobe', videoProbeArgs(path), {
        timeout: ROUND_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      });
      return parseVideoProbe(stdout);
    } catch (e) {
      this.log.warn(
        `ffprobe unavailable or failed for ${path}: ${e?.message ?? e}`,
      );
      return null;
    }
  }

  async prepareRound(path: string): Promise<VoiceFile> {
    const probe = await this.probeVideo(path);
    if (!probe)
      throw new UnprocessableEntityException(
        'на сервере нет ffmpeg — кружок собрать не из чего',
      );
    if (!isVideoFile(probe))
      throw new UnprocessableEntityException(
        'это не видео — кружок отправляется из видеофайла',
      );

    const target = join(dirname(path), `${Date.now()}_round.mp4`);
    try {
      await run('ffmpeg', roundEncodeArgs(path, target, probe), {
        timeout: ROUND_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (!existsSync(target) || statSync(target).size === 0)
        throw new Error('ffmpeg вернул пустой файл');
      const duration = roundDuration(probe);
      this.log.log(
        `round: ${probe.width}x${probe.height} ${Math.round(probe.duration)}s → 480x480 ${duration}s`,
      );
      return { path: target, duration, temporary: true };
    } catch (e) {
      rmSync(target, { force: true });
      this.log.warn(`round encode failed for ${path}: ${e?.message ?? e}`);
      throw new UnprocessableEntityException(
        `не получилось собрать кружок из этого файла: ${e?.message ?? e}`,
      );
    }
  }

  cleanup(file: VoiceFile): void {
    if (file.temporary) rmSync(file.path, { force: true });
  }
}
