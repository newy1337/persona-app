import { readFileSync, statSync } from 'fs';
import { basename, extname } from 'path';
import type { UsageRow } from '../llm/usage';

export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};

export interface TranscribeOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  language?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  usage?: { record(row: UsageRow): Promise<void> | void };
}

export class TranscribeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TranscribeError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function transcribeFile(
  path: string,
  options: TranscribeOptions,
): Promise<string> {
  const size = statSync(path).size;
  if (size > TRANSCRIBE_MAX_BYTES)
    throw new TranscribeError(
      413,
      `файл ${Math.round(size / 1048576)} МБ — больше 25 МБ`,
    );
  const data = readFileSync(path);
  const baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(
    /\/+$/,
    '',
  );
  const doFetch = options.fetch ?? fetch;
  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? 90_000;

  for (let attempt = 0; ; attempt += 1) {
    const form = new FormData();
    form.append(
      'file',
      new Blob([data], {
        type: MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
      }),
      basename(path),
    );
    form.append('model', options.model);
    form.append('response_format', 'json');
    if (options.language) form.append('language', options.language);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await doFetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.apiKey}` },
        body: form,
        signal: controller.signal,
      });
      const json: any = await res.json().catch(() => null);
      if (!res.ok) {
        const message = `OpenAI ${res.status}: ${json?.error?.message ?? res.statusText ?? 'ошибка'}`;
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new TranscribeError(res.status, message);
      }
      const usage = json?.usage;
      await options.usage?.record({
        provider: 'openai',
        model: options.model,
        stage: 'transcribe',
        elapsedMs: Date.now() - started,
        inputTokens:
          typeof usage?.input_tokens === 'number' ? usage.input_tokens : null,
        outputTokens:
          typeof usage?.output_tokens === 'number' ? usage.output_tokens : null,
        cachedTokens: null,
        cacheWriteTokens: null,
        cacheWrite1hTokens: null,
        providerEstimatedCostUsd: null,
      });
      return String(json?.text ?? '').trim();
    } catch (e) {
      if (e instanceof TranscribeError) throw e;
      if (attempt < maxRetries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      const aborted = (e as Error)?.name === 'AbortError';
      throw new TranscribeError(
        aborted ? 408 : 503,
        aborted
          ? `OpenAI: нет ответа за ${Math.round(timeoutMs / 1000)} с`
          : `OpenAI: нет связи (${(e as Error)?.message ?? e})`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
