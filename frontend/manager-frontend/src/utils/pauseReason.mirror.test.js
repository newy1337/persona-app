// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PAUSE_REASON_SEP, pauseReasonHead, pauseReasonLabel } from './pauseReason';

const PAUSE_TS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../backend/src/domain/pause.ts',
);

function backendSource() {
  const text = readFileSync(PAUSE_TS, 'utf8');
  const body = /export enum TakeoverReason \{([^}]+)\}/.exec(text)?.[1] ?? '';
  const reasons = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const active = /BOT_ACTIVE_REASON = '([^']+)'/.exec(text)?.[1];
  const separator = /PAUSE_REASON_SEP = '([^']+)'/.exec(text)?.[1];
  return { reasons: active ? [active, ...reasons] : reasons, separator };
}

function backendReasons(src) {
  if (!src.reasons.length) throw new Error(`не разобрал TakeoverReason в ${PAUSE_TS}`);
  return src.reasons;
}

function backendSep(src) {
  if (typeof src.separator !== 'string') throw new Error(`не разобрал PAUSE_REASON_SEP в ${PAUSE_TS}`);
  return src.separator;
}

describe('зеркало domain/pause.ts — контракт причины паузы', () => {
  it('разбор бэкового модуля не вырожден (иначе все проверки ниже пусты)', () => {
    const reasons = backendReasons(backendSource());
    expect(reasons.length).toBeGreaterThanOrEqual(5);
    expect(reasons).toContain('human_takeover');
  });

  it('разделитель головы и хвоста совпадает с бэковым PAUSE_REASON_SEP', () => {
    expect(PAUSE_REASON_SEP).toBe(backendSep(backendSource()));
  });

  it('pauseReasonHead — ТОЖДЕСТВО на каждом значении PauseReason', () => {
    for (const reason of backendReasons(backendSource())) {
      expect(pauseReasonHead(reason)).toBe(reason);
    }
  });

  it('ни одно значение PauseReason не содержит разделителя', () => {
    const src = backendSource();
    const sep = backendSep(src);
    for (const reason of backendReasons(src)) {
      expect(reason).not.toContain(sep);
    }
  });

  it('у КАЖДОГО состояния бэка есть человеческая подпись', () => {
    for (const reason of backendReasons(backendSource())) {
      expect(pauseReasonLabel(reason), `нет подписи для «${reason}»`).not.toBe(reason);
    }
  });

  it('хвост отрезается тем же правилом, что split(SEP, 1)[0] на бэке', () => {
    const sep = backendSep(backendSource());
    for (const reason of backendReasons(backendSource())) {
      expect(pauseReasonHead(`${reason}${sep}empty_after_critic/p0_persisted`)).toBe(reason);
    }
  });
});
