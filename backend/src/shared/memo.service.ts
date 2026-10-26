import { Injectable, NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

interface Entry {
  until: number;
  value: Promise<unknown>;
}

const MAX_ENTRIES = 500;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Запрос панели, внутри которого идёт вызов: только ли он читает. */
const requestKind = new AsyncLocalStorage<{ read: boolean }>();

/** Вызов идёт из запроса, который ничего не меняет (GET). Фоновые задачи и тесты — нет. */
export const inReadRequest = (): boolean =>
  requestKind.getStore()?.read === true;

/**
 * Короткий кеш тяжёлых чтений панели. Одинаковые запросы, пришедшие разом
 * (дашборд, колокольчик и шапка опрашивают одно и то же), ждут один поход в
 * базу, а результат живёт несколько секунд. Любой меняющий запрос панели
 * сбрасывает всё: после своего действия человек видит свежие данные. Ключ
 * обязан включать область видимости — иначе один увидит чужое.
 */
@Injectable()
export class MemoService {
  private entries = new Map<string, Entry>();
  /**
   * Тесты пишут в базу напрямую, как бот, и тут же читают: там ответы не
   * хранятся, остаётся только склейка одновременных запросов.
   */
  keep = process.env.NODE_ENV !== 'test';

  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.until > now) return hit.value as Promise<T>;
    const value = load();
    // Пока грузится — отдаём то же обещание всем; срок пошёл с ответа.
    const entry: Entry = { until: Infinity, value };
    this.entries.set(key, entry);
    value.then(
      () => {
        if (this.entries.get(key) === entry)
          entry.until = this.keep ? Date.now() + ttlMs : 0;
      },
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      },
    );
    if (this.entries.size > MAX_ENTRIES) this.prune(now);
    return value;
  }

  /** Данные поменялись: всё закешированное — в мусор. */
  reset(): void {
    this.entries.clear();
  }

  private prune(now: number): void {
    for (const [key, e] of this.entries)
      if (e.until <= now) this.entries.delete(key);
    // Всё свежее, а места нет — выкидываем самые старые записи.
    for (const key of this.entries.keys()) {
      if (this.entries.size <= MAX_ENTRIES) break;
      this.entries.delete(key);
    }
  }
}

/** Помечает чтения и сбрасывает кеш после каждого меняющего запроса. */
@Injectable()
export class MemoMiddleware implements NestMiddleware {
  constructor(private memo: MemoService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const read = READ_METHODS.has(req.method);
    if (!read) res.on('finish', () => this.memo.reset());
    requestKind.run({ read }, next);
  }
}
