import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { REPLY_BRAIN, ReplyBrain } from './reply-brain.port';

const MB = 1024 * 1024;
const HEAP_ALERT_MB = 700;

@Injectable()
export class MemoryWatchService {
  private readonly log = new Logger(MemoryWatchService.name);
  private peakHeap = 0;

  constructor(@Inject(REPLY_BRAIN) private readonly brain: ReplyBrain) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  report(): void {
    const mem = process.memoryUsage();
    const heap = Math.round(mem.heapUsed / MB);
    const rss = Math.round(mem.rss / MB);
    const hours = (process.uptime() / 3600).toFixed(1);
    const caches = this.brain.cacheSizes?.() ?? {};
    const parts = Object.entries(caches).map(
      ([name, size]) => `${name}=${size}`,
    );
    const line = `память: куча ${heap} МБ, процесс ${rss} МБ, буферы ${Math.round(mem.arrayBuffers / MB)} МБ, живёт ${hours} ч${
      parts.length ? `; ${parts.join(', ')}` : ''
    }`;
    if (heap >= HEAP_ALERT_MB)
      this.log.warn(`${line} — куча выросла, ответы панели замедлятся`);
    else this.log.log(line);
    this.peakHeap = Math.max(this.peakHeap, heap);
  }
}
