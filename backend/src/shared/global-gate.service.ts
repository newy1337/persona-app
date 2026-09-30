import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { appConfig } from '../config/app.config';

@Injectable()
export class GlobalGateService {
  private readonly path = join(appConfig.dataDir, 'emergency_stop.json');

  status(): { stopped: boolean; reason: string | null } {
    if (!existsSync(this.path)) return { stopped: false, reason: null };
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8'));
      return { stopped: true, reason: data?.reason ?? null };
    } catch {
      return { stopped: true, reason: null };
    }
  }

  engage(reason: string): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ reason, ts: Date.now() }));
  }

  clear(): void {
    rmSync(this.path, { force: true });
  }

  get stopped(): boolean {
    return this.status().stopped;
  }
}
