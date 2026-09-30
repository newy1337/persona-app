import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve, sep } from 'path';
import { appConfig } from 'src/config/app.config';
import { ClockService } from 'src/shared/clock.service';
import { MAX_UPLOAD_BYTES, safeFileName } from 'src/domain/attachments';

export const UPLOADS_DIR = resolve(join(appConfig.dataDir, 'uploads'));

@Injectable()
export class UploadsService {
  constructor(private clock: ClockService) {}

  save(chatId: number, name: string, data: Buffer): string {
    if (!data?.length) throw new UnprocessableEntityException('пустой файл');
    if (data.length > MAX_UPLOAD_BYTES) {
      throw new UnprocessableEntityException(
        `файл больше ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБ`,
      );
    }
    const dir = join(UPLOADS_DIR, String(chatId));
    mkdirSync(dir, { recursive: true });
    const stamp = `${this.clock.ts()}_${Math.random().toString(36).slice(2, 8)}`;
    const target = join(dir, `${stamp}_${safeFileName(name)}`);
    writeFileSync(target, data);
    return target;
  }

  resolveSafe(path: string): string {
    const abs = resolve(path);
    if (abs !== UPLOADS_DIR && !abs.startsWith(UPLOADS_DIR + sep)) {
      throw new UnprocessableEntityException(
        'файл за пределами хранилища панели',
      );
    }
    if (!existsSync(abs))
      throw new UnprocessableEntityException('файла больше нет');
    return abs;
  }
}
