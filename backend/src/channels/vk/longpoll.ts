import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { VkApi } from './api';
import { VkApiError, VkSessionExpired, isTerminal } from './errors';
import type { VkMessage } from './inbound';

/**
 * Long Poll одного VK-аккаунта: сервер, ключ и курсор ts/pts.
 *
 * lp_version=21: событие о сообщении сразу несёт cmid, и на каждое сообщение
 * не нужен лишний messages.getById из того же бюджета 1 запрос/с. mode=234 —
 * вложения, расширенные события, pts, платформа онлайн и random_id (как у
 * vkbottle и Chutter).
 *
 * Ответ a_check — `{ts, pts, updates}` или `{failed}`: 1 — история устарела,
 * 2 — протух ключ (ts прежний), 3 — потеряны ключ и курсор, 4 — версия не
 * принята. Пропущенное за 1/3 и за простой процесса догружается
 * messages.getLongPollHistory по pts: курсор хранится в файле между запусками.
 */

export const LP_VERSION = 21;
export const LP_MODE = 234;
/** Ожидание события на стороне VK, секунды (максимум 90). */
export const LP_WAIT_S = 25;
const REBIND_DELAY_MS = 2_000;
const REBIND_MAX_MS = 60_000;
/** Страниц истории за один разрыв (по 200 сообщений): от зацикливания на кривом `more`. */
const HISTORY_PAGES = 20;
/** pts старше (907) или новее (908) того, что VK хранит. */
const PTS_OUT_OF_RANGE = new Set([907, 908]);

export interface Cursor {
  ts: number;
  pts: number;
}

/** Пачка: события одного a_check (или догрузки) и курсор после неё. */
export interface LpBatch {
  updates: unknown[];
  /** Догруженные сообщения — уже полными DTO. */
  missed: VkMessage[];
  cursor: Cursor | null;
}

interface ServerInfo {
  server: string;
  key: string;
  ts: number | string;
  pts?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

/** Курсор в файле: атомарно и только вперёд. */
export class CursorFile {
  constructor(private readonly path: string) {}

  read(): Cursor | null {
    try {
      const d = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Cursor>;
      return Number.isFinite(d.ts) && Number.isFinite(d.pts)
        ? { ts: Number(d.ts), pts: Number(d.pts) }
        : null;
    } catch {
      return null;
    }
  }

  write(c: Cursor): void {
    const saved = this.read();
    if (saved && saved.pts > c.pts) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(c));
    renameSync(tmp, this.path);
  }
}

export class VkLongPoll {
  private server: string | null = null;
  private key: string | null = null;
  private ts: number | null = null;
  private pts: number | null = null;
  /** Что догрузить первым делом: курсор до разрыва. */
  private gap: Cursor | null = null;
  /** Сбои подряд и последний из них: аккаунт «в сети», но приём стоит. */
  failures = 0;
  lastError: string | null = null;

  constructor(
    private readonly api: VkApi,
    private readonly saved: CursorFile | null,
    private readonly log: { warn(m: string): void; log(m: string): void },
  ) {}

  position(): Cursor | null {
    return this.ts !== null && this.pts !== null
      ? { ts: this.ts, pts: this.pts }
      : null;
  }

  async bind(keepTs = false): Promise<void> {
    const r = await this.api.call<ServerInfo>('messages.getLongPollServer', {
      lp_version: LP_VERSION,
      need_pts: 1,
    });
    this.server = String(r.server);
    this.key = String(r.key);
    if (keepTs && this.ts !== null) return;
    this.ts = Number(r.ts);
    this.pts = r.pts !== undefined ? Number(r.pts) : null;
    // Первая привязка: сохранённый курсор старше — за простой что-то пришло.
    const before = this.saved?.read();
    if (before && this.pts !== null && before.pts < this.pts && !this.gap) {
      this.gap = before;
      this.log.warn(
        `long poll: за простой пропущено до pts=${this.pts}, догружаю с ${before.pts}`,
      );
    }
  }

  /** Один шаг: догрузка разрыва либо один a_check. */
  async next(): Promise<LpBatch> {
    if (!this.server || !this.key || this.ts === null) await this.bind();
    if (this.gap) {
      const gap = this.gap;
      let missed: VkMessage[] = [];
      try {
        missed = await this.missed(gap);
      } catch (e) {
        if (!(e instanceof VkApiError && PTS_OUT_OF_RANGE.has(e.code))) throw e;
        this.log.warn(
          `long poll: разрыв не догрузить (${e.message}) — пропущенное потеряно`,
        );
      }
      if (this.gap === gap) this.gap = null;
      return { updates: [], missed, cursor: this.position() };
    }
    const r = (await this.api.getUrl(
      this.server!,
      {
        act: 'a_check',
        key: this.key!,
        ts: this.ts!,
        wait: LP_WAIT_S,
        mode: LP_MODE,
        version: LP_VERSION,
      },
      (LP_WAIT_S + 15) * 1000,
    )) as {
      failed?: number;
      ts?: number;
      pts?: number;
      updates?: unknown[];
      min_version?: number;
      max_version?: number;
    };
    if (r.failed === undefined) {
      this.ts = Number(r.ts);
      if (r.pts !== undefined) this.pts = Number(r.pts);
      return { updates: r.updates ?? [], missed: [], cursor: this.position() };
    }
    if (r.failed === 4)
      throw new VkApiError(
        0,
        `long poll: версия ${LP_VERSION} не принята (min=${r.min_version} max=${r.max_version})`,
        { method: 'a_check' },
      );
    this.log.warn(`long poll failed=${r.failed} — перепривязываюсь`);
    await sleep(REBIND_DELAY_MS);
    if (r.failed === 2) {
      await this.bind(true);
      return { updates: [], missed: [], cursor: null };
    }
    // 1/3: сначала свежий сервер, потом догрузка от старой пары — сообщение
    // между ними придёт дважды (дубль снимет приём), но не потеряется.
    const old = this.position();
    await this.bind();
    if (old && (!this.gap || old.pts < this.gap.pts)) this.gap = old;
    return { updates: [], missed: [], cursor: null };
  }

  /**
   * Входящие и исходящие за разрыв. Берём messages.items, а не history: на
   * v21 сервер обрезает кортежи history, а DTO сообщений полные.
   */
  private async missed(from: Cursor): Promise<VkMessage[]> {
    const byId = new Map<number, VkMessage>();
    let pts = from.pts;
    for (let page = 0; page < HISTORY_PAGES; page++) {
      const r = await this.api.call<{
        messages?: { items?: VkMessage[] };
        new_pts?: number;
        more?: number | boolean;
      }>('messages.getLongPollHistory', {
        ts: from.ts,
        pts,
        lp_version: LP_VERSION,
        extended: 1,
        fields: 'conversation_message_id,from_id,attachments',
      });
      for (const item of r.messages?.items ?? [])
        byId.set(Number(item.id), item);
      if (r.new_pts !== undefined) this.pts = Number(r.new_pts);
      if (!r.more) break;
      if (r.new_pts === undefined || Number(r.new_pts) <= pts) break;
      pts = Number(r.new_pts);
      if (page === HISTORY_PAGES - 1) this.gap = { ts: from.ts, pts };
    }
    const out = [...byId.values()]
      .filter((m) => m.id && m.peer_id)
      .sort((a, b) => a.id - b.id);
    if (out.length)
      this.log.warn(`long poll: догружено пропущенных: ${out.length}`);
    return out;
  }

  /**
   * Бесконечный приём до abort. Сбой сети и прокси — растущая пауза и тот же
   * курсор; терминальные ошибки (сессия умерла, капча, бан) — наружу.
   */
  async *batches(signal: AbortSignal): AsyncGenerator<LpBatch> {
    this.failures = 0;
    while (!signal.aborted) {
      let batch: LpBatch;
      try {
        batch = await this.next();
      } catch (e) {
        if (e instanceof VkSessionExpired || isTerminal(e)) throw e;
        this.failures++;
        this.lastError = (e as Error).message;
        const delay = Math.min(
          REBIND_DELAY_MS * 2 ** (this.failures - 1),
          REBIND_MAX_MS,
        );
        this.log.warn(
          `long poll сбой ${this.failures} подряд — повтор через ${Math.round(delay / 1000)} с: ${(e as Error).message}`,
        );
        await sleep(delay, signal);
        continue;
      }
      this.failures = 0;
      this.lastError = null;
      yield batch;
    }
  }
}

/**
 * Курсор на диск — только когда все сообщения пачки и всех прежних приняты:
 * иначе рестарт посреди хода терял бы сообщение навсегда.
 */
export class CursorCommitter {
  private readonly queue: Array<{
    cursor: Cursor | null;
    outstanding: number;
  }> = [];

  constructor(private readonly file: CursorFile | null) {}

  /** Новая пачка: вернёт колбэк «одно сообщение пачки принято». */
  open(cursor: Cursor | null, messages: number): () => void {
    const entry = { cursor, outstanding: messages };
    this.queue.push(entry);
    this.flush();
    return () => {
      entry.outstanding--;
      this.flush();
    };
  }

  private flush() {
    let last: Cursor | null = null;
    while (this.queue.length && this.queue[0].outstanding <= 0)
      last = this.queue.shift()!.cursor ?? last;
    if (last) this.file?.write(last);
  }
}
