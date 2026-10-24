import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import type { VkApi } from './api';
import { VkApiError, VkPeerUnavailable } from './errors';
import type { VkMessage } from './inbound';

/**
 * Исходящие операции VK одного аккаунта. Id сообщения везде — cmid:
 * markAsRead(up_to_cmid), messages.edit(cmid), sendReaction(cmid) работают по нему.
 */

/** emoji → reaction_id (messages.getReactionsAssets, сверено в Chutter 13.10). */
export const REACTIONS: Record<string, number> = {
  '❤️': 1,
  '🔥': 2,
  '😂': 3,
  '👍': 4,
  '💩': 5,
  '❓': 6,
  '😭': 7,
  '😡': 8,
  '👎': 9,
  '👌': 10,
  '😄': 11,
  '🤔': 12,
  '🙏': 13,
  '😘': 14,
  '😍': 15,
  '🎉': 16,
};

/** Попыток messages.send на обрыве сети — с тем же random_id, дубля не будет. */
const SEND_ATTEMPTS = 3;
/**
 * Попыток «сервер загрузки → POST». Узел загрузки VK выдаёт случайно, часть
 * отвечает за ~11 с или 504 — лечится новым сервером (Chutter 09.10).
 */
const UPLOAD_ATTEMPTS = 5;
/** Форма кружка: 1 — круг. */
const VIDEO_MESSAGE_SHAPE_ID = 1;

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};

/**
 * random_id VK — int32 и дедуп в пределах часа. Наш ключ (63-битный, общий с
 * Telegram) сворачиваем детерминированно: повтор того же ключа VK снимет как
 * дубль и вернёт cmid исходного сообщения.
 */
export function foldRandomId(key: string | number | bigint): number {
  return Number(BigInt(key) % 2147483647n) + 1;
}

const newRandomId = () => 1 + Math.floor(Math.random() * 2147483646);

/** Строка вложения: `{kind}{owner}_{id}[_{access_key}]` — без ключа получатель файл не откроет. */
export function attachmentRef(
  kind: string,
  item: { owner_id: number | string; id: number | string; access_key?: string },
): string {
  const ref = `${kind}${item.owner_id}_${item.id}`;
  return item.access_key ? `${ref}_${item.access_key}` : ref;
}

/** Вложение не загрузилось — messages.send не вызывался, у собеседника ничего нет. */
export class VkUploadFailed extends Error {
  name = 'VkUploadFailed';
}

export class VkMessages {
  /** random_id своих отправок: эхо в Long Poll узнаётся по нему без похода в базу. */
  private readonly own = new Set<number>();

  constructor(private readonly api: VkApi) {}

  isOwnEcho(randomId: number): boolean {
    return !!randomId && this.own.has(randomId);
  }

  private remember(key: number) {
    this.own.add(key);
    if (this.own.size > 5000) this.own.delete(this.own.values().next().value!);
  }

  /**
   * messages.send → cmid. Обрыв сети на отправке — исход неизвестен: ищем
   * своё по random_id в истории; не нашли — шлём снова с тем же ключом.
   * `strict` — холодный опенер: ни повторов, ни ожидания на флуде.
   */
  async send(
    peer: number,
    params: { message?: string; attachment?: string; forward?: string },
    opts: { randomId?: string | null; strict?: boolean } = {},
  ): Promise<number> {
    const key = opts.randomId ? foldRandomId(opts.randomId) : newRandomId();
    this.remember(key);
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await this.api.call<{ cmid?: number } | number>(
          'messages.send',
          { peer_id: peer, random_id: key, ...params },
          { strict: opts.strict },
        );
        const cmid = typeof r === 'object' && r ? r.cmid : undefined;
        if (!cmid)
          throw new Error(
            `messages.send вернул ответ без cmid: ${JSON.stringify(r)}`,
          );
        return cmid;
      } catch (e) {
        // Ответ VK с кодом — сообщения нет; 0 — HTTP без ответа VK, могло уйти.
        if (!(e instanceof VkApiError) || e.code !== 0 || opts.strict) throw e;
        const found = await this.findOwn(peer, key).catch(() => null);
        if (found !== null) return found;
        if (attempt >= SEND_ATTEMPTS) throw e;
      }
    }
  }

  /** Своё сообщение с этим random_id среди последних 50 → cmid. */
  async findOwn(peer: number, randomId: number): Promise<number | null> {
    const h = await this.api.call<{ items?: VkMessage[] }>(
      'messages.getHistory',
      {
        peer_id: peer,
        count: 50,
      },
    );
    const hit = (h.items ?? []).find(
      (m) => m.out && Number(m.random_id) === randomId,
    );
    return hit ? hit.conversation_message_id : null;
  }

  /** Ответ на сообщение: reply_to VK ждёт глобальный id, поэтому forward с is_reply. */
  static reply(peer: number, cmid: number): string {
    return JSON.stringify({
      peer_id: peer,
      conversation_message_ids: [cmid],
      is_reply: true,
    });
  }

  /**
   * «Печатает…» — VK держит его 5–10 с. 902 (личка закрыта, хотя ответ
   * собеседник пропускает) — не ошибка: просто без индикатора.
   */
  async typing(
    peer: number,
    type: 'typing' | 'audiomessage' | 'videomessage' | 'photo' = 'typing',
  ) {
    try {
      await this.api.call('messages.setActivity', { peer_id: peer, type });
    } catch (e) {
      if (!(e instanceof VkPeerUnavailable && e.code === 902)) throw e;
    }
  }

  async markRead(peer: number, upToCmid?: number | null) {
    await this.api.call('messages.markAsRead', {
      peer_id: peer,
      ...(upToCmid ? { up_to_cmid: upToCmid } : {}),
    });
  }

  /** «Прослушано» для голосового. */
  async markPlayed(peer: number, cmid: number) {
    await this.api.call('messages.markAsPlayed', { peer_id: peer, cmid });
  }

  /** Пустой emoji — снять реакцию. */
  async react(peer: number, cmid: number, emoji: string) {
    if (!emoji) {
      await this.api.call('messages.deleteReaction', { peer_id: peer, cmid });
      return;
    }
    const reactionId = REACTIONS[emoji] ?? REACTIONS[emoji.replace(/️/g, '')];
    if (!reactionId) throw new Error(`реакцию ${emoji} VK не поддерживает`);
    await this.api.call('messages.sendReaction', {
      peer_id: peer,
      cmid,
      reaction_id: reactionId,
    });
  }

  async edit(peer: number, cmid: number, text: string) {
    await this.api.call('messages.edit', {
      peer_id: peer,
      cmid,
      message: text,
    });
  }

  /** Удаление: «у всех» VK даёт только в первые сутки (924). */
  async delete(peer: number, cmids: number[], forAll: boolean) {
    const r = await this.api.call<Array<{ error?: { code?: number } }>>(
      'messages.delete',
      {
        peer_id: peer,
        cmids: cmids.join(','),
        delete_for_all: forAll ? 1 : 0,
      },
    );
    const failed = (Array.isArray(r) ? r : []).find((x) => x?.error);
    if (failed)
      throw new Error(
        failed.error?.code === 924
          ? 'VK удаляет у собеседника только в первые 24 часа'
          : `VK не удалил сообщение: ${JSON.stringify(failed.error)}`,
      );
  }

  // ── Загрузки ───────────────────────────────────────────────────────────────

  /** Файл в вложение для messages.send; сбой — VkUploadFailed (сообщения точно нет). */
  async upload(
    peer: number,
    path: string,
    kind: 'photo' | 'voice' | 'video' | 'video_note' | 'document',
    title?: string,
  ): Promise<string> {
    try {
      if (kind === 'photo') {
        const u = await this.uploadFile(
          'photos.getMessagesUploadServer',
          path,
          'photo',
          'photo',
          {
            peer_id: peer,
          },
        );
        const saved = await this.api.call<
          Array<{ owner_id: number; id: number; access_key?: string }>
        >('photos.saveMessagesPhoto', {
          photo: String(u.photo),
          server: String(u.server),
          hash: String(u.hash),
        });
        if (!saved?.length)
          throw new Error('saveMessagesPhoto вернул пустой список');
        return attachmentRef('photo', saved[0]);
      }
      if (kind === 'video_note') {
        const u = await this.uploadFile(
          'video.getVideoMessageUploadInfo',
          path,
          'video_hash',
          'video_file',
          {
            shape_id: VIDEO_MESSAGE_SHAPE_ID,
          },
        );
        return attachmentRef('video_message', {
          owner_id: String(u.owner_id),
          id: String(u.video_id),
          access_key: u.access_key as string | undefined,
        });
      }
      if (kind === 'video') {
        const u = await this.uploadFile(
          'video.save',
          path,
          'video_hash',
          'video_file',
          {
            is_private: 1,
            wallpost: 0,
            name: ' ',
          },
        );
        return attachmentRef('video', {
          owner_id: String(u.owner_id),
          id: String(u.video_id),
          access_key: u.access_key as string | undefined,
        });
      }
      // Голосовое — документ типа audio_message (ogg/opus), остальное — doc.
      const u = await this.uploadFile(
        'docs.getMessagesUploadServer',
        path,
        'file',
        'file',
        {
          peer_id: peer,
          type: kind === 'voice' ? 'audio_message' : 'doc',
        },
      );
      const saved = await this.api.call<Record<string, unknown>>('docs.save', {
        file: String(u.file),
        ...(title ? { title } : {}),
      });
      const item = saved?.[String(saved?.type ?? 'doc')] as
        { owner_id: number; id: number; access_key?: string } | undefined;
      if (!item)
        throw new Error(`docs.save без объекта: ${JSON.stringify(saved)}`);
      return attachmentRef('doc', item);
    } catch (e) {
      throw new VkUploadFailed(`${(e as Error).name}: ${(e as Error).message}`);
    }
  }

  /** Сервер загрузки → POST файла; сбой узла — повтор на свежем сервере. */
  private async uploadFile(
    serverMethod: string,
    path: string,
    accept: string,
    field: string,
    params: Record<string, string | number>,
  ): Promise<Record<string, unknown>> {
    const content = await readFile(path);
    const type =
      MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
    for (let attempt = 1; ; attempt++) {
      const target = await this.api.call<
        { upload_url: string } & Record<string, unknown>
      >(serverMethod, params);
      try {
        const uploaded = await this.api.postFile(String(target.upload_url), {
          field,
          filename: basename(path),
          content,
          type,
        });
        if (!uploaded[accept])
          throw new VkApiError(
            0,
            `загрузка не принята: ${JSON.stringify(uploaded).slice(0, 200)}`,
            {
              method: serverMethod,
            },
          );
        return { ...target, ...uploaded };
      } catch (e) {
        if (!(e instanceof VkApiError) || attempt >= UPLOAD_ATTEMPTS) throw e;
      }
    }
  }
}
