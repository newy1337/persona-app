import { Injectable } from '@nestjs/common';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { appConfig } from 'src/config/app.config';

export type ClientActivity =
  'typing' | 'voice' | 'video_note' | 'photo' | 'file';

export const ACTIVITY_TTL_MS = 6000;

@Injectable()
export class PresenceService {
  private readonly activity = new Map<
    number,
    { kind: ClientActivity; until: number }
  >();

  setActivity(
    chatId: number,
    kind: ClientActivity | null,
    nowMs = Date.now(),
  ): void {
    if (kind === null) this.activity.delete(chatId);
    else this.activity.set(chatId, { kind, until: nowMs + ACTIVITY_TTL_MS });
  }

  activityOf(chatId: number, nowMs = Date.now()): ClientActivity | null {
    const item = this.activity.get(chatId);
    if (!item) return null;
    if (item.until <= nowMs) {
      this.activity.delete(chatId);
      return null;
    }
    return item.kind;
  }

  avatarPath(chatId: number): string {
    return join(appConfig.mediaDir, 'avatars', `${chatId}.jpg`);
  }

  accountAvatarPath(accountId: number): string {
    return join(appConfig.mediaDir, 'avatars', `account_${accountId}.jpg`);
  }

  accountAvatarUrl(accountId: number): string | null {
    const path = this.accountAvatarPath(accountId);
    if (!existsSync(path)) return null;
    return `/api/tg-accounts/${accountId}/avatar?v=${Math.floor(statSync(path).mtimeMs)}`;
  }

  avatarUrl(chatId: number): string | null {
    const path = this.avatarPath(chatId);
    if (!existsSync(path)) return null;
    return `/api/conversations/${chatId}/avatar?v=${Math.floor(statSync(path).mtimeMs)}`;
  }
}
